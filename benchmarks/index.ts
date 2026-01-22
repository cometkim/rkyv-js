/**
 * Benchmark comparing rkyv-js against other serialization formats.
 *
 * Run with: npm run benchmark
 */

import { run, bench, group, summary } from 'mitata';
import * as capnp from 'capnp-es';
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import protobuf from 'protobufjs';

// Import rkyv-js from dist
import {
  access,
  toBytes,
  struct,
  vec,
  option,
  string,
  u32,
  f64,
  bool,
  structEncoder,
  vecEncoder,
  optionEncoder,
  stringEncoder,
  u32Encoder,
  f64Encoder,
  boolEncoder,
  type RkyvDecoder,
  type RkyvEncoder,
} from '../dist/index.js';

// Import Cap'n Proto generated types
import { Point as CapnpPoint, Person as CapnpPerson } from './schema.ts';

// Load protobuf schema
const protoRoot = await protobuf.load(new URL('./schema.proto', import.meta.url).pathname);
const ProtoPoint = protoRoot.lookupType('Point');
const ProtoPerson = protoRoot.lookupType('Person');

// ============================================================================
// rkyv-js type definitions
// ============================================================================

interface Point {
  x: number;
  y: number;
}

interface Person {
  name: string;
  age: number;
  email: string | null;
  scores: number[];
  active: boolean;
}

const PointDecoder: RkyvDecoder<Point> = struct({
  x: { decoder: f64 },
  y: { decoder: f64 },
});

const PointEncoder: RkyvEncoder<Point> = structEncoder({
  x: { encoder: f64Encoder },
  y: { encoder: f64Encoder },
});

const PersonDecoder: RkyvDecoder<Person> = struct({
  name: { decoder: string },
  age: { decoder: u32 },
  email: { decoder: option(string) },
  scores: { decoder: vec(u32) },
  active: { decoder: bool },
});

const PersonEncoder: RkyvEncoder<Person> = structEncoder({
  name: { encoder: stringEncoder },
  age: { encoder: u32Encoder },
  email: { encoder: optionEncoder(stringEncoder) },
  scores: { encoder: vecEncoder(u32Encoder) },
  active: { encoder: boolEncoder },
});

// ============================================================================
// Test data
// ============================================================================

const testPoint: Point = {
  x: 42.5,
  y: -17.25,
};

const testPerson: Person = {
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
  scores: [100, 95, 87, 92],
  active: true,
};

const testPersonLarge: Person = {
  name: 'Bob Johnson with a very long name that exceeds inline storage',
  age: 45,
  email: 'bob.johnson.with.a.very.long.email.address@example.com',
  scores: Array.from({ length: 100 }, (_, i) => i * 10),
  active: true,
};

// ============================================================================
// Pre-serialized buffers for decode benchmarks
// ============================================================================

// rkyv buffers
const rkyvPointBytes = toBytes(testPoint, PointEncoder);
const rkyvPersonBytes = toBytes(testPerson, PersonEncoder);
const rkyvPersonLargeBytes = toBytes(testPersonLarge, PersonEncoder);

// Cap'n Proto buffers
function createCapnpPoint(point: Point): ArrayBuffer {
  const message = new capnp.Message();
  const root = message.initRoot(CapnpPoint);
  root.x = point.x;
  root.y = point.y;
  return message.toArrayBuffer();
}

function createCapnpPerson(person: Person): ArrayBuffer {
  const message = new capnp.Message();
  const root = message.initRoot(CapnpPerson);
  root.name = person.name;
  root.age = person.age;
  root.email = person.email ?? '';
  const scores = root._initScores(person.scores.length);
  for (let i = 0; i < person.scores.length; i++) {
    scores[i] = person.scores[i];
  }
  root.active = person.active;
  return message.toArrayBuffer();
}

const capnpPointBuffer = createCapnpPoint(testPoint);
const capnpPersonBuffer = createCapnpPerson(testPerson);
const capnpPersonLargeBuffer = createCapnpPerson(testPersonLarge);

// Create Uint8Array views for capnp (Message constructor accepts ArrayBufferView)
const capnpPointBytes = new Uint8Array(capnpPointBuffer);
const capnpPersonBytes = new Uint8Array(capnpPersonBuffer);
const capnpPersonLargeBytes = new Uint8Array(capnpPersonLargeBuffer);

