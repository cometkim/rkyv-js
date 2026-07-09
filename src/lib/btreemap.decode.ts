/**
 * std::collections::BTreeMap / BTreeSet decoders.
 *
 * The archived format is rkyv's B-tree:
 * - header: root pointer (RelPtr) + length (ArchivedUsize)
 * - leaf nodes: kind (u8) + keys[E] + values[E] + len (ArchivedUsize)
 * - inner nodes: kind (u8) + keys[E] + values[E] + lesser_nodes[E] +
 *   greater_node (RelPtrs)
 *
 * Default branching factor E = 5 (entries per node).
 *
 * Reading is an in-order walk over the archived nodes; the entries were
 * sorted at archive time, so no comparator is needed here — the streaming
 * builder and key ordering live entirely on the encode side
 * (`./btreemap.encode.ts`).
 */

import {
  alignOffset,
  BaseDecoder,
  type Decoder,
  type AnyDecoder,
  type Infer,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
} from 'rkyv-js/core';

import { unit } from '../decode.ts';
import { SetOfMapDecoder } from './internal/map-set.decode.ts';

const NODE_KIND_LEAF = 0;

export interface BTreeLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface NodeGeometry {
  pb: 2 | 4 | 8;
  keysOffset: number;
  keyStride: number;
  valuesOffset: number;
  valueStride: number;
  nodeAlign: number;
  leafLenOffset: number;
  leafNodeSize: number;
  lesserNodesOffset: number;
  greaterNodeOffset: number;
  innerNodeSize: number;
}

export class BTreeMapDecoder<K, V> extends BaseDecoder<Map<K, V>, BTreeLayout> {
  #key: Decoder<K>;
  #value: Decoder<V>;
  #E: number;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: NodeGeometry | null = null;

  constructor(keyCodec: Decoder<K>, valueCodec: Decoder<V>, E: number = 5) {
    super({ inline: false, hashable: false });
    this.#key = keyCodec;
    this.#value = valueCodec;
    this.#E = E;
  }

  // Header layout never depends on the entry types (BTreeMap is a valid
  // recursion point in Rust); node geometry is memoized separately and
  // computed only at read time.
  computeLayout(fmt: RkyvFormat): BTreeLayout {
    const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
    return { size: pb * 2, align: fmt.aligned ? pb : 1, pb };
  }

