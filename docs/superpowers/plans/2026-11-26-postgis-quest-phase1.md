# PostGIS Quest Phase 1 Implementation Plan

**Goal:** Ship `programming/postgis-quest/` phase 1: a DOM-free SQL and PostGIS simulator, an SQL editor with a result table and a map, and chapters 1 to 7.

**Architecture:** Plain browser scripts sharing one global namespace `PQ`, loaded in order from `index.html`. `engine/` (no DOM) holds the SQL parser, geometry, predicates, clustering and the executor. `content/` holds the world tables and the course as data. `ui.js` (editor, table, map) and `app.js` are the only DOM files. Node tests load the engine and content in a `vm` sandbox through `tests/postgis/harness.mjs`, in `index.html` order.

**Spec:** `docs/superpowers/specs/2026-11-26-postgis-quest-design.md`

## Global constraints

- No build step, no framework, no new runtime dependency. Pages work opened from disk and on GitHub Pages, and bundle (`npm run check`).
- Engine and content files never touch `window`, `document` or `localStorage`. Deterministic: no `Math.random`, no `Date.now`.
- Progress key is exactly `postgis-quest-v1`; mission keys `'<chapter>.<mission>'`, never renumbered once shipped.
- Every mission has a reference `answer` that passes its own `check`, `wrong` queries that fail it, and an empty run that fails it.
- Learner text: whole line first, then the parts (`how`); code in `<code>`; friendly; teach before use.
- Conventional Commits, scope `postgis`.

## Review focus

1. **Odd input**: empty editor, only a comment, an unclosed quote, a 20,000-character query, a cross join of every table with itself: one error line or a capped result, never an exception or a frozen page.
2. **Predicates on edges**: a point on a boundary, shared edges and corners, a zone and itself: the relate tests pin each against what PostGIS returns.
3. **Mixed SRID and lon/lat swaps**: PostGIS's error text for mixed SRIDs; a swapped point lands far off the island and the map widens to show it.
4. **Saves**: a damaged or foreign save loads without throwing; a fresh load stores a pristine save.

## Tasks

- [ ] **1. Commit scope.** Add `postgis` to `commitlint.config.mjs` and the scopes list in `CONTRIBUTING.md`.
- [ ] **2. SQL front end** (`engine/sql.js`, `tests/postgis/sql.test.mjs`): lexer, parser, PostgreSQL error wording.
- [ ] **3. Geometry** (`engine/geom.js`, `tests/postgis/geom.test.mjs`): WKT/EWKT, EWKB hex, measures, centroid, hull, buffer, sphere distance.
- [ ] **4. Predicates** (`engine/relate.js`, `tests/postgis/relate.test.mjs`).
- [ ] **5. Clustering** (`engine/cluster.js`, `tests/postgis/cluster.test.mjs`).
- [ ] **6. Executor and functions** (`engine/db.js`, `tests/postgis/db.test.mjs`): joins, grouping, windows, ordering, caps, output formatting.
- [ ] **7. World and story** (`content/world.js`, `story.js`).
- [ ] **8. Mission model** (`content/model.js`): the check context and `PQ.session`.
- [ ] **9. Chapters 1 to 7, ranks, quick-fire, guide** (`content/ch-*.js`, `content/extras.js`) with `tests/postgis/content.test.mjs`, `own-action.test.mjs`, `codestyle.test.mjs`, `teach.test.mjs`.
- [ ] **10. Page** (`index.html`, `style.css`, `ui.js`, `app.js`): editor, table, map, quick-fire, guide, 390px layout.
- [ ] **11. Wiring**: hub card, catalog, trophy loader, ds catalog `EXPECTED`, pristine case, smoke `NAMES` and a quest smoke test, `package.json` `test:engine`, README, AGENTS.md, the `pre-pr-check` skill's syntax loop.
- [ ] **12. Verify**: `npm run check && npm test`, the syntax loop, play every chapter at 1280px and 390px, light and dark. Flag the `ci.yml` glob change as a follow-up `ci:` PR.
