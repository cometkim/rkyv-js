import { run, bench, group, summary } from 'mitata';
import * as r from 'rkyv-js';

const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

type Person = r.Infer<typeof ArchivedPerson>;

const testPersonLarge: Person = {
  name: 'Bob Johnson with a very long name that exceeds inline storage',
  age: 45,
  email: 'bob.johnson.with.a.very.long.email.address@example.com',
  scores: Array.from({ length: 100 }, (_, i) => i * 10),
  active: true,
};

const rkyvPersonLargeBytes = ArchivedPerson.encode(testPersonLarge);

summary(() => {
  group('rkyv-js: access vs decode (Person large)', () => {
    bench('decode (eager, full object)', () => {
      void ArchivedPerson.decode(rkyvPersonLargeBytes);
    }).baseline();

    bench('access (lazy)', () => {
      void ArchivedPerson.access(rkyvPersonLargeBytes);
    });

    bench('access + read 1 field', () => {
      const p = ArchivedPerson.access(rkyvPersonLargeBytes);
      void p.name;
    });

    bench('access + read all fields', () => {
      const p = ArchivedPerson.access(rkyvPersonLargeBytes);
      void p.name;
      void p.age;
      void p.email;
      void p.active;
      for (let i = 0; i < p.scores.length; i++) {
        void p.scores.at(i);
      }
    });
  });
});

await run({
  ...(process.env.NO_COLOR ? { colors: false } : {}),
  ...(process.env.MITATA_FORMAT ? { format: process.env.MITATA_FORMAT as 'json' } : {}),
});
