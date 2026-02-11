import { run, bench, group, summary } from 'mitata';
import * as capnp from 'capnp-es';
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

import * as r from 'rkyv-js';

import { Point as CapnpPoint, Person as CapnpPerson } from './capnp/schema.ts';
import { Point as ProtoPoint, Person as ProtoPerson } from './protobuf/schema.ts';

const ArchivedPoint = r.struct({
  x: r.f64,
  y: r.f64,
});

type Point = r.Infer<typeof ArchivedPoint>;

const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

type Person = r.Infer<typeof ArchivedPerson>;

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

const rkyvPointBytes = r.encode(ArchivedPoint, testPoint);
const rkyvPersonBytes = r.encode(ArchivedPerson, testPerson);
const rkyvPersonLargeBytes = r.encode(ArchivedPerson, testPersonLarge);

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

const capnpPointBytes = new Uint8Array(capnpPointBuffer);
const capnpPersonBytes = new Uint8Array(capnpPersonBuffer);
const capnpPersonLargeBytes = new Uint8Array(capnpPersonLargeBuffer);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const jsonPointStr = JSON.stringify(testPoint);
const jsonPointBytes = textEncoder.encode(jsonPointStr);
const jsonPersonStr = JSON.stringify(testPerson);
const jsonPersonBytes = textEncoder.encode(jsonPersonStr);
const jsonPersonLargeStr = JSON.stringify(testPersonLarge);
const jsonPersonLargeBytes = textEncoder.encode(jsonPersonLargeStr);

const cborPointBytes = cborEncode(testPoint);
const cborPersonBytes = cborEncode(testPerson);
const cborPersonLargeBytes = cborEncode(testPersonLarge);

const protoPointBytes = ProtoPoint.encode(ProtoPoint.fromObject(testPoint)).finish();
const protoPersonBytes = ProtoPerson.encode(ProtoPerson.fromObject({
  ...testPerson,
  email: testPerson.email ?? undefined,
})).finish();
const protoPersonLargeBytes = ProtoPerson.encode(ProtoPerson.fromObject({
  ...testPersonLarge,
  email: testPersonLarge.email ?? undefined,
})).finish();

console.log('Buffer sizes comparison:');
console.log('  Point:');
console.log(`    rkyv:   ${rkyvPointBytes.byteLength} bytes`);
console.log(`    capnp:  ${capnpPointBuffer.byteLength} bytes`);
console.log(`    proto:  ${protoPointBytes.byteLength} bytes`);
console.log(`    cbor:   ${cborPointBytes.byteLength} bytes`);
console.log(`    json:   ${jsonPointBytes.byteLength} bytes`);
console.log('  Person (small):');
console.log(`    rkyv:   ${rkyvPersonBytes.byteLength} bytes`);
console.log(`    capnp:  ${capnpPersonBuffer.byteLength} bytes`);
console.log(`    proto:  ${protoPersonBytes.byteLength} bytes`);
console.log(`    cbor:   ${cborPersonBytes.byteLength} bytes`);
console.log(`    json:   ${jsonPersonBytes.byteLength} bytes`);
console.log('  Person (large):');
console.log(`    rkyv:   ${rkyvPersonLargeBytes.byteLength} bytes`);
console.log(`    capnp:  ${capnpPersonLargeBuffer.byteLength} bytes`);
console.log(`    proto:  ${protoPersonLargeBytes.byteLength} bytes`);
console.log(`    cbor:   ${cborPersonLargeBytes.byteLength} bytes`);
console.log(`    json:   ${jsonPersonLargeBytes.byteLength} bytes`);
console.log('');

summary(() => {
  group('Point decode', () => {
    bench('JSON (bytes)', () => {
      JSON.parse(textDecoder.decode(jsonPointBytes));
    }).gc('inner');

    bench('rkyv-js decode', () => {
      r.decode(ArchivedPoint, rkyvPointBytes);
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      cborDecode(cborPointBytes);
    }).gc('inner');

    bench('protobufjs', () => {
      ProtoPoint.decode(protoPointBytes);
    }).gc('inner');

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPointBytes, false);
      const point = message.getRoot(CapnpPoint);
      // Access fields to ensure fair comparison
      void point.x;
      void point.y;
    }).gc('inner');
  });
});

