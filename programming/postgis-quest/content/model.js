/* PostGIS Quest mission model: the check context and the session. Chapters (content/ch-*.js) push into PQ.CH in order;
   a mission's key is '<chapter>.<mission>', so shipped missions are never reordered. A check sees only the query the
   learner just ran (the world never changes), and returns true or one tip in plain words. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const G=PQ.geo,REL=PQ.relate;
PQ.CH=PQ.CH||[];
PQ.XP=10;
PQ.KINDS={kw:'keyword',fn:'function',col:'column',tbl:'table',val:'value',op:'operator',al:'short name'};

/* the names a learner meets, written the way PostGIS's documentation writes them */
const PRETTY={};
for(const n of ['ST_AsText','ST_X','ST_Y','ST_SRID','ST_MakePoint','ST_SetSRID','ST_GeomFromText','ST_Length','ST_Area','ST_Perimeter','ST_Centroid','ST_GeometryType','ST_Contains','ST_Within','ST_Intersects','ST_Touches','ST_Disjoint','ST_Crosses','ST_Overlaps','ST_Equals','ST_Covers','ST_CoveredBy','ST_Distance','ST_DistanceSphere','ST_DWithin','ST_Buffer','ST_Collect','ST_ConvexHull','ST_Envelope','ST_Extent','ST_ClusterKMeans','ST_ClusterDBSCAN','ST_MakeEnvelope','ST_AsGeoJSON','ST_NPoints','ST_Union','ST_MakeLine','ST_Point','ST_AsEWKT'])PRETTY[n.toLowerCase()]=n;
PQ.pretty=n=>PRETTY[n]||n;

/* ---------- reading a query's shape ---------- */
// what a parsed script uses: function names, clauses, tables read, columns named, operators
function shape(stmts){
  const s={calls:new Set(),has:new Set(),reads:new Set(),refs:new Set(),ops:new Set()};
  const walk=(n,ctes)=>{
    if(!n||typeof n!=='object')return;
    if(Array.isArray(n)){n.forEach(x=>walk(x,ctes));return;}
    if(n.type==='select'){
      const names=new Set(ctes);
      if(n.with&&n.with.length){s.has.add('with');n.with.forEach(c=>{walk(c.query,names);names.add(c.name);});}
      if(n.distinct)s.has.add('distinct');
      if(n.where)s.has.add('where');
      if(n.group.length)s.has.add('group');
      if(n.having)s.has.add('having');
      if(n.order.length)s.has.add('order');
      if(n.limit)s.has.add('limit');
      if(n.cols.some(c=>c.star))s.has.add('star');
      if(n.cols.some(c=>c.alias))s.has.add('alias');
      walkFrom(n.from,names);
      for(const k of ['cols','where','group','having','order','limit','offset'])walk(n[k],names);
      return;
    }
    if(n.t==='call'){s.calls.add(n.name);if(n.over)s.has.add('over');if(Object.keys(n.named).length)s.has.add('named');}
    if(n.t==='col')s.refs.add(n.name);
    if(n.t==='bin')s.ops.add(n.op);
    if(n.t==='not')s.ops.add('not');
    if(n.t==='isnull')s.ops.add(n.not?'is not null':'is null');
    if(n.t==='cast')s.ops.add('::');
    if(n.query)walk(n.query,ctes);
    for(const k of Object.keys(n)){if(k==='query'||k==='pos')continue;const v=n[k];if(v&&typeof v==='object')walk(v,ctes);}
  };
  const walkFrom=(f,ctes)=>{
    if(!f)return;
    if(f.type==='table'){if(!ctes.has(f.name))s.reads.add(f.name);return;}
    if(f.type==='sub'){s.has.add('subquery');walk(f.query,ctes);return;}
    if(f.kind==='cross'&&!f.pos)s.has.add('comma');
    else s.has.add(f.kind==='left'?'left':f.kind==='cross'?'crossjoin':'join');
    if(f.kind==='left')s.has.add('join');
    walkFrom(f.left,ctes);walkFrom(f.right,ctes);walk(f.on,ctes);
  };
  walk(stmts,new Set());
  return s;
}
PQ.shape=shape;

