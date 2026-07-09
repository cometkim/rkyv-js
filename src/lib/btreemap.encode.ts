/**
 * std::collections::BTreeMap / BTreeSet encoders.
 *
 * See `./btreemap.decode.ts` for the archived B-tree byte layout. Default
 * branching factor E = 5 (entries per node).
 *
 * Entries are sorted by key before archiving — Rust's BTreeMap invariant.
 * String keys sort by Unicode code point, matching Rust's UTF-8 byte order.
 * The streaming node builder is a literal port of rkyv's
 * `serialize_from_ordered_iter`.
 */

import {
  alignOffset,
  BaseEncoder,
  type Encoder,
  type AnyEncoder,
  type Infer,
  type Layout,
  type RkyvFormat,
  type RkyvWriter,
} from 'rkyv-js/core';

import { unit } from '../encode.ts';
import { SetOfMapEncoder } from './internal/map-set.encode.ts';

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

export interface BTreeResolver {
  rootPos: number;
  len: number;
}

interface InnerItem<K, V> {
  entry: [K, V];
  /** Position of the child closed just before this entry was pulled up. */
  lesser: number | null;
}

/** Compare strings by Unicode code point (equivalent to UTF-8 byte order). */
function compareCodePoints(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca !== cb) {
      // Map surrogate halves above BMP code units so the order matches
      // code points rather than UTF-16 code units.
      if (ca >= 0xd800 && ca <= 0xdbff) ca += 0x2800;
      if (cb >= 0xd800 && cb <= 0xdbff) cb += 0x2800;
      return ca - cb;
    }
  }
  return a.length - b.length;
}

function defaultCompare(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    return compareCodePoints(a, b);
  }
  if ((a as number) < (b as number)) return -1;
  if ((a as number) > (b as number)) return 1;
  return 0;
}

export class BTreeMapEncoder<K, V> extends BaseEncoder<Map<K, V>, BTreeResolver, BTreeLayout> {
  #key: Encoder<K>;
  #value: Encoder<V>;
  #E: number;
  #compare: (a: K, b: K) => number;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: NodeGeometry | null = null;

  constructor(
    keyCodec: Encoder<K>,
    valueCodec: Encoder<V>,
    E: number = 5,
    compare: (a: K, b: K) => number = defaultCompare,
  ) {
    super({ inline: false, hashable: false });
    this.#key = keyCodec;
    this.#value = valueCodec;
    this.#E = E;
    this.#compare = compare;
  }

  // Header layout never depends on the entry types (BTreeMap is a valid
  // recursion point in Rust); node geometry is memoized separately and
  // computed only at write time.
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