summary(() => {
  group('Point encode', () => {
    bench('JSON (bytes)', () => {
      textEncoder.encode(JSON.stringify(testPoint));
    }).gc('inner');

    bench('rkyv-js', () => {
      r.encode(ArchivedPoint, testPoint);
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      cborEncode(testPoint);
    }).gc('inner');

    bench('protobufjs', () => {
      ProtoPoint.encode(ProtoPoint.fromObject(testPoint)).finish();
    }).gc('inner');

    bench('capnp-es', () => {
      createCapnpPoint(testPoint);
    }).gc('inner');
  });
});

summary(() => {
  group('Person (small) decode', () => {
    bench('JSON (bytes)', () => {
      JSON.parse(textDecoder.decode(jsonPersonBytes));
    }).gc('inner');

    bench('rkyv-js decode', () => {
      r.decode(ArchivedPerson, rkyvPersonBytes);
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      cborDecode(cborPersonBytes);
    }).gc('inner');

    bench('protobufjs', () => {
      ProtoPerson.decode(protoPersonBytes);
    }).gc('inner');

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonBytes, false);
      const person = message.getRoot(CapnpPerson);
      // Access all fields
      void person.name;
      void person.age;
      void person.email;
      void person.scores;
      void person.active;
    }).gc('inner');
  });
});

summary(() => {
  group('Person (small) encode', () => {
    bench('JSON (bytes)', () => {
      textEncoder.encode(JSON.stringify(testPerson));
    }).gc('inner');

    bench('rkyv-js', () => {
      r.encode(ArchivedPerson, testPerson);
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      cborEncode(testPerson);
    }).gc('inner');

    const testPersonUndefined = {
      ...testPerson,
      email: testPerson.email ?? undefined,
    };
    bench('protobufjs', () => {
      ProtoPerson.encode(ProtoPerson.fromObject(testPersonUndefined)).finish();
    }).gc('inner');

    bench('capnp-es', () => {
      createCapnpPerson(testPerson);
    }).gc('inner');
  });
});

summary(() => {
  group('Person (large) decode', () => {
    bench('JSON (bytes)', () => {
      JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
    }).gc('inner');

    bench('rkyv-js decode', () => {
      r.decode(ArchivedPerson, rkyvPersonLargeBytes);
    }).gc('inner').baseline();

    bench('rkyv-js access', () => {
      r.access(ArchivedPerson, rkyvPersonLargeBytes);
    }).gc('inner');

    bench('cbor-x', () => {
      cborDecode(cborPersonLargeBytes);
    }).gc('inner');

    bench('protobufjs', () => {
      ProtoPerson.decode(protoPersonLargeBytes);
    }).gc('inner');

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      // Access all fields
      void person.name;
      void person.age;
      void person.email;
      void person.scores;
      void person.active;
    }).gc('inner');
  });
});

summary(() => {
  group('Person (large) encode', () => {
    bench('JSON (bytes)', () => {
      textEncoder.encode(JSON.stringify(testPersonLarge));
    }).gc('inner');

    bench('rkyv-js', () => {
      r.encode(ArchivedPerson, testPersonLarge);
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      cborEncode(testPersonLarge);
    }).gc('inner');

    const testPersonLargeUndefined = {
      ...testPersonLarge,
      email: testPersonLarge.email ?? undefined,
    };
    bench('protobufjs', () => {
      ProtoPerson.encode(ProtoPerson.fromObject(testPersonLargeUndefined)).finish();
    }).gc('inner');

    bench('capnp-es', () => {
      createCapnpPerson(testPersonLarge);
    }).gc('inner');
  });
});

