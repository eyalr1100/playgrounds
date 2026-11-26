// PostGIS Quest test harness: loads the DOM-free engine and content files into a fresh vm context, in page order.
// FILES are relative to programming/postgis-quest/ and must list the engine and content scripts in its index.html order.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'programming', 'postgis-quest');
export const ENGINE = ['engine/sql.js', 'engine/geom.js', 'engine/relate.js', 'engine/cluster.js', 'engine/db.js', 'content/world.js'];
export const FILES = [...ENGINE, 'content/model.js', 'content/ch-1-tables.js', 'content/ch-2-points.js', 'content/ch-3-shapes.js',
  'content/ch-4-relations.js', 'content/ch-5-distance.js', 'content/ch-6-joins.js', 'content/ch-7-clusters.js', 'content/extras.js'];

export function load(files = FILES) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
  return sandbox.PQ;
}
export const loadEngine = () => load(ENGINE);
// run SQL on a fresh world and return the last result's rows as psql text, or the error text
export function sql(PQ, text) {
  const r = PQ.run(PQ.freshDb(), text);
  if (!r.ok) return PQ.errorText(text, r.error);
  const last = r.results.at(-1);
  return last.rows.map(row => row.map((v, i) => PQ.show(v, last.cols[i].type)).join('|')).join('\n');
}