/* ---------- comparing results ---------- */
// a value as a comparable key: numbers to 9 significant digits, geometries by their rounded text, NULL apart
const num=v=>{if(v===0)return '0';return Number(v.toPrecision(9)).toString();};
function vkey(v){
  if(v===null||v===undefined)return '∅';
  if(typeof v==='number')return 'n'+num(v);
  if(G.isGeom(v))return 'g'+v.srid+':'+G.wkt(JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='number'&&k!=='srid'?+x.toFixed(9):x));
  if(v&&v.box)return 'b'+v.box.map(num).join(',');
  return typeof v+':'+String(v);
}
PQ.vkey=vkey;
const bag=a=>{const m=new Map();for(const k of a)m.set(k,(m.get(k)||0)+1);return m;};
const sameBag=(a,b)=>{if(a.length!==b.length)return false;const m=bag(a);for(const k of b){const c=m.get(k);if(!c)return false;m.set(k,c-1);}return true;};
/* does `got` hold the reference result `want`? Every reference column must match one of got's columns value for value
   (extra columns are fine, and names and order do not matter), with the rows the same as a multiset, or in the same order
   when ordered. */
function holds(got,want,ordered){
  if(!got||!want||got.rows.length!==want.rows.length)return false;
  const W=want.cols.length,gk=got.cols.map((_,j)=>got.rows.map(r=>vkey(r[j]))),wk=want.cols.map((_,j)=>want.rows.map(r=>vkey(r[j])));
  // candidate got-columns for each want-column: same values as a multiset
  const cand=wk.map(w=>gk.map((g,j)=>j).filter(j=>sameBag(gk[j],w)));
  const pick=[],used=new Set();
  const rowsMatch=()=>{
    const a=got.rows.map((_,i)=>pick.map(j=>gk[j][i]).join('\u0001')),b=want.rows.map((_,i)=>wk.map(c=>c[i]).join('\u0001'));
    return ordered?a.every((x,i)=>x===b[i]):sameBag(a,b);
  };
  const go=i=>{if(i===W)return rowsMatch();for(const j of cand[i]){if(used.has(j))continue;used.add(j);pick.push(j);if(go(i+1))return true;pick.pop();used.delete(j);}return false;};
  return go(0);
}
PQ.holds=holds;
const refCache=new Map();
function reference(sql){
  if(!refCache.has(sql)){const r=PQ.run(PQ.freshDb(),sql);if(!r.ok)throw new Error('reference query fails: '+r.error.message+'\n'+sql);refCache.set(sql,r.results.at(-1));}
  return refCache.get(sql);
}
PQ.reference=reference;

