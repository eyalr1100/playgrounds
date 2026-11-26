// PostGIS Quest engine: SQL errors in PostgreSQL's words, geometry in and out, the predicates on the edge cases the world
// is built around, clustering, and the caps that keep a runaway query from freezing the page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, sql } from './harness.mjs';

const PQ = loadEngine();
const q = s => sql(PQ, s);
const err = s => { const r = PQ.run(PQ.freshDb(), s); assert.equal(r.ok, false, s); return r.error.message; };
const G = PQ.geo, R = PQ.relate;
const g = w => G.parse(w);

describe('SQL', () => {
  it('reads tables, columns, WHERE, ORDER BY, LIMIT and count', () => {
    assert.equal(q("SELECT name FROM places WHERE kind = 'harbor';"), 'Harbor');
    assert.equal(q('SELECT name FROM wells ORDER BY depth_m DESC LIMIT 2;'), 'Hilltop Well\nOak Well');
    assert.equal(q('SELECT count(*) FROM wells WHERE depth_m > 10;'), '4');
    assert.equal(q('select NAME from PLACES where ID = 1'), 'Harbor', 'identifiers fold to lower case');
  });
  it('errors use PostgreSQL\'s wording and point at the spot', () => {
    assert.equal(err('SELECT name FORM places'), 'syntax error at or near "places"');
    assert.equal(err('SELECT name FROM'), 'syntax error at end of input');
    assert.equal(err('SELECT nme FROM places'), 'column "nme" does not exist');
    assert.equal(err('SELECT * FROM plcaes'), 'relation "plcaes" does not exist');
    assert.equal(err('SELECT name FROM wells w, zones z'), 'column reference "name" is ambiguous');
    assert.equal(err('SELECT st_contain(geom, geom) FROM zones'), 'function st_contain(geometry, geometry) does not exist');
    assert.equal(err('SELECT round(ST_Area(geom), 4) FROM zones'), 'function round(double precision, integer) does not exist');
    assert.equal(err('SELECT name, count(*) FROM wells'), 'column "wells.name" must appear in the GROUP BY clause or be used in an aggregate function');
    assert.equal(err("SELECT 'a"), 'unterminated quoted string at or near "\'a"');
    assert.equal(err('SELECT ST_ClusterKMeans(geom, 3) FROM stones'), 'window function st_clusterkmeans requires an OVER clause');
    assert.equal(err('SELECT id FROM stones WHERE ST_ClusterKMeans(geom, 3) OVER () = 0'), 'window functions are not allowed in WHERE');
    assert.equal(err('SELECT id FROM wells WHERE count(*) > 1'), 'aggregate functions are not allowed in WHERE');
    assert.equal(err("SELECT ST_Intersects(ST_MakePoint(-40, 35), geom) FROM zones"), 'ST_Intersects: Operation on mixed SRID geometries (Point, 0) != (Polygon, 4326)');
    const r = PQ.run(PQ.freshDb(), 'SELECT nme FROM places');
    assert.equal(PQ.errorText('SELECT nme FROM places', r.error).split('\n')[2], '               ^');
  });
  it('refuses what it does not support, saying so', () => {
    assert.match(err('DELETE FROM places'), /SELECT queries only/);
    assert.match(err('SELECT 1 UNION SELECT 2'), /does not support UNION/);
    assert.match(err('SELECT geom::geography FROM places'), /no geography type/);
  });
  it('joins, groups, windows and WITH', () => {
    assert.equal(q('SELECT z.name, count(w.id) FROM zones z LEFT JOIN wells w ON ST_Contains(z.geom, w.geom) GROUP BY z.name ORDER BY 2 DESC, 1 LIMIT 2;'), 'Gullhaven Village|2\nWhispering Woods|2');
    assert.equal(q('WITH c AS (SELECT id FROM wells WHERE depth_m > 10) SELECT count(*) FROM c;'), '4');
    assert.equal(q('SELECT count(*) FROM (SELECT id FROM wells) AS s;'), '9');
    assert.equal(q("SELECT name FROM wells WHERE ST_Contains((SELECT geom FROM zones WHERE name = 'Whispering Woods'), geom) ORDER BY name;"), 'Fern Well\nOak Well');
    assert.equal(q('SELECT id, row_number() OVER (ORDER BY depth_m DESC) FROM wells ORDER BY 2 LIMIT 1;'), '8|1');
  });
  it('prints values the way psql does', () => {
    assert.equal(q("SELECT ST_GeomFromText('POINT(1 2)', 4326);"), '0101000020E6100000000000000000F03F0000000000000040');
    assert.equal(q('SELECT ST_MakePoint(1, 2);'), '0101000000000000000000F03F0000000000000040');
    assert.equal(q('SELECT 1 = 1, 7 / 2, 7.0 / 2;'), 't|3|3.5');
    assert.equal(PQ.showFloat(0.00008), '8e-05');
    assert.equal(q('SELECT NULL IS NULL, NULL = NULL;'), 't|');
  });
  it('caps a runaway query with one error line', () => {
    assert.match(err('SELECT count(*) FROM stones a, stones b, stones c, stones d, stones e'), /stops a join at|ran too long/);
    assert.match(err('SELECT ' + '('.repeat(200) + '1' + ')'.repeat(200)), /nested/);
    assert.match(err('SELECT ' + "'x' || ".repeat(4000) + "'x'"), /characters/);
    assert.equal(PQ.run(PQ.freshDb(), '').ok, true);
  });
});