// JSON buffers (for fair bytes comparison)
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const jsonPointStr = JSON.stringify(testPoint);
const jsonPersonStr = JSON.stringify(testPerson);
const jsonPersonLargeStr = JSON.stringify(testPersonLarge);

const jsonPointBytes = textEncoder.encode(jsonPointStr);
const jsonPersonBytes = textEncoder.encode(jsonPersonStr);
const jsonPersonLargeBytes = textEncoder.encode(jsonPersonLargeStr);

// CBOR buffers
const cborPointBytes = cborEncode(testPoint);
const cborPersonBytes = cborEncode(testPerson);
const cborPersonLargeBytes = cborEncode(testPersonLarge);

// Protobuf buffers
const protoPointBytes = ProtoPoint.encode(ProtoPoint.fromObject(testPoint)).finish();
const protoPersonBytes = ProtoPerson.encode(ProtoPerson.fromObject({
  ...testPerson,
  email: testPerson.email ?? undefined,
})).finish();
const protoPersonLargeBytes = ProtoPerson.encode(ProtoPerson.fromObject({
  ...testPersonLarge,
  email: testPersonLarge.email ?? undefined,
})).finish();

// ============================================================================
// Benchmarks
// ============================================================================

console.log('Buffer sizes comparison:');
console.log('  Point:');
console.log(`    rkyv:   ${rkyvPointBytes.length} bytes`);
console.log(`    capnp:  ${capnpPointBuffer.byteLength} bytes`);
console.log(`    proto:  ${protoPointBytes.length} bytes`);
console.log(`    cbor:   ${cborPointBytes.length} bytes`);
console.log(`    json:   ${jsonPointBytes.length} bytes`);
console.log('  Person (small):');
console.log(`    rkyv:   ${rkyvPersonBytes.length} bytes`);
console.log(`    capnp:  ${capnpPersonBuffer.byteLength} bytes`);
console.log(`    proto:  ${protoPersonBytes.length} bytes`);
console.log(`    cbor:   ${cborPersonBytes.length} bytes`);
console.log(`    json:   ${jsonPersonBytes.length} bytes`);
console.log('  Person (large):');
console.log(`    rkyv:   ${rkyvPersonLargeBytes.length} bytes`);
console.log(`    capnp:  ${capnpPersonLargeBuffer.byteLength} bytes`);
console.log(`    proto:  ${protoPersonLargeBytes.length} bytes`);
console.log(`    cbor:   ${cborPersonLargeBytes.length} bytes`);
console.log(`    json:   ${jsonPersonLargeBytes.length} bytes`);
console.log('');

// Point decode benchmarks (bytes -> object)
summary(() => {
  group('Point decode', () => {
    bench('JSON (bytes)', () => {
      JSON.parse(textDecoder.decode(jsonPointBytes));
    });

    bench('rkyv-js', () => {
      access(rkyvPointBytes, PointDecoder);
    }).baseline();

    bench('cbor-x', () => {
      cborDecode(cborPointBytes);
    });

    bench('protobufjs', () => {
      ProtoPoint.decode(protoPointBytes);
    });

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPointBytes, false);
      const point = message.getRoot(CapnpPoint);
      // Access fields to ensure fair comparison
      void point.x;
      void point.y;
    });
  });
});

// Point encode benchmarks (object -> bytes)
summary(() => {
  group('Point encode', () => {
    bench('JSON (to bytes)', () => {
      textEncoder.encode(JSON.stringify(testPoint));
    });

    bench('rkyv-js', () => {
      toBytes(testPoint, PointEncoder);
    }).baseline();

    bench('cbor-x', () => {
      cborEncode(testPoint);
    });

    bench('protobufjs', () => {
      ProtoPoint.encode(ProtoPoint.fromObject(testPoint)).finish();
    });

    bench('capnp-es', () => {
      createCapnpPoint(testPoint);
    });
  });
});

// Person (small) decode benchmarks (bytes -> object)
summary(() => {
  group('Person (small) decode', () => {
    bench('JSON (bytes)', () => {
      JSON.parse(textDecoder.decode(jsonPersonBytes));
    });

    bench('rkyv-js', () => {
      access(rkyvPersonBytes, PersonDecoder);
    }).baseline();

    bench('cbor-x', () => {
      cborDecode(cborPersonBytes);
    });

    bench('protobufjs', () => {
      ProtoPerson.decode(protoPersonBytes);
    });

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonBytes, false);
      const person = message.getRoot(CapnpPerson);
      // Access all fields
      void person.name;
      void person.age;
      void person.email;
      void person.scores;
      void person.active;
    });
  });
});