/* ---------- the check context ---------- */
/* ctx for one run of the editor: sql is what ran, r is PQ.run's answer, m the mission (its answer is the reference). */
PQ.makeCtx=(sql,r,m)=>{
  const res=r&&r.ok?r.results.at(-1)||null:null;
  const sh=shape(r&&r.stmts||[]);
  const c={
    sql,ok:!!(r&&r.ok&&res),error:r&&r.error,result:res,
    rows:res?res.rows:[],cols:res?res.cols:[],
    calls:f=>sh.calls.has(f.toLowerCase()),
    has:k=>sh.has.has(k),
    reads:t=>sh.reads.has(t),
    refs:col=>sh.refs.has(col),
    op:o=>sh.ops.has(o),
    // the learner's result holds the reference result (the mission's answer, or the SQL given)
    same:(ref,o)=>!!res&&holds(res,reference(ref||m.answer),!!(o&&o.ordered)),
    // the learner's rows fall into the same groups as the reference's cluster column, whatever the numbers are
    partition:(ref,idCol)=>{
      if(!res)return false;
      const want=reference(ref||m.answer),wi=want.cols.findIndex(x=>x.name===(idCol||'id')),wc=want.cols.findIndex(x=>x.cluster);
      const gc=res.cols.map((x,j)=>j).filter(j=>res.cols[j].cluster);
      const gi=res.cols.map((x,j)=>j).filter(j=>sameBag(res.rows.map(r=>vkey(r[j])),want.rows.map(r=>vkey(r[wi]))));
      if(res.rows.length!==want.rows.length||!gc.length||!gi.length)return false;
      return gc.some(cj=>gi.some(ij=>{
        const lab=new Map(),back=new Map();
        const wantOf=new Map(want.rows.map(r=>[vkey(r[wi]),r[wc]]));
        return res.rows.every(r=>{
          const w=wantOf.get(vkey(r[ij])),g=r[cj];
          if((w===null)!==(g===null))return false;
          if(w===null)return true;
          if(lab.has(g)&&lab.get(g)!==w)return false;
          if(back.has(w)&&back.get(w)!==g)return false;
          lab.set(g,w);back.set(w,g);return true;
        });
      }));
    },
    // the geometry values in the result, each with its row and column
    geoms:()=>{const out=[];if(res)res.rows.forEach((row,i)=>row.forEach((v,j)=>{if(G.isGeom(v))out.push({g:v,row:i,col:j});}));return out;},
    // the result's only value, when it has one row and one column
    value:()=>res&&res.rows.length===1&&res.cols.length===1?res.rows[0][0]:undefined
  };
  return c;
};

/* ---------- ready-made checks ---------- */
const HAS={where:'Keep only some rows with <code>WHERE</code>.',order:'Sort the rows with <code>ORDER BY</code>.',limit:'Keep only the first rows with <code>LIMIT</code>.',
  join:'Pair the tables with <code>JOIN ... ON</code>.',left:'Keep every zone, even one with no well, with <code>LEFT JOIN</code>.',group:'Make one row per group with <code>GROUP BY</code>.',
  with:'Name the first query with <code>WITH ... AS (...)</code> and read from it.',over:'A cluster function needs <code>OVER ()</code> after it.',star:'Ask for every column with <code>*</code>.',
  alias:'Give the column a name with <code>AS</code>.',named:'Name the settings with <code>:=</code>, as in <code>eps := 0.01</code>.'};
/* PQ.need({calls, has, reads, ordered, extra, tip}): the usual check. In order: the tables it must read, the functions
   it must call (the lesson), the clauses it must use, then the rows themselves. extra(c) adds a mission's own test. */
PQ.need=o=>c=>{
  for(const t of o.reads||[])if(!c.reads(t))return 'Read the table <code>'+t+'</code>: put it after <code>FROM</code>.';
  for(const f of o.calls||[])if(!c.calls(f))return 'Use <code>'+PQ.pretty(f)+'</code> in your query: this mission is about it.';
  for(const h of o.has||[])if(!c.has(h))return HAS[h]||('Use '+h+'.');
  if(o.extra){const x=o.extra(c);if(x!==true)return x;}
  if(o.partition?!c.partition(null,o.partition):!c.same(null,{ordered:!!o.ordered}))return o.tip||'Your query runs, but its rows are not the ones the goal asks for yet. Compare them with the goal, one column at a time.';
  return true;
};

/* ---------- a session: one go at a mission ---------- */
PQ.ERR_TIP='Your query stopped with an error, so nothing was checked. The <code>ERROR</code> line under the editor says what went wrong, and the <code>^</code> points at where.';
PQ.session=m=>{
  const db=PQ.freshDb();
  return {db,
    run(sql){const r=PQ.run(db,sql);this.last={sql,r};return r;},
    check(){
      if(!this.last)return null;
      const {sql,r}=this.last;
      if(!String(sql).trim())return 'The editor is empty. Type a query, then press Run.';
      if(!r.ok)return PQ.ERR_TIP;
      if(!r.results.length)return 'There is no query to run yet, only comments. Type one after them.';
      return m.check(PQ.makeCtx(sql,r,m));
    }};
};
PQ.runMission=(m,sql)=>{const s=PQ.session(m);s.run(sql);return s.check();};
})();
