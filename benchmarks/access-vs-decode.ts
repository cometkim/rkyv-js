import { run, bench, group, summary } from 'mitata';
import { r } from 'rkyv-js';

const PersonCodec = r.object({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

type Person = r.infer<typeof PersonCodec>;

const testPersonLarge: Person = {
  name: 'Bob Johnson with a very long name that exceeds inline storage',
  age: 45,
  email: 'bob.johnson.with.a.very.long.email.address@example.com',
  scores: Array.from({ length: 100 }, (_, i) => i * 10),
  active: true,
};

const rkyvPersonLargeBytes = r.encode(testPersonLarge, PersonCodec);

summary(() => {
  group('rkyv-js: access vs decode (Person large)', () => {
    bench('decode (eager, full object)', () => {
      r.decode(rkyvPersonLargeBytes, PersonCodec);
    }).baseline();

    bench('access (lazy)', () => {
      r.access(rkyvPersonLargeBytes, PersonCodec);
    });

    bench('access + read 1 field', () => {
      const p = r.access(rkyvPersonLargeBytes, PersonCodec);
      void p.name;
    });

    bench('access + read all fields', () => {
      const p = r.access(rkyvPersonLargeBytes, PersonCodec);
      void p.name;
      void p.age;
      void p.email;
      void p.active;
      for (let i = 0; i < p.scores.length; i++) {
        void p.scores[i];
      }
    });
  });
});

await run();