// Person (small) encode benchmarks (object -> bytes)
summary(() => {
  group('Person (small) encode', () => {
    bench('JSON (to bytes)', () => {
      textEncoder.encode(JSON.stringify(testPerson));
    });

    bench('rkyv-js', () => {
      toBytes(testPerson, PersonEncoder);
    }).baseline();

    bench('cbor-x', () => {
      cborEncode(testPerson);
    });

    bench('protobufjs', () => {
      ProtoPerson.encode(ProtoPerson.fromObject({
        ...testPerson,
        email: testPerson.email ?? undefined,
      })).finish();
    });

    bench('capnp-es', () => {
      createCapnpPerson(testPerson);
    });
  });
});

// Person (large) decode benchmarks (bytes -> object)
summary(() => {
  group('Person (large) decode', () => {
    bench('JSON (bytes)', () => {
      JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
    });

    bench('rkyv-js', () => {
      access(rkyvPersonLargeBytes, PersonDecoder);
    }).baseline();

    bench('cbor-x', () => {
      cborDecode(cborPersonLargeBytes);
    });

    bench('protobufjs', () => {
      ProtoPerson.decode(protoPersonLargeBytes);
    });

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      // Access all fields
      void person.name;
      void person.age;
      void person.email;
      void person.scores;
      void person.active;
    });
  });
});

// Person (large) encode benchmarks (object -> bytes)
summary(() => {
  group('Person (large) encode', () => {
    bench('JSON (to bytes)', () => {
      textEncoder.encode(JSON.stringify(testPersonLarge));
    });

    bench('rkyv-js', () => {
      toBytes(testPersonLarge, PersonEncoder);
    }).baseline();

    bench('cbor-x', () => {
      cborEncode(testPersonLarge);
    });

    bench('protobufjs', () => {
      ProtoPerson.encode(ProtoPerson.fromObject({
        ...testPersonLarge,
        email: testPersonLarge.email ?? undefined,
      })).finish();
    });

    bench('capnp-es', () => {
      createCapnpPerson(testPersonLarge);
    });
  });
});

// Zero-copy access pattern (rkyv's strength)
summary(() => {
  group('Zero-copy field access (1000 iterations)', () => {
    const iterations = 1000;

    bench('JSON (parse once, access fields)', () => {
      const obj = JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
      for (let i = 0; i < iterations; i++) {
        void obj.name;
        void obj.age;
        void obj.active;
      }
    });

    bench('rkyv-js (decode once, access fields)', () => {
      const person = access(rkyvPersonLargeBytes, PersonDecoder);
      for (let i = 0; i < iterations; i++) {
        void person.name;
        void person.age;
        void person.active;
      }
    }).baseline();

    bench('cbor-x (decode once, access fields)', () => {
      const obj = cborDecode(cborPersonLargeBytes);
      for (let i = 0; i < iterations; i++) {
        void obj.name;
        void obj.age;
        void obj.active;
      }
    });

    bench('protobufjs (decode once, access fields)', () => {
      const obj = ProtoPerson.decode(protoPersonLargeBytes) as unknown as Person;
      for (let i = 0; i < iterations; i++) {
        void obj.name;
        void obj.age;
        void obj.active;
      }
    });

    bench('capnp-es (getRoot once, access fields)', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      for (let i = 0; i < iterations; i++) {
        void person.name;
        void person.age;
        void person.active;
      }
    });
  });
});

// Selective field access (only access some fields)
summary(() => {
  group('Selective field access (name + age only)', () => {
    bench('JSON (bytes)', () => {
      const obj = JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
      void obj.name;
      void obj.age;
    });

    bench('rkyv-js', () => {
      const person = access(rkyvPersonLargeBytes, PersonDecoder);
      void person.name;
      void person.age;
    }).baseline();

    bench('cbor-x', () => {
      const obj = cborDecode(cborPersonLargeBytes);
      void obj.name;
      void obj.age;
    });

    bench('protobufjs', () => {
      const obj = ProtoPerson.decode(protoPersonLargeBytes) as unknown as Person;
      void obj.name;
      void obj.age;
    });

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      void person.name;
      void person.age;
    });
  });
});

await run({
  colors: true,
});