  /** Archive one node's keys[E] and values[E] regions. */
  #writeNodeEntries(
    writer: RkyvWriter,
    nodePos: number,
    entries: readonly [K, V][],
    keyResolvers: unknown[],
    valueResolvers: unknown[],
    g: NodeGeometry,
  ): void {
    writer.padTo(nodePos + g.keysOffset);
    for (let i = 0; i < this.#E; i++) {
      const slotPos = nodePos + g.keysOffset + i * g.keyStride;
      writer.padTo(slotPos);
      if (i < entries.length) {
        this.#key.resolve(writer, entries[i][0], keyResolvers[i]);
      }
      writer.padTo(slotPos + g.keyStride);
    }
    writer.padTo(nodePos + g.valuesOffset);
    for (let i = 0; i < this.#E; i++) {
      const slotPos = nodePos + g.valuesOffset + i * g.valueStride;
      writer.padTo(slotPos);
      if (i < entries.length) {
        this.#value.resolve(writer, entries[i][1], valueResolvers[i]);
      }
      writer.padTo(slotPos + g.valueStride);
    }
  }

  #archiveNodeDeps(
    writer: RkyvWriter,
    entries: readonly [K, V][],
  ): { keyResolvers: unknown[]; valueResolvers: unknown[] } {
    const keyResolvers: unknown[] = new Array<unknown>(entries.length);
    const valueResolvers: unknown[] = new Array<unknown>(entries.length);
    for (let i = 0; i < entries.length; i++) {
      keyResolvers[i] = this.#key.inline ? undefined : this.#key.archive(writer, entries[i][0]);
      valueResolvers[i] = this.#value.inline ? undefined : this.#value.archive(writer, entries[i][1]);
    }
    return { keyResolvers, valueResolvers };
  }

  #writeLeaf(writer: RkyvWriter, entries: readonly [K, V][], g: NodeGeometry): number {
    const { keyResolvers, valueResolvers } = this.#archiveNodeDeps(writer, entries);
    writer.align(g.nodeAlign);
    const pos = writer.pos;
    writer.writeU8(NODE_KIND_LEAF);
    this.#writeNodeEntries(writer, pos, entries, keyResolvers, valueResolvers, g);
    writer.padTo(pos + g.leafLenOffset);
    writer.writeUsize(entries.length);
    writer.padTo(pos + g.leafNodeSize);
    return pos;
  }

  #writeInner(
    writer: RkyvWriter,
    items: readonly InnerItem<K, V>[],
    greaterPos: number | null,
    g: NodeGeometry,
  ): number {
    const entries = items.map((item) => item.entry);
    const { keyResolvers, valueResolvers } = this.#archiveNodeDeps(writer, entries);
    writer.align(g.nodeAlign);
    const pos = writer.pos;
    writer.writeU8(1);
    this.#writeNodeEntries(writer, pos, entries, keyResolvers, valueResolvers, g);
    writer.padTo(pos + g.lesserNodesOffset);

    // lesser_nodes[i] is the child closed just before entry i was pulled;
    // missing children are the invalid sentinel (RelPtr::emplace_invalid).
    for (let i = 0; i < this.#E; i++) {
      const ptrPos = writer.reserveRelPtr();
      const lesser = i < items.length ? items[i].lesser : null;
      if (lesser === null) {
        writer.writeInvalidPtrAt(ptrPos);
      } else {
        writer.writeRelPtrAt(ptrPos, lesser);
      }
    }
    const greaterPtrPos = writer.reserveRelPtr();
    if (greaterPos === null) {
      writer.writeInvalidPtrAt(greaterPtrPos);
    } else {
      writer.writeRelPtrAt(greaterPtrPos, greaterPos);
    }
    writer.padTo(pos + g.innerNodeSize);
    return pos;
  }

  /**
   * Literal port of rkyv's `serialize_from_ordered_iter` streaming builder:
   * entries fill an open leaf; on leaf close, one entry is pulled up into the
   * deepest non-full open inner node; the last tree level holds exactly
   * `llEntries` entries, with a "transition" close of the deepest inner when
   * that budget is exhausted. Inner nodes always hold exactly E entries.
   */
  archive(writer: RkyvWriter, value: Map<K, V>): BTreeResolver {
    const E = this.#E;
    const B = E + 1;
    if (value.size === 0) {
      return { rootPos: 0, len: 0 };
    }
    const g = this.#nodeGeometry(writer.format);

    const entries = [...value.entries()].sort((a, b) => this.#compare(a[0], b[0]));
    const len = entries.length;

    // height = 1 + ilog_B(len); llEntries = len - (B^(height-1) - 1)
    let height = 1;
    for (let p = B; p <= len; p *= B) {
      height++;
    }
    let fullAbove = 1;
    for (let i = 1; i < height; i++) {
      fullAbove *= B;
    }
    const llEntries = len - (fullAbove - 1);

    const openInners: InnerItem<K, V>[][] = [];
    for (let i = 0; i < height - 1; i++) {
      openInners.push([]);
    }
    let openLeaf: [K, V][] = [];
    let childPos: number | null = null;
    let leafEntries = 0;
    let idx = 0;

    while (idx < len) {
      openLeaf.push(entries[idx++]);
      leafEntries++;

      if (leafEntries === llEntries || openLeaf.length === E) {
        childPos = this.#writeLeaf(writer, openLeaf, g);
        openLeaf = [];

        // On the transition node, fill and close the deepest open inner.
        if (leafEntries === llEntries) {
          const inner = openInners.pop();
          if (inner !== undefined) {
            while (inner.length < E && idx < len) {
              inner.push({ entry: entries[idx++], lesser: childPos });
              childPos = null;
            }
            childPos = this.#writeInner(writer, inner, childPos, g);
          }
        }

        // Add the closed node to an open inner.
        let popped = 0;
        while (openInners.length > 0) {
          const last = openInners[openInners.length - 1];
          if (last.length === E) {
            childPos = this.#writeInner(writer, last, childPos, g);
            openInners.pop();
            popped++;
          } else {
            last.push({ entry: entries[idx++], lesser: childPos });
            childPos = null;
            for (let i = 0; i < popped; i++) {
              openInners.push([]);
            }
            break;
          }
        }
      }
    }

    if (openLeaf.length > 0) {
      childPos = this.#writeLeaf(writer, openLeaf, g);
    }
    for (let inner = openInners.pop(); inner !== undefined; inner = openInners.pop()) {
      childPos = this.#writeInner(writer, inner, childPos, g);
    }

    return { rootPos: childPos as number, len };
  }

  resolve(writer: RkyvWriter, _value: Map<K, V>, resolver: BTreeResolver): number {
    const pos = writer.pos;
    const ptrPos = writer.reserveRelPtr();
    writer.writeUsize(resolver.len);
    if (resolver.len > 0) {
      writer.writeRelPtrAt(ptrPos, resolver.rootPos);
    } else {
      writer.writeInvalidPtrAt(ptrPos);
    }
    return pos;
  }
}

/**
 * std::collections::BTreeMap<K, V> (write half).
 *
 * `compare` orders keys like Rust's `Ord` for the key type; the default
 * handles numbers, bigints, and strings (by code point = UTF-8 byte order).
 */
export function btreeMap<K extends AnyEncoder, V extends AnyEncoder>(
  keyCodec: K,
  valueCodec: V,
  E: number = 5,
  compare: (a: Infer<K>, b: Infer<K>) => number = defaultCompare,
): Encoder<Map<Infer<K>, Infer<V>>> {
  return new BTreeMapEncoder(keyCodec, valueCodec, E, compare);
}

/**
 * std::collections::BTreeSet<T> — a thin wrapper over `BTreeMap<T, ()>`.
 */
export function btreeSet<E extends AnyEncoder>(
  element: E,
  branching: number = 5,
  compare: (a: Infer<E>, b: Infer<E>) => number = defaultCompare,
): Encoder<Set<Infer<E>>> {
  return new SetOfMapEncoder(new BTreeMapEncoder<Infer<E>, null>(element, unit, branching, compare));
}