  #nodeGeometry(fmt: RkyvFormat): NodeGeometry {
    if (fmt !== this.#geometryFormat) {
      const E = this.#E;
      const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
      const k = this.#key.layout(fmt);
      const v = this.#value.layout(fmt);
      const usizeAlign = fmt.aligned ? pb : 1;

      const keysOffset = alignOffset(1, k.align);
      const keyStride = alignOffset(k.size, k.align);
      const valuesOffset = alignOffset(keysOffset + keyStride * E, v.align);
      const valueStride = alignOffset(v.size, v.align);
      const nodeBaseSize = valuesOffset + valueStride * E;
      const nodeAlign = Math.max(1, k.align, v.align, usizeAlign);

      const leafLenOffset = alignOffset(nodeBaseSize, usizeAlign);
      const lesserNodesOffset = alignOffset(nodeBaseSize, usizeAlign);
      const greaterNodeOffset = lesserNodesOffset + pb * E;

      this.#geometry = {
        pb,
        keysOffset,
        keyStride,
        valuesOffset,
        valueStride,
        nodeAlign,
        leafLenOffset,
        leafNodeSize: alignOffset(leafLenOffset + pb, nodeAlign),
        lesserNodesOffset,
        greaterNodeOffset,
        innerNodeSize: alignOffset(greaterNodeOffset + pb, nodeAlign),
      };
      this.#geometryFormat = fmt;
    }
    return this.#geometry as NodeGeometry;
  }

  read(reader: RkyvReader, offset: number): Map<K, V> {
    const l = this.layout(reader.format);
    const len = reader.readUsize(offset + l.pb);
    const result = new Map<K, V>();
    if (len === 0) return result;

    const rootOffset = reader.readRelPtr(offset);
    this.#collectEntries(reader, rootOffset, len, this.#nodeGeometry(reader.format), result);
    return result;
  }

  #readKey(reader: RkyvReader, nodeOffset: number, i: number, g: NodeGeometry): K {
    return this.#key.read(reader, nodeOffset + g.keysOffset + i * g.keyStride);
  }

  #readValue(reader: RkyvReader, nodeOffset: number, i: number, g: NodeGeometry): V {
    return this.#value.read(reader, nodeOffset + g.valuesOffset + i * g.valueStride);
  }

  /** Descend to the leftmost reachable node, pushing the path on the stack. */
  #descend(
    reader: RkyvReader,
    start: number,
    g: NodeGeometry,
    stack: Array<{ nodeOffset: number; nextIndex: number }>,
  ): void {
    let current = start;
    for (;;) {
      stack.push({ nodeOffset: current, nextIndex: 0 });
      if (reader.readU8(current) === NODE_KIND_LEAF) return;
      const lesserPtr = current + g.lesserNodesOffset;
      // Missing children are rkyv's invalid pointer (raw offset 1).
      if (reader.isInvalidPtr(lesserPtr)) return;
      current = reader.readRelPtr(lesserPtr);
    }
  }

  /** In-order traversal collecting all entries. */
  #collectEntries(
    reader: RkyvReader,
    rootOffset: number,
    len: number,
    g: NodeGeometry,
    result: Map<K, V>,
  ): void {
    const stack: Array<{ nodeOffset: number; nextIndex: number }> = [];
    this.#descend(reader, rootOffset, g, stack);

    while (stack.length > 0 && result.size < len) {
      const top = stack[stack.length - 1];
      const kind = reader.readU8(top.nodeOffset);

      if (kind === NODE_KIND_LEAF) {
        const leafLen = reader.readUsize(top.nodeOffset + g.leafLenOffset);
        if (top.nextIndex < leafLen) {
          result.set(
            this.#readKey(reader, top.nodeOffset, top.nextIndex, g),
            this.#readValue(reader, top.nodeOffset, top.nextIndex, g),
          );
          top.nextIndex++;
        } else {
          stack.pop();
        }
      } else if (top.nextIndex < this.#E) {
        result.set(
          this.#readKey(reader, top.nodeOffset, top.nextIndex, g),
          this.#readValue(reader, top.nodeOffset, top.nextIndex, g),
        );
        top.nextIndex++;

        // After visiting the key, descend into the next subtree.
        const nextChildPtrOffset =
          top.nextIndex < this.#E
            ? top.nodeOffset + g.lesserNodesOffset + top.nextIndex * g.pb
            : top.nodeOffset + g.greaterNodeOffset;
        if (!reader.isInvalidPtr(nextChildPtrOffset)) {
          this.#descend(reader, reader.readRelPtr(nextChildPtrOffset), g, stack);
        }
      } else {
        stack.pop();
      }
    }
  }
}

/**
 * std::collections::BTreeMap<K, V> (read half).
 *
 * Archived entries are already key-ordered, so reading needs no comparator.
 */
export function btreeMap<K extends AnyDecoder, V extends AnyDecoder>(
  keyCodec: K,
  valueCodec: V,
  E: number = 5,
): Decoder<Map<Infer<K>, Infer<V>>> {
  return new BTreeMapDecoder(keyCodec, valueCodec, E);
}

/**
 * std::collections::BTreeSet<T> — a thin wrapper over `BTreeMap<T, ()>`.
 */
export function btreeSet<E extends AnyDecoder>(
  element: E,
  branching: number = 5,
): Decoder<Set<Infer<E>>> {
  return new SetOfMapDecoder(new BTreeMapDecoder<Infer<E>, null>(element, unit, branching));
}