summary(() => {
  group('Field access after decode (1000 iterations)', () => {
    const iterations = 1000;

    bench('JSON (bytes)', () => {
      const obj = JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
      for (let i = 0; i < iterations; i++) {
        void obj.name;
        void obj.age;
        void obj.active;
      }
    }).gc('inner');

    bench('rkyv-js decode', () => {
      const person = r.decode(ArchivedPerson, rkyvPersonLargeBytes);
      for (let i = 0; i < iterations; i++) {
        void person.name;
        void person.age;
        void person.active;
      }
    }).gc('inner').baseline();

    bench('rkyv-js access', () => {
      const person = r.access(ArchivedPerson, rkyvPersonLargeBytes);
      for (let i = 0; i < iterations; i++) {
        void person.name;
        void person.age;
        void person.active;
      }
    }).gc('inner');

    bench('cbor-x', () => {
      const obj = cborDecode(cborPersonLargeBytes);
      for (let i = 0; i < iterations; i++) {
        void obj.name;
        void obj.age;
        void obj.active;
      }
    }).gc('inner');

    bench('protobufjs', () => {
      const obj = ProtoPerson.decode(protoPersonLargeBytes) as unknown as Person;
      for (let i = 0; i < iterations; i++) {
        void obj.name;
        void obj.age;
        void obj.active;
      }
    }).gc('inner');

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      for (let i = 0; i < iterations; i++) {
        void person.name;
        void person.age;
        void person.active;
      }
    }).gc('inner');
  });
});

summary(() => {
  group('Selective field access (name + age only)', () => {
    bench('JSON (bytes)', () => {
      const obj = JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
      void obj.name;
      void obj.age;
    }).gc('inner');

    bench('rkyv-js decode', () => {
      const person = r.decode(ArchivedPerson, rkyvPersonLargeBytes);
      void person.name;
      void person.age;
    }).gc('inner');

    bench('rkyv-js access', () => {
      const person = r.access(ArchivedPerson, rkyvPersonLargeBytes);
      void person.name;
      void person.age;
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      const obj = cborDecode(cborPersonLargeBytes);
      void obj.name;
      void obj.age;
    }).gc('inner');

    bench('protobufjs', () => {
      const obj = ProtoPerson.decode(protoPersonLargeBytes) as unknown as Person;
      void obj.name;
      void obj.age;
    }).gc('inner');

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      void person.name;
      void person.age;
    }).gc('inner');
  });
});

// Partial array access - only access first few elements of large array
summary(() => {
  group('Partial array access (first 3 of 100 scores)', () => {
    bench('JSON (bytes)', () => {
      const obj = JSON.parse(textDecoder.decode(jsonPersonLargeBytes));
      void obj.scores[0];
      void obj.scores[1];
      void obj.scores[2];
    }).gc('inner');

    bench('rkyv-js decode', () => {
      const person = r.decode(ArchivedPerson, rkyvPersonLargeBytes);
      void person.scores[0];
      void person.scores[1];
      void person.scores[2];
    }).gc('inner');

    bench('rkyv-js access (lazy)', () => {
      const person = r.access(ArchivedPerson, rkyvPersonLargeBytes);
      void person.scores[0];
      void person.scores[1];
      void person.scores[2];
    }).gc('inner').baseline();

    bench('cbor-x', () => {
      const obj = cborDecode(cborPersonLargeBytes);
      void obj.scores[0];
      void obj.scores[1];
      void obj.scores[2];
    }).gc('inner');

    bench('protobufjs', () => {
      const obj = ProtoPerson.decode(protoPersonLargeBytes) as unknown as Person;
      void obj.scores[0];
      void obj.scores[1];
      void obj.scores[2];
    }).gc('inner');

    bench('capnp-es', () => {
      const message = new capnp.Message(capnpPersonLargeBytes, false);
      const person = message.getRoot(CapnpPerson);
      void person.scores.get(0);
      void person.scores.get(1);
      void person.scores.get(2);
    }).gc('inner');
  });
});

await run();
