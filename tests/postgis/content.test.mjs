// PostGIS Quest content: every mission is solvable and honest, the course is well formed, and the extras run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const PQ = load();
const each = f => PQ.CH.forEach((ch, ci) => ch.missions.forEach((m, mi) => f(m, `${ci}.${mi}`, ch, ci)));

test('chapters have a name, badge, story, intro, learned list and missions', () => {
  assert.equal(PQ.CH.length, 7);
  for (const ch of PQ.CH) {
    for (const k of ['name', 'badge', 'story', 'intro']) assert.ok(typeof ch[k] === 'string' && ch[k].trim(), `${ch.name}: ${k}`);
    assert.ok(Array.isArray(ch.learned) && ch.learned.length, `${ch.name}: learned`);
    assert.ok(ch.missions.length >= 5, `${ch.name}: missions`);
  }
});

test('every mission has its fields, and 3 to 5 how steps', () => {
  each((m, k) => {
    for (const f of ['title', 'goal', 'explain', 'hint', 'answer']) assert.ok(typeof m[f] === 'string' && m[f].trim(), `${k}: ${f}`);
    assert.equal(typeof m.check, 'function', `${k}: check`);
    assert.ok(Array.isArray(m.anat) && m.anat.length, `${k}: anat`);
    assert.ok(Array.isArray(m.how) && m.how.length >= 3 && m.how.length <= 5, `${k}: how`);
    assert.ok(Array.isArray(m.wrong) && m.wrong.length >= 2, `${k}: at least two wrong queries`);
    for (const [, kind] of m.anat) assert.ok(kind in PQ.KINDS, `${k}: chip kind ${kind}`);
  });
});

test('every reference answer runs and passes its own check', () => {
  each((m, k) => assert.equal(PQ.runMission(m, m.answer), true, `${k} ${m.title}`));
});

test('every wrong query fails its check', () => {
  each((m, k) => { for (const w of m.wrong) assert.notEqual(PQ.runMission(m, w), true, `${k} should reject: ${w}`); });
});

test('an empty editor, a comment, an error and an earlier mission\'s answer fail', () => {
  const all = PQ.CH.flatMap(c => c.missions);
  each((m, k) => {
    for (const s of ['', '-- nothing yet', 'SELECT nme FROM places;']) assert.notEqual(PQ.runMission(m, s), true, `${k}: ${JSON.stringify(s)}`);
    const i = all.indexOf(m);
    if (i > 0 && all[i - 1].answer !== m.answer) assert.notEqual(PQ.runMission(m, all[i - 1].answer), true, `${k}: the previous answer must not pass`);
  });
});

test('a failed check says why, in a sentence', () => {
  each((m, k) => { for (const w of m.wrong) { const r = PQ.runMission(m, w); assert.ok(typeof r === 'string' && r.length > 20, `${k}: ${w} -> ${r}`); } });
});

test('ranks: rising, starting at 0, and the top title needs every mission', () => {
  const total = PQ.CH.reduce((s, c) => s + c.missions.length, 0) * PQ.XP;
  assert.equal(PQ.RANKS[0][0], 0);
  PQ.RANKS.forEach((r, i) => i && assert.ok(r[0] > PQ.RANKS[i - 1][0]));
  assert.equal(PQ.RANKS.at(-1)[0], total);
});

test('quick-fire questions are well formed and point at real chapters', () => {
  for (const q of PQ.QF) {
    assert.ok(Number.isInteger(q.ch) && q.ch >= 0 && q.ch < PQ.CH.length, q.c);
    assert.ok(q.a && q.why && q.w.length === 3 && !q.w.includes(q.a), q.c);
  }
  PQ.CH.forEach((_, i) => assert.ok(PQ.QF.filter(q => q.ch === i).length >= 4, `chapter ${i} quick-fire`));
});

test('every field guide example runs without an error', () => {
  for (const g of PQ.GUIDE) {
    assert.ok(Number.isInteger(g.ch) && g.ch < PQ.CH.length, g.c);
    for (const [q] of g.ex) { const r = PQ.run(PQ.freshDb(), q); assert.ok(r.ok, `${g.c}: ${q}: ${r.error && r.error.message}`); }
  }
});