describe('geometry', () => {
  it('reads and writes WKT, EWKT and hex EWKB', () => {
    assert.equal(G.wkt(g('POLYGON((0 0, 1 0, 1 1, 0 0))')), 'POLYGON((0 0,1 0,1 1,0 0))');
    assert.equal(G.ewkt(g('SRID=4326;POINT(-40 35)')), 'SRID=4326;POINT(-40 35)');
    assert.equal(G.wkt(G.fromHex('0101000020E6100000000000000000F03F0000000000000040')), 'POINT(1 2)');
    assert.throws(() => g('POLYGON((0 0, 1 0, 1 1))'), /requires more points/);
    assert.throws(() => g('POLYGON((0 0, 1 0, 1 1, 0 1))'), /non-closed rings/);
    assert.throws(() => g('POINT(1 2 3)'), /2D/);
    assert.throws(() => g('POINT(1, 2)'), /parse error/);
  });
  it('measures', () => {
    assert.equal(G.area(g('POLYGON((0 0, 4 0, 4 4, 0 4, 0 0),(1 1, 2 1, 2 2, 1 2, 1 1))')), 15);
    assert.equal(G.length(g('LINESTRING(0 0, 3 4, 3 10)')), 11);
    assert.equal(G.perimeter(g('POLYGON((0 0, 2 0, 2 2, 0 2, 0 0))')), 8);
    assert.deepEqual([...G.centroid(g('POLYGON((0 0, 2 0, 2 2, 0 2, 0 0))')).c], [1, 1]);
    assert.deepEqual([...G.centroid(g('MULTIPOINT(0 0, 2 0, 4 6)')).c], [2, 2]);
    assert.equal(G.wkt(G.hull(g('MULTIPOINT(0 0, 2 0, 1 1, 2 2, 0 2)'))), 'POLYGON((0 0,0 2,2 2,2 0,0 0))');
    assert.equal(G.buffer(g('POINT(0 0)'), 1).c[0].length, 33);
    assert.ok(Math.abs(G.sphere(g('POINT(0 0)'), g('POINT(1 0)')) - 6370986 * Math.PI / 180) < 1e-6);
  });
});

