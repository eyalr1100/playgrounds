# PostGIS Quest (`programming/postgis-quest/`) design

Date: 2026-11-26. Status: design. Plan: `docs/superpowers/plans/2026-11-26-postgis-quest-phase1.md`.

## Goal

A new playground that teaches spatial SQL with PostGIS by doing: geometry types and WKT, SRID 4326, the spatial predicates (`ST_Intersects`, `ST_Contains`, `ST_Within`, `ST_Touches`, ...), measuring (`ST_Distance`, `ST_DistanceSphere`, `ST_Area`, `ST_Length`), nearness (`ST_DWithin`, `<->`, `ST_Buffer`), spatial joins and aggregates (`ST_Collect`, `ST_ConvexHull`, `ST_Centroid`) and clustering (`ST_ClusterDBSCAN`, `ST_ClusterKMeans`). Same quest format as the others: chapters of missions with honest checks, quick-fire, field guide, XP and ranks.

Learners type SQL into an editor, run it against a **simulated PostGIS database** of a small island, and see the result twice: as a **table** (like `psql`) and drawn on a **map** of the island, where every geometry in the result is highlighted on top of the island's own layers. Nothing talks to a real database.

## Decisions

- **Own small engine, no dependency.** Real PostGIS in the browser (PGlite plus the PostGIS extension, several MB of WASM from a CDN) breaks AGENTS.md hard rule 1, would need its own issue and would not bundle for claude.ai artifacts. The engine is a DOM-free subset of PostgreSQL's `SELECT` plus the PostGIS functions the course teaches, written in plain JS like Network Quest's simulator.
- **One SRID: 4326.** Every table stores `geometry(..., 4326)` in longitude/latitude degrees (WGS 84). The engine knows SRID 0 (a geometry made without one) only so it can raise PostGIS's real mixed-SRID error. There is no `ST_Transform`: meters come from `ST_DistanceSphere`, which PostGIS defines on 4326 points.
- **Read-only world.** Phase 1 runs `SELECT` (and `WITH ... SELECT`) only. Every mission runs on the same fixed island tables, so a check judges only the query the learner just ran (the own-action rule holds by construction) and a learner can open any chapter first. `CREATE TABLE`, `INSERT`, `UPDATE` and `CREATE INDEX ... USING GIST` are phase 2.
- **Faithful output.** Results follow PostgreSQL and PostGIS: a bare geometry column prints as hex EWKB (`0101000020E6100000...`), `ST_AsText` prints WKT, errors use PostgreSQL's wording (`ERROR:  column "nme" does not exist`, `ERROR:  function st_contain(geometry, geometry) does not exist`, `ERROR:  syntax error at or near "FORM"`). Anything outside the subset says `this practice database does not support X yet`, never a silent wrong answer.
- **One playground, seven chapters** in phase 1. A later phase appends chapters (never renumbers).

## Engine (`programming/postgis-quest/engine/`, DOM-free, runs in Node)

Global namespace `PQ`, like `NQ` in Network Quest.

