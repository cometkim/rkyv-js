import { alignOffset, type RkyvCodec, type Resolver } from 'rkyv-js/codec';
import type { RkyvReader } from 'rkyv-js/reader';

/**
 * BTreeMap<K, V> - rkyv's B-tree map
 *
 * The archived format uses a B-tree structure with:
 * - Root pointer (RelPtr) + length (u32)
 * - Leaf nodes: kind (u8) + keys[E] + values[E] + len (u32)
 * - Inner nodes: kind (u8) + keys[E] + values[E] + lesser_nodes[E] + greater_node
 *
 * Default branching factor E = 5 (meaning up to 5 entries per node)
 */
export function btreeMap<K, V>(
  keyCodec: RkyvCodec<K>,
  valueCodec: RkyvCodec<V>,
  E: number = 5,
): RkyvCodec<Map<K, V>> {
  // Node layout calculations
  const NODE_KIND_LEAF = 0;
  const NODE_KIND_INNER = 1;

  // Node<K, V, E> layout:
  // - kind: u8
  // - padding to align keys
  // - keys: [MaybeUninit<K>; E]
  // - values: [MaybeUninit<V>; E]
  const keyAlign = keyCodec.align;
  const valueAlign = valueCodec.align;
  const nodeAlign = Math.max(1, keyAlign, valueAlign);

  const kindOffset = 0;
  const keysOffset = alignOffset(1, keyAlign); // After kind byte, aligned for K
  const keyStride = alignOffset(keyCodec.size, keyCodec.align);
  const keysSize = keyStride * E;
  const valuesOffset = alignOffset(keysOffset + keysSize, valueAlign);
  const valueStride = alignOffset(valueCodec.size, valueCodec.align);
  const valuesSize = valueStride * E;
  const nodeBaseSize = valuesOffset + valuesSize;

  // LeafNode<K, V, E> = Node + len: ArchivedUsize (u32)
  const leafLenOffset = alignOffset(nodeBaseSize, 4);
  const leafNodeSize = alignOffset(leafLenOffset + 4, nodeAlign);

  // InnerNode<K, V, E> = Node + lesser_nodes: [RelPtr; E] + greater_node: RelPtr
  const lesserNodesOffset = alignOffset(nodeBaseSize, 4);
  const lesserNodesSize = 4 * E;
  const greaterNodeOffset = lesserNodesOffset + lesserNodesSize;
  const innerNodeSize = alignOffset(greaterNodeOffset + 4, nodeAlign);

  // Helper to read a key at index i from a node
  const readKey = (reader: RkyvReader, nodeOffset: number, i: number): K => {
    const keyOffset = nodeOffset + keysOffset + i * keyStride;
    return keyCodec.decode(reader, keyOffset);
  };

  // Helper to read a value at index i from a node
  const readValue = (reader: RkyvReader, nodeOffset: number, i: number): V => {
    const valueOffset = nodeOffset + valuesOffset + i * valueStride;
    return valueCodec.decode(reader, valueOffset);
  };

  // In-order traversal of the B-tree to collect all entries
  const collectEntries = (reader: RkyvReader, rootOffset: number, len: number): Map<K, V> => {
    const result = new Map<K, V>();
    if (len === 0) return result;

    // Stack for iterative in-order traversal: (nodeOffset, nextIndex)
    const stack: Array<{ nodeOffset: number; nextIndex: number }> = [];

    // Start at root and descend to leftmost leaf
    let current = rootOffset;
    while (true) {
      const kind = reader.readU8(current + kindOffset);
      if (kind === NODE_KIND_LEAF) {
        stack.push({ nodeOffset: current, nextIndex: 0 });
        break;
      } else {
        // Inner node - push and descend to first lesser node
        stack.push({ nodeOffset: current, nextIndex: 0 });
        const lesserPtr = current + lesserNodesOffset;
        const relOffset = reader.readI32(lesserPtr);
        if (relOffset === 0) {
          // Invalid pointer, stay at this node
          break;
        }
        current = lesserPtr + relOffset;
      }
    }

    // Iterate through entries
    while (stack.length > 0 && result.size < len) {
      const top = stack[stack.length - 1];
      const kind = reader.readU8(top.nodeOffset + kindOffset);

      if (kind === NODE_KIND_LEAF) {
        const leafLen = reader.readU32(top.nodeOffset + leafLenOffset);
        if (top.nextIndex < leafLen) {
          const key = readKey(reader, top.nodeOffset, top.nextIndex);
          const value = readValue(reader, top.nodeOffset, top.nextIndex);
          result.set(key, value);
          top.nextIndex++;
        } else {
          stack.pop();
        }
      } else {
        // Inner node
        if (top.nextIndex < E) {
          // Check if we need to visit the key at nextIndex
          const key = readKey(reader, top.nodeOffset, top.nextIndex);
          const value = readValue(reader, top.nodeOffset, top.nextIndex);
          result.set(key, value);
          top.nextIndex++;

          // After visiting the key, descend into the next subtree
          let nextChildPtrOffset: number;
          if (top.nextIndex < E) {
            nextChildPtrOffset = top.nodeOffset + lesserNodesOffset + top.nextIndex * 4;
          } else {
            nextChildPtrOffset = top.nodeOffset + greaterNodeOffset;
          }

          const relOffset = reader.readI32(nextChildPtrOffset);
          if (relOffset !== 0) {
            // Valid child pointer - descend
            let child = nextChildPtrOffset + relOffset;
            while (true) {
              const childKind = reader.readU8(child + kindOffset);
              if (childKind === NODE_KIND_LEAF) {
                stack.push({ nodeOffset: child, nextIndex: 0 });
                break;
              } else {
                stack.push({ nodeOffset: child, nextIndex: 0 });
                const lesserPtr = child + lesserNodesOffset;
                const lesserRel = reader.readI32(lesserPtr);
                if (lesserRel === 0) break;
                child = lesserPtr + lesserRel;
              }
            }
          }
        } else {
          stack.pop();
        }
      }
    }

    return result;
  };

  return {
    size: 8, // relptr (4) + len (4)
    align: 4,

    access(reader, offset) {
      return this.decode(reader, offset);
    },

    decode(reader, offset) {
      const rootRelOffset = reader.readI32(offset);
      const len = reader.readU32(offset + 4);

      if (len === 0) {
        return new Map<K, V>();
      }

      const rootOffset = offset + rootRelOffset;
      return collectEntries(reader, rootOffset, len);
    },

    _archive(writer, value) {
      if (value.size === 0) {
        return { pos: 0, rootPos: 0, len: 0 };
      }

      // Sort entries by key for B-tree ordering
      const entries = Array.from(value.entries());
      // Note: We assume keys are comparable. For complex keys, this may need adjustment.

      const len = entries.length;

      // For simplicity, we'll serialize as a single leaf if len <= E
      // Otherwise, build a proper B-tree structure

      if (len <= E) {
        // Single leaf node
        // First, archive all keys and values
        const resolvers: Array<{ keyResolver: Resolver; valueResolver: Resolver }> = [];
        for (const [k, v] of entries) {
          resolvers.push({
            keyResolver: keyCodec._archive(writer, k),
            valueResolver: valueCodec._archive(writer, v),
          });
        }

        // Write leaf node
        writer.align(nodeAlign);
        const leafPos = writer.pos;

        // kind
        writer.writeU8(NODE_KIND_LEAF);

        // Pad to keys
        writer.padTo(leafPos + keysOffset);

        // keys
        for (let i = 0; i < E; i++) {
          writer.align(keyCodec.align);
          if (i < len) {
            keyCodec._resolve(writer, entries[i][0], resolvers[i].keyResolver);
          } else {
            // Padding for unused slots
            for (let j = 0; j < keyCodec.size; j++) writer.writeU8(0);
          }
        }

        // Pad to values
        writer.padTo(leafPos + valuesOffset);

        // values
        for (let i = 0; i < E; i++) {
          writer.align(valueCodec.align);
          if (i < len) {
            valueCodec._resolve(writer, entries[i][1], resolvers[i].valueResolver);
          } else {
            for (let j = 0; j < valueCodec.size; j++) writer.writeU8(0);
          }
        }

        // Pad to len field
        writer.padTo(leafPos + leafLenOffset);
        writer.writeU32(len);

        // Pad to full leaf size
        writer.padTo(leafPos + leafNodeSize);

        return { pos: leafPos, rootPos: leafPos, len };
      }

      // For larger maps, build a B-tree bottom-up following rkyv's algorithm
      // 
      // The tree is built by:
      // 1. Creating leaf nodes that hold up to E entries each
      // 2. Creating inner nodes that hold E keys and E+1 child pointers
      // 
      // We'll use a simpler approach: serialize all entries into leaf nodes,
      // then build inner nodes to connect them.

      type NodeInfo = { pos: number };

      // Helper to write a leaf node
      const writeLeaf = (leafEntries: Array<[K, V]>): NodeInfo => {
        const resolvers: Array<{ keyResolver: Resolver; valueResolver: Resolver }> = [];
        for (const [k, v] of leafEntries) {
          resolvers.push({
            keyResolver: keyCodec._archive(writer, k),
            valueResolver: valueCodec._archive(writer, v),
          });
        }

        writer.align(nodeAlign);
        const leafPos = writer.pos;

        writer.writeU8(NODE_KIND_LEAF);
        writer.padTo(leafPos + keysOffset);

        for (let i = 0; i < E; i++) {
          writer.align(keyCodec.align);
          if (i < leafEntries.length) {
            keyCodec._resolve(writer, leafEntries[i][0], resolvers[i].keyResolver);
          } else {
            for (let j = 0; j < keyCodec.size; j++) writer.writeU8(0);
          }
        }

        writer.padTo(leafPos + valuesOffset);

        for (let i = 0; i < E; i++) {
          writer.align(valueCodec.align);
          if (i < leafEntries.length) {
            valueCodec._resolve(writer, leafEntries[i][1], resolvers[i].valueResolver);
          } else {
            for (let j = 0; j < valueCodec.size; j++) writer.writeU8(0);
          }
        }

        writer.padTo(leafPos + leafLenOffset);
        writer.writeU32(leafEntries.length);
        writer.padTo(leafPos + leafNodeSize);

        return { pos: leafPos };
      };

      // Helper to write an inner node
      const writeInner = (
        innerEntries: Array<[K, V]>,
        childNodes: NodeInfo[],
      ): NodeInfo => {
        const resolvers: Array<{ keyResolver: Resolver; valueResolver: Resolver }> = [];
        for (const [k, v] of innerEntries) {
          resolvers.push({
            keyResolver: keyCodec._archive(writer, k),
            valueResolver: valueCodec._archive(writer, v),
          });
        }

        writer.align(nodeAlign);
        const innerPos = writer.pos;

        writer.writeU8(NODE_KIND_INNER);
        writer.padTo(innerPos + keysOffset);

        // keys
        for (let i = 0; i < E; i++) {
          writer.align(keyCodec.align);
          if (i < innerEntries.length) {
            keyCodec._resolve(writer, innerEntries[i][0], resolvers[i].keyResolver);
          } else {
            for (let j = 0; j < keyCodec.size; j++) writer.writeU8(0);
          }
        }

        writer.padTo(innerPos + valuesOffset);

        // values
        for (let i = 0; i < E; i++) {
          writer.align(valueCodec.align);
          if (i < innerEntries.length) {
            valueCodec._resolve(writer, innerEntries[i][1], resolvers[i].valueResolver);
          } else {
            for (let j = 0; j < valueCodec.size; j++) writer.writeU8(0);
          }
        }

        writer.padTo(innerPos + lesserNodesOffset);

        // lesser_nodes - relative pointers to first E children
        for (let i = 0; i < E; i++) {
          const ptrPos = writer.pos;
          if (i < childNodes.length - 1) {
            writer.writeI32(childNodes[i].pos - ptrPos);
          } else {
            writer.writeI32(0); // Invalid/null pointer
          }
        }

        // greater_node - relative pointer to last child
        const greaterPtrPos = writer.pos;
        if (childNodes.length > 0) {
          writer.writeI32(childNodes[childNodes.length - 1].pos - greaterPtrPos);
        } else {
          writer.writeI32(0);
        }

        writer.padTo(innerPos + innerNodeSize);

        return { pos: innerPos };
      };

      // Build the tree bottom-up
      // First, create all leaf nodes
      const leaves: NodeInfo[] = [];
      for (let i = 0; i < len; i += E) {
        const leafEntries = entries.slice(i, Math.min(i + E, len));
        leaves.push(writeLeaf(leafEntries));
      }

      // If only one leaf, it's the root
      if (leaves.length === 1) {
        return { pos: leaves[0].pos, rootPos: leaves[0].pos, len };
      }

      // Build inner nodes level by level until we have a single root
      // Each inner node holds E keys and connects E+1 children
      // The keys come from the "separator" entries between children
      let currentLevel = leaves;

      while (currentLevel.length > 1) {
        const nextLevel: NodeInfo[] = [];
        let i = 0;

        while (i < currentLevel.length) {
          // Take up to E+1 children for this inner node
          const childrenForNode = currentLevel.slice(i, i + E + 1);
          
          // We need E keys to separate E+1 children
          // Use separator entries at the boundaries between children
          const keysForNode: Array<[K, V]> = [];
          for (let j = 0; j < childrenForNode.length - 1 && j < E; j++) {
            const separatorIdx = Math.min((i + j + 1) * E - 1, len - 1);
            if (separatorIdx >= 0 && separatorIdx < len) {
              keysForNode.push(entries[separatorIdx]);
            }
          }

          nextLevel.push(writeInner(keysForNode, childrenForNode));
          i += E + 1;
        }

        currentLevel = nextLevel;
      }

      const root = currentLevel[0];
      return { pos: root.pos, rootPos: root.pos, len };
    },

    _resolve(writer, _value, resolver) {
      writer.align(4);
      const structPos = writer.pos;
      const r = resolver as unknown as { rootPos: number; len: number };

      const ptrPos = writer.reserveRelPtr32();
      writer.writeU32(r.len);

      if (r.len > 0) {
        writer.writeRelPtr32At(ptrPos, r.rootPos);
      } else {
        writer.writeRelPtr32At(ptrPos, 0);
      }

      return structPos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}