describe('predicates', () => {
  const sq = g('POLYGON((0 0, 4 0, 4 4, 0 4, 0 0))');
  const CASES = [
    // [a, b, intersects, contains(a,b), within(a,b), touches, crosses, overlaps]
    [sq, g('POINT(2 2)'), true, true, false, false, false, false],
    [sq, g('POINT(4 2)'), true, false, false, true, false, false],
    [sq, g('POINT(5 5)'), false, false, false, false, false, false],
    [sq, g('POLYGON((4 0, 8 0, 8 4, 4 4, 4 0))'), true, false, false, true, false, false],
    [sq, g('POLYGON((4 4, 8 4, 8 8, 4 8, 4 4))'), true, false, false, true, false, false],
    [sq, g('POLYGON((1 1, 2 1, 2 2, 1 2, 1 1))'), true, true, false, false, false, false],
    [sq, g('POLYGON((2 2, 6 2, 6 6, 2 6, 2 2))'), true, false, false, false, false, true],
    [sq, sq, true, true, true, false, false, false],
    [sq, g('LINESTRING(-1 2, 5 2)'), true, false, false, false, true, false],
    [sq, g('LINESTRING(1 1, 3 3)'), true, true, false, false, false, false],
    [sq, g('LINESTRING(4 1, 4 3)'), true, false, false, true, false, false],
    [g('LINESTRING(0 0, 2 2)'), g('LINESTRING(0 2, 2 0)'), true, false, false, false, true, false],
    [g('LINESTRING(0 0, 2 0)'), g('LINESTRING(2 0, 4 0)'), true, false, false, true, false, false],
    [g('LINESTRING(0 0, 3 0)'), g('LINESTRING(1 0, 5 0)'), true, false, false, false, false, true],
  ];
  CASES.forEach(([a, b, ...want], i) => it(`case ${i}: ${G.wkt(b)}`, () => {
    assert.deepEqual([R.intersects(a, b), R.contains(a, b), R.within(a, b), R.touches(a, b), R.crosses(a, b), R.overlaps(a, b)], want);
  }));
  it('a hole is outside', () => {
    const donut = g('POLYGON((0 0, 6 0, 6 6, 0 6, 0 0),(2 2, 4 2, 4 4, 2 4, 2 2))');
    assert.equal(R.contains(donut, g('POINT(3 3)')), false);
    assert.equal(R.contains(donut, g('POINT(1 1)')), true);
    assert.equal(R.contains(donut, g('POLYGON((1 1, 5 1, 5 5, 1 5, 1 1))')), false);
    assert.equal(R.touches(donut, g('POINT(2 3)')), true);
  });
  it('distance is 0 when shapes meet, the gap otherwise', () => {
    assert.equal(R.distance(sq, g('POINT(2 2)')), 0);
    assert.equal(R.distance(sq, g('POINT(7 8)')), 5);
    assert.equal(R.distance(g('LINESTRING(0 0, 0 10)'), g('LINESTRING(3 5, 9 5)')), 3);
  });
  it('the world\'s edge cases come out as the course says', () => {
    assert.equal(q("SELECT p.name FROM places p, zones z WHERE z.name = 'Gullhaven Village' AND ST_Intersects(p.geom, z.geom) AND NOT ST_Within(p.geom, z.geom);"), 'Village Gate');
    assert.equal(q("SELECT b.name FROM zones a, zones b WHERE a.name = 'Gullhaven Village' AND ST_Touches(a.geom, b.geom) ORDER BY 1;"), 'Clover Meadow\nWhispering Woods');
    assert.equal(q('SELECT count(*) FROM zones a, zones b WHERE ST_Contains(a.geom, b.geom);'), '7');
    assert.equal(q('SELECT count(*) FROM island i, places p WHERE ST_Contains(i.geom, p.geom);'), '10');
    assert.equal(q('SELECT count(*) FROM island i, wells w WHERE ST_Contains(i.geom, w.geom);'), '9');
    assert.equal(q('SELECT count(*) FROM island i, stones s WHERE ST_Contains(i.geom, s.geom);'), '20');
  });
});

describe('clustering', () => {
  it('DBSCAN finds three groups and two loners, numbered in row order', () => {
    const out = q('SELECT ST_ClusterDBSCAN(geom, eps := 0.01, minpoints := 3) OVER () FROM stones ORDER BY id;').split('\n');
    assert.deepEqual(out, [...Array(6).fill('0'), ...Array(7).fill('1'), ...Array(5).fill('2'), '', '']);
  });
  it('k-means makes exactly k groups, the same way every time', () => {
    const a = q('SELECT ST_ClusterKMeans(geom, 3) OVER () FROM stones ORDER BY id;'), b = q('SELECT ST_ClusterKMeans(geom, 3) OVER () FROM stones ORDER BY id;');
    assert.equal(a, b);
    assert.equal(new Set(a.split('\n')).size, 3);
  });
  it('the treasure is the Wishing Well', () => {
    assert.equal(q('WITH c AS (SELECT ST_ClusterDBSCAN(geom, eps := 0.01, minpoints := 3) OVER () AS cid, geom FROM stones), centre AS (SELECT ST_Centroid(ST_Collect(geom)) AS geom FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY count(*) DESC LIMIT 1) SELECT w.name FROM wells w, centre ORDER BY w.geom <-> centre.geom LIMIT 1;'), 'Wishing Well');
  });
});