- **`sql.js`**: lexer and recursive-descent parser for the subset. Statements: `SELECT [DISTINCT] ... FROM ... [JOIN | LEFT JOIN ... ON] [WHERE] [GROUP BY] [HAVING] [ORDER BY ... ASC|DESC] [LIMIT]`, `WITH name AS (...)`, subqueries in `FROM`, comma joins, aliases. Expressions: literals, columns (`t.col`), `+ - * /`, comparisons, `AND OR NOT`, `IS [NOT] NULL`, `IN (...)`, `::` casts (`geometry`, `text`, `int`, `numeric`, `float`), function calls with positional and named (`name := value`) arguments, `count(*)`, window calls `f(...) OVER ([PARTITION BY ...])`, and the KNN operator `<->`. Identifiers fold to lower case unless double-quoted, as in PostgreSQL.
- **`geom.js`**: geometry values `{type, coords, srid}` for Point, LineString, Polygon (with holes), MultiPoint, MultiLineString, MultiPolygon and GeometryCollection. WKT and EWKT in and out, hex EWKB out, planar measures (length, area, perimeter, distance), centroid, envelope, convex hull, point buffer (8 segments per quarter circle, as PostGIS's default), and the spherical distance PostGIS's `ST_DistanceSphere` uses (radius 6370986 m).
- **`relate.js`**: the predicates, from a point-location core (`interior`, `boundary`, `exterior`) plus segment intersection, following the DE-9IM definitions: `ST_Intersects`, `ST_Disjoint`, `ST_Contains`, `ST_Within`, `ST_Covers`, `ST_CoveredBy`, `ST_Touches`, `ST_Crosses`, `ST_Overlaps`, `ST_Equals`, `ST_DWithin`. Exact for the shapes the world uses (simple polygons with or without holes, lines, points); it is not a general topology library.
- **`cluster.js`**: `ST_ClusterDBSCAN(geom, eps, minpoints)` (the standard algorithm in input order; noise is `NULL`) and `ST_ClusterKMeans(geom, k)` (deterministic farthest-point seeding, then Lloyd's iterations). Cluster ids are labels: content never relies on which number a cluster gets, only on which rows share one, because real PostGIS may number them differently.
- **`db.js`**: the function registry (name, argument types, return type, `aggregate` or `window`) and the executor: `FROM`/joins as nested loops over the small tables, `WHERE`, grouping and aggregates (`count`, `sum`, `avg`, `min`, `max`, `ST_Collect`, `ST_Union` of points only, `ST_Extent`), windows, `ORDER BY`, `LIMIT`, `DISTINCT`. `PQ.run(db, sql)` returns `{ok, results:[{cols:[{name, type}], rows}], error}` and never throws; caps (rows scanned, result rows, SQL length, nesting) end as one error line.

## World (`content/world.js`)

Gullhaven, a small island in open Atlantic water near longitude -40, latitude 35 (no real land there). Tables, all SRID 4326:

| Table | Columns | Rows |
|---|---|---|
| `island` | `name`, `geom` Polygon | the coast |
| `zones` | `id`, `name`, `kind`, `geom` Polygon | village, market square (inside the village), woods (shares an edge with the village), meadow, marsh, windmill hill |
| `places` | `id`, `name`, `kind`, `geom` Point | harbor, lighthouse, market cross, chapel, windmill, old oak, stone circle, cave, marsh hut, and the village gate (on the village's edge) |
| `wells` | `id`, `name`, `depth_m`, `geom` Point | nine wells, some in zones, some in open land |
| `trails` | `id`, `name`, `geom` LineString | four trails that cross zones and each other |
| `stones` | `id`, `mark`, `geom` Point | twenty clue stones in three groups plus two strays, for clustering |

The data is chosen so every predicate shows its edge case once: a point on a boundary (contains vs intersects), two zones sharing an edge and two sharing only a corner (touches), a zone inside a zone (a zone contains itself), a trail crossing a zone (crosses), and strays that DBSCAN calls noise.

## Missions and checks

Mission shape follows Network Quest: `{title, goal, anat, how, explain, hint, answer, check, wrong}`. `answer` is one SQL text. A run of the editor is the learner's action; the check reads only that run.

- **Check context** (`content/model.js`): `c.ok` (it ran without error), `c.result` (the last statement's columns and rows), `c.calls(name)` (the query calls that function), `c.has(clause)` (`join`, `where`, `group`, `order`, `limit`, `with`, `over`, `distinct`), `c.reads(table)`, `c.same(sql, {ordered})` (the learner's result holds the reference result: every reference column matches some learner column value for value, rows compared as a multiset or in order; extra columns are fine), `c.partition(sql)` (the same rows grouped together, whatever the cluster numbers are), `c.geoms()` (the geometry values in the result).
- **Honest checks.** Outcome first (`c.same`), plus the construct the lesson is about (`c.calls('st_contains')`), so a hard-coded `WHERE name IN (...)` fails. Each mission lists `wrong` queries (the nearest mistake, arguments swapped, the lazy hard-coded version) that must fail; the tests enforce answer passes, every `wrong` fails, and an empty run fails. A failed check returns one tip in plain words (`Your point lands at x = 35.03: longitude comes first`).

### Phase 1 chapters

Keys are `'<chapter>.<mission>'`; once shipped they are never renumbered, only appended.

1. **Tables and rows**: `SELECT *`, columns, `WHERE` with text and numbers, `ORDER BY`, `LIMIT`, `count(*)`. No SQL is assumed.
2. **Points on the map**: a geometry column, hex EWKB, `ST_AsText` and WKT, `ST_X`/`ST_Y` and longitude first, `ST_SRID` and 4326, `ST_MakePoint` with `ST_SetSRID`, `ST_GeomFromText`.
3. **Lines and shapes**: LineString and Polygon WKT, closed rings, `ST_Length`, `ST_Area` (in square degrees, and why), `ST_Centroid`, `ST_GeometryType`, drawing a polygon.
4. **Who touches whom**: two tables at once, `ST_Contains`, `ST_Within`, `ST_Intersects`, boundary points, `ST_Touches`, a shape containing itself.
5. **How far**: `ST_Distance` in degrees, `ST_DistanceSphere` in meters, nearest with `ORDER BY ... LIMIT`, the `<->` operator, `ST_DWithin`, `ST_Buffer`.
6. **Joins and counts**: `JOIN ... ON` a predicate, `GROUP BY` with `count`, `LEFT JOIN` for zero counts, `ST_Collect`, `ST_ConvexHull`, centroids per group.
7. **Clusters**: window functions and `OVER ()`, `ST_ClusterKMeans`, `WITH`, `ST_ClusterDBSCAN` and noise, the centre of the biggest cluster, and the treasure at the well nearest to it.

Also: quick-fire (four-choice questions per finished chapter, like Network Quest), field guide entries with runnable examples, and a `RANKS` ladder with a fun top title.

## Story

Gullhaven's old mapmaker, Odile Marrow, kept every place on the island in a spatial database before she sailed away, and left a note in the harbor office: her Compass Rose is hidden "where my stones gather thickest". Cast: Odile (left the clues), Pinch (a seagull who steals map pins and drops them in the wrong places, used for the lon/lat mix-up), and Captain Brack (the harbor master, a rival hunter). Each chapter is one leg; the final chapter clusters the stones and finds the well nearest the centre of the biggest group. Outline in `story.js`.

## UI

- Tabs: Quest, Quick-fire, Field guide. Shared header, XP bar, settings, nav, trail strip and `HowSteps` cards.
- Desktop: mission card left; SQL editor with highlighting, Run (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) and result table in the middle; the map on the right.
- **Map** (inline SVG): a plate carrée view of the island fitted to its extent (and widened when a result lies outside it, with a note), a graticule labelled in degrees, the base layers drawn faint (coast, zones, trails, places, wells, stones), and the result's geometries drawn on top. A result row and its shape highlight each other on hover and focus. A column made by a cluster function colours the shapes by cluster, with a legend. Moving over the map shows the longitude and latitude under the pointer, longitude first. A text list under the map repeats what is drawn, so nothing is colour-only.
- 390px wide: editor, table and map stack, with a segmented switch like Network Quest's.
- Progress key `postgis-quest-v1` via `shared/progress.js`; the learner's SQL per mission is saved in `codes` (a field the pristine rule already knows). Never renamed.

## Testing

Node (`tests/postgis/`, part of `npm run test:engine`):
- sql: parsing, errors with PostgreSQL wording, identifier folding, caps
- geom: WKT round trips, EWKB hex against known PostGIS output, measures, centroid, buffer, sphere distance against known values
- relate: a table of predicate cases (points on edges, shared edges, corners, holes, crossing lines, self-containment)
- cluster: DBSCAN noise and order, KMeans determinism and partitions
- content: every mission's answer passes, every `wrong` fails, an empty run fails, unique keys, `how` on every mission, guide examples run without error, quick-fire shape, ranks top threshold equals total XP
- own-action, codestyle and teach-before-use tests in the style of the other quests

Browser: `postgis` in the `tests/smoke.mjs` list (loads, tabs, progress export and import, trail), plus a quest smoke test: run a query, see the table and the map highlight, finish a mission once.

## Wiring (new-playground checklist)

Card in `programming/index.html`, `shared/catalog.js` entry (`lang: null`), loader in `tests/trophy/chapters.mjs`, `EXPECTED` in `tests/ds/catalog.test.mjs`, pristine case in `tests/tools/progress-pristine.test.mjs`, `NAMES` in `tests/smoke.mjs`, README table and repo map, AGENTS.md "What this is" and "Where things go", the `postgis` commit scope in `commitlint.config.mjs` and `CONTRIBUTING.md`, the syntax-check globs in `AGENTS.md` and the `pre-pr-check` skill. The same globs in `.github/workflows/ci.yml` are a separate `ci:` PR.

## Known differences from PostgreSQL/PostGIS

- Only the statements and functions listed above. No `ST_Transform`, no geography type, no `ST_Intersection`/`ST_Difference` (polygon overlay) and `ST_Buffer` on points only in phase 1.
- `numeric` values print without trailing zeros (`round(1.50, 2)` prints `1.5`).
- KMeans cluster numbers may differ from PostGIS's; the rows grouped together do not, for the course's data.

## Roadmap (separate specs/plans)

2. Your own layer: `CREATE TABLE ... geometry(Point, 4326)`, `INSERT`, `UPDATE`, spatial indexes (`USING GIST`) and `EXPLAIN`.
3. Overlay: `ST_Intersection`, `ST_Union` of polygons, `ST_Difference`, buffers of lines and polygons.
4. Geography and projections: `::geography`, `ST_Transform` to a local metric SRID.
