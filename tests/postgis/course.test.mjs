// PostGIS Quest course rules: own action only (AGENTS.md rule 5), code in prose (rule 10) and teach before use (rule 12).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

const PQ = load();
const flat = [];
PQ.CH.forEach((c, ci) => c.missions.forEach((m, mi) => flat.push({ m, ci, mi })));

// A check reads only the query just run. These plain queries teach none of the missions on their own.
const UNRELATED = ['SELECT * FROM places;', 'SELECT 1;', 'SELECT count(*) FROM stones;', 'SELECT name, geom FROM zones;', 'SELECT * FROM wells;'];
describe('an unrelated query never completes a mission', () => {
  for (const { m, ci, mi } of flat) it(`${ci}.${mi} ${m.title}`, () => {
    for (const s of UNRELATED.filter(s => s !== m.answer)) assert.notEqual(PQ.runMission(m, s), true, s);
  });
});
describe('every check depends only on its own run', () => {
  it('a session that passed and then ran something else is judged on the new run', () => {
    const m = PQ.CH[0].missions[0], s = PQ.session(m);
    s.run(m.answer); assert.equal(s.check(), true);
    s.run('SELECT 1;'); assert.notEqual(s.check(), true);
  });
});

// Code in prose: PostGIS functions and SQL keywords in learner text are <code>.
const prose = h => String(h).replace(/<code>.*?<\/code>|<kbd>.*?<\/kbd>/gs, '§').replace(/<[^>]+>/g, ' ');
const RULES = [
  ['function', /\bST_[A-Za-z]+/],
  ['keyword', /\b(?:SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|LEFT JOIN|JOIN|WITH|OVER|DESC|IS NULL|IS NOT NULL)\b/],
  ['call', /\b(?:count|round)\(/],
  ['cast', /::numeric/],
];
const bare = t => RULES.flatMap(([what, re]) => { const p = prose(t), m = re.exec(p); return m ? [`${what} "${m[0]}" in …${p.slice(Math.max(0, m.index - 30), m.index + 30)}…`] : []; });
describe('learner text keeps functions and keywords in <code>', () => {
  it('the rule bites', () => {
    assert.equal(bare('use ST_Contains here').length, 1);
    assert.equal(bare('use <code>ST_Contains</code> here').length, 0);
    assert.equal(bare('sort with ORDER BY').length, 1);
  });
  PQ.CH.forEach((ch, ci) => {
    it(`chapter ${ci + 1} intro and story`, () => assert.deepEqual([ch.intro, ch.story].flatMap(bare), []));
    ch.missions.forEach((m, mi) => it(`${ci}.${mi} ${m.title}`, () => assert.deepEqual([m.goal, m.explain, m.hint, m.note, ...m.how].filter(Boolean).flatMap(bare), [])));
  });
  it('field guide text', () => assert.deepEqual([...PQ.GUIDE].flatMap(g => bare(g.what)), []));
});

// Teach before use: no mission card uses a term before the mission that teaches it (its own card may).
const plain = t => String(t).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const card = m => plain([m.title, m.goal, m.hint, m.explain, m.note, ...m.how, ...m.anat.map(a => a[0] + ' ' + (a[2] || ''))].filter(Boolean).join('\n'));
const FIRST = {
  'ORDER BY': [/ORDER BY/, 0, 3], DESC: [/\bDESC\b/, 0, 4], LIMIT: [/\bLIMIT\b/, 0, 4], 'count(*)': [/count\(/, 0, 5],
  geometry: [/\bgeometr/i, 1, 0], ST_AsText: [/ST_AsText/, 1, 1], WKT: [/\bWKT\b/, 1, 1], longitude: [/longitude/i, 1, 2], AS: [/\bAS\b/, 1, 2],
  SRID: [/\bSRID\b/, 1, 3], 4326: [/4326/, 1, 3], ST_MakePoint: [/ST_MakePoint/, 1, 4], ST_SetSRID: [/ST_SetSRID/, 1, 4], ST_GeomFromText: [/ST_GeomFromText/, 1, 5],
  LINESTRING: [/LINESTRING/, 2, 0], ST_Length: [/ST_Length/, 2, 1], POLYGON: [/POLYGON/, 2, 2], ring: [/\bring\b/i, 2, 2],
  ST_Area: [/ST_Area/, 2, 3], round: [/round\(/, 2, 3], numeric: [/numeric/, 2, 3], ST_Centroid: [/ST_Centroid/, 2, 4], ST_GeometryType: [/ST_GeometryType/, 2, 5],
  AND: [/\bAND\b/, 3, 1], ST_Contains: [/ST_Contains/, 3, 1], ST_Within: [/ST_Within/, 3, 2], ST_Intersects: [/ST_Intersects/, 3, 3],
  NOT: [/\bNOT\b/, 3, 4], interior: [/\binterior\b/i, 3, 4], ST_Touches: [/ST_Touches/, 3, 5], '<>': [/<>/, 3, 6],
  ST_Distance: [/ST_Distance\b/, 4, 0], ST_DistanceSphere: [/ST_DistanceSphere/, 4, 1], 'nearest neighbour': [/nearest neighbour/i, 4, 2],
  '<->': [/<->/, 4, 3], 'spatial index': [/spatial index/i, 4, 3], ST_DWithin: [/ST_DWithin/, 4, 4], ST_Buffer: [/ST_Buffer/, 4, 5],
  JOIN: [/\bJOIN\b/, 5, 0], 'GROUP BY': [/GROUP BY/, 5, 1], 'LEFT JOIN': [/LEFT JOIN/, 5, 2], NULL: [/\bNULL\b/, 5, 2],
  ST_Collect: [/ST_Collect/, 5, 3], MultiPoint: [/multipoint/i, 5, 3], ST_ConvexHull: [/ST_ConvexHull/, 5, 4],
  OVER: [/\bOVER\b/, 6, 0], 'window function': [/window function/i, 6, 0], ST_ClusterKMeans: [/ST_ClusterKMeans/, 6, 0], cluster: [/\bcluster/i, 6, 0],
  WITH: [/\bWITH\b/, 6, 1], ST_ClusterDBSCAN: [/ST_ClusterDBSCAN|DBSCAN/, 6, 2], 'IS NULL': [/IS NULL/, 6, 3],
};
describe('teach before use', () => {
  for (const [term, [re, ci, mi]] of Object.entries(FIRST)) it(term, () => {
    assert.ok(re.test(card(PQ.CH[ci].missions[mi])), `${term} is not on the card of ${ci}.${mi} that should teach it`);
    const early = flat.filter(x => x.ci < ci || (x.ci === ci && x.mi < mi)).filter(x => re.test(card(x.m)));
    assert.deepEqual(early.map(x => `${x.ci}.${x.mi}`), [], `${term} is used before ${ci}.${mi}`);
  });
  it('quick-fire and guide entries only ask about their own chapter or earlier', () => {
    for (const [term, [re, ci]] of Object.entries(FIRST)) {
      for (const q of PQ.QF) if (q.ch < ci) assert.ok(!re.test(plain([q.c, q.a, ...q.w, q.why].join(' '))), `quick-fire of chapter ${q.ch} uses ${term}: ${q.c}`);
      for (const g of PQ.GUIDE) if (g.ch < ci) assert.ok(!re.test(plain(g.what + ' ' + g.ex.map(e => e.join(' ')).join(' '))), `guide entry ${g.c} uses ${term}`);
    }
  });
});
