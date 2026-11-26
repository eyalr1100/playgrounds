/* PostGIS Quest database: the function registry and the executor. A query is compiled once against its tables (so a
   wrong column or function is an error before any row is read, as in PostgreSQL), then run as nested loops over the small
   world tables. PQ.run(db, sql) never throws: it returns {ok, results, error}. Values are JS numbers, strings, booleans,
   null, geometries (PQ.geo) and boxes {box:[xmin,ymin,xmax,ymax]}. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const G=PQ.geo,REL=PQ.relate,CL=PQ.cluster,E=PQ.SqlError;
const BUDGET=3000000,MAXJOIN=100000;

/* ---------- types ---------- */
const NUM=['integer','bigint','numeric','double precision'];
const isNum=t=>NUM.includes(t);
const rank=t=>NUM.indexOf(t);
const promote=(a,b)=>rank(a)>=rank(b)?a:b;
/* can a value of type `t` go where `want` is asked for, without a cast? unknown is a quoted literal, read as needed */
function fits(t,want){
  if(want==='any'||t===want)return true;
  if(t==='unknown')return want!=='box2d';
  if(want==='float8')return isNum(t);
  if(want==='numeric')return t==='integer'||t==='bigint'||t==='numeric';
  if(want==='int')return t==='integer'||t==='bigint';
  if(want==='anynum')return isNum(t);
  if(want==='geometry')return t==='geometry';
  return false;
}
const SHOWTYPE={float8:'double precision',int:'integer',anynum:'numeric'};
const tname=t=>SHOWTYPE[t]||t;
// read a quoted literal as the type it is used as
function coerce(v,want,pos){
  if(v===null||typeof v!=='string')return v;
  if(want==='geometry'){try{return G.parse(v);}catch(e){throw new E(e.message,pos,e.hint);}}
  if(want==='boolean'){const s=v.trim().toLowerCase();if(['t','true','yes','on','1'].includes(s))return true;if(['f','false','no','off','0'].includes(s))return false;throw new E('invalid input syntax for type boolean: "'+v+'"',pos);}
  if(isNum(want)||want==='float8'||want==='int'||want==='anynum'){const s=v.trim();if(!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s))throw new E('invalid input syntax for type '+(want==='int'||want==='integer'?'integer':want==='float8'?'double precision':'numeric')+': "'+v+'"',pos);
    if((want==='int'||want==='integer'||want==='bigint')&&!/^[-+]?\d+$/.test(s))throw new E('invalid input syntax for type integer: "'+v+'"',pos);return +s;}
  return v;
}
function cast(v,from,to,pos){
  if(v===null)return null;
  if(to==='text'){if(from==='geometry')return G.hex(v);if(from==='box2d')return showBox(v);if(from==='boolean')return v?'true':'false';if(typeof v==='number')return show(v,from);return String(v);}
  if(to==='geometry'){if(from==='geometry')return v;if(from==='text'||from==='unknown')return coerce(v,'geometry',pos);if(from==='box2d'){const [a,b,c,d]=v.box;return G.box(a,b,c,d,0);}throw new E('cannot cast type '+from+' to geometry',pos);}
  if(to==='box2d'){if(from==='geometry'){const b=G.bbox(v);return {box:[b.xmin,b.ymin,b.xmax,b.ymax]};}throw new E('cannot cast type '+from+' to box2d',pos);}
  if(to==='boolean'){if(from==='boolean')return v;if(from==='integer')return v!==0;if(from==='text'||from==='unknown')return coerce(v,'boolean',pos);throw new E('cannot cast type '+from+' to boolean',pos);}
  if(isNum(to)){
    let n=v;
    if(from==='text'||from==='unknown')n=coerce(String(v),to==='double precision'?'float8':'numeric',pos);
    else if(from==='boolean'){if(to!=='integer')throw new E('cannot cast type boolean to '+to,pos);n=v?1:0;}
    else if(!isNum(from))throw new E('cannot cast type '+from+' to '+to,pos);
    if(to==='integer'||to==='bigint'){n=Math.sign(n)*Math.round(Math.abs(n));if(to==='integer'&&Math.abs(n)>2147483647)throw new E('integer out of range',pos);}
    return n;
  }
  throw new E('cannot cast type '+from+' to '+to,pos);
}

/* ---------- showing values the way psql does ---------- */
// float8 output: the shortest digits that read back; exponent form below 1e-4 and from 1e15, with a two-digit exponent
function showFloat(n){
  if(Number.isNaN(n))return 'NaN';if(!Number.isFinite(n))return n>0?'Infinity':'-Infinity';
  if(n===0)return '0';
  const a=Math.abs(n);
  if(a<1e-4||a>=1e15){const [m,e]=n.toExponential().split('e');const x=+e;return m+'e'+(x<0?'-':'+')+String(Math.abs(x)).padStart(2,'0');}
  return String(n);
}
const showBox=v=>'BOX('+G.fmt(v.box[0])+' '+G.fmt(v.box[1])+','+G.fmt(v.box[2])+' '+G.fmt(v.box[3])+')';
function show(v,t){
  if(v===null||v===undefined)return '';
  if(t==='geometry'||G.isGeom(v))return G.hex(v);
  if(t==='box2d'||(v&&v.box))return showBox(v);
  if(typeof v==='boolean')return v?'t':'f';
  if(typeof v==='number'){if(t==='double precision')return showFloat(v);if(t==='numeric')return showFloat(v).includes('e')?String(+v.toPrecision(15)):String(v);return String(v);}
  return String(v);
}
PQ.show=show;PQ.showFloat=showFloat;

/* ---------- the function registry ---------- */
const FN={};
/* def(name, params, ret, impl, opts): params name a type each ('geometry', 'float8', 'int', 'numeric', 'text', 'boolean',
   'any', 'anynum'); ret is a type or a function of the argument types. opts: agg (an aggregate), win (needs OVER), names
   (named-argument names), geo2 (two geometries that must share an SRID; PostGIS's name for the error), strict (NULL in,
   NULL out; the default) */
function def(name,params,ret,impl,opts){(FN[name]=FN[name]||[]).push({name,params,ret,impl,...(opts||{})});}
const mixed=(fname,a,b,pos)=>{if(a&&b&&a.srid!==b.srid)throw new E(fname+': Operation on mixed SRID geometries ('+a.type+', '+a.srid+') != ('+b.type+', '+b.srid+')',pos);};

// constructors
def('st_makepoint',['float8','float8'],'geometry',a=>G.make('Point',[a[0],a[1]],0));
def('st_point',['float8','float8'],'geometry',a=>G.make('Point',[a[0],a[1]],0));
def('st_point',['float8','float8','int'],'geometry',a=>G.make('Point',[a[0],a[1]],a[2]),{names:['x','y','srid']});
def('st_setsrid',['geometry','int'],'geometry',a=>{const g=JSON.parse(JSON.stringify(a[0]));g.srid=a[1];return g;});
for(const n of ['st_geomfromtext','st_geometryfromtext']){
  def(n,['text'],'geometry',(a,c)=>{const g=parseIn(a[0],c);if(g.srid)throw new E('parse error - invalid geometry',c.pos,'Write the SRID as the second argument, not inside the text.');return g;});
  def(n,['text','int'],'geometry',(a,c)=>{const g=parseIn(a[0],c);if(g.srid)throw new E('parse error - invalid geometry',c.pos,'Write the SRID as the second argument, not inside the text.');g.srid=a[1];return g;});
}
def('st_geomfromewkt',['text'],'geometry',(a,c)=>parseIn(a[0],c));
def('st_makeenvelope',['float8','float8','float8','float8'],'geometry',a=>G.box(a[0],a[1],a[2],a[3],0));
def('st_makeenvelope',['float8','float8','float8','float8','int'],'geometry',a=>G.box(a[0],a[1],a[2],a[3],a[4]));
def('st_makeline',['geometry','geometry'],'geometry',(a,c)=>{mixed('ST_MakeLine',a[0],a[1],c.pos);const pts=[...G.verts(a[0]),...G.verts(a[1])];if(pts.length<2)throw new E('geometry requires more points',c.pos);return G.make('LineString',pts,a[0].srid);});
function parseIn(s,c){try{return G.parse(s);}catch(e){throw new E(e.message,c.argPos[0]??c.pos,e.hint);}}

// reading a geometry
const onlyPoint=(fn,g,c)=>{if(g.type!=='Point')throw new E('Argument to '+fn+'() must have type POINT',c.pos);return g;};
def('st_x',['geometry'],'double precision',(a,c)=>onlyPoint('ST_X',a[0],c).c[0]);
def('st_y',['geometry'],'double precision',(a,c)=>onlyPoint('ST_Y',a[0],c).c[1]);
def('st_srid',['geometry'],'integer',a=>a[0].srid);
def('st_astext',['geometry'],'text',a=>G.wkt(a[0]));
def('st_astext',['geometry','int'],'text',a=>G.wkt(round(a[0],a[1])));
def('st_asewkt',['geometry'],'text',a=>G.ewkt(a[0]));
def('st_asgeojson',['geometry'],'text',a=>G.geojson(a[0]));
def('st_asgeojson',['geometry','int'],'text',a=>G.geojson(a[0],a[1]));
def('st_geometrytype',['geometry'],'text',a=>G.typeName(a[0]));
def('geometrytype',['geometry'],'text',a=>a[0].type.toUpperCase());
def('st_npoints',['geometry'],'integer',a=>G.npoints(a[0]));
def('st_numgeometries',['geometry'],'integer',a=>/^Multi|Collection/.test(a[0].type)?G.parts(a[0]).length:1);
def('st_startpoint',['geometry'],'geometry',a=>a[0].type==='LineString'?G.make('Point',a[0].c[0],a[0].srid):null);
def('st_endpoint',['geometry'],'geometry',a=>a[0].type==='LineString'?G.make('Point',a[0].c[a[0].c.length-1],a[0].srid):null);
def('st_dimension',['geometry'],'integer',a=>G.dim(a[0]));
function round(g,d){const r=x=>+x.toFixed(Math.max(0,Math.min(15,d)));const m=c=>typeof c[0]==='number'?[r(c[0]),r(c[1])]:c.map(m);const o=JSON.parse(JSON.stringify(g));if(o.c)o.c=m(o.c);if(o.g)o.g=o.g.map(x=>round(x,d));return o;}

// measuring
def('st_area',['geometry'],'double precision',a=>G.area(a[0]));
def('st_length',['geometry'],'double precision',a=>G.length(a[0]));
def('st_perimeter',['geometry'],'double precision',a=>G.perimeter(a[0]));
def('st_distance',['geometry','geometry'],'double precision',(a,c)=>{mixed('ST_Distance',a[0],a[1],c.pos);return REL.distance(a[0],a[1]);});
def('st_distancesphere',['geometry','geometry'],'double precision',(a,c)=>{mixed('ST_DistanceSphere',a[0],a[1],c.pos);try{return G.sphere(a[0],a[1]);}catch(e){throw new E(e.message,c.pos);}});
def('st_dwithin',['geometry','geometry','float8'],'boolean',(a,c)=>{mixed('ST_DWithin',a[0],a[1],c.pos);if(a[2]<0)throw new E('Tolerance cannot be less than zero',c.pos);return REL.dwithin(a[0],a[1],a[2]);});

// predicates
for(const [n,f,P] of [['st_intersects','intersects','ST_Intersects'],['st_disjoint','disjoint','ST_Disjoint'],['st_contains','contains','ST_Contains'],['st_within','within','ST_Within'],['st_covers','covers','ST_Covers'],['st_coveredby','coveredby','ST_CoveredBy'],['st_touches','touches','ST_Touches'],['st_crosses','crosses','ST_Crosses'],['st_overlaps','overlaps','ST_Overlaps'],['st_equals','equals','ST_Equals']])
  def(n,['geometry','geometry'],'boolean',(a,c)=>{mixed(P,a[0],a[1],c.pos);return REL[f](a[0],a[1]);});

// making new shapes
def('st_centroid',['geometry'],'geometry',a=>G.centroid(a[0]));
def('st_envelope',['geometry'],'geometry',a=>G.envelope(a[0]));
def('st_convexhull',['geometry'],'geometry',a=>G.hull(a[0]));
const buf=(a,c,q)=>{try{return G.buffer(a[0],a[1],q);}catch(e){throw new E(e.message,c.pos);}};
def('st_buffer',['geometry','float8'],'geometry',(a,c)=>buf(a,c));
def('st_buffer',['geometry','float8','int'],'geometry',(a,c)=>buf(a,c,Math.max(1,a[2])));
def('st_buffer',['geometry','float8','text'],'geometry',(a,c)=>{const m=/quad_segs\s*=\s*(\d+)/i.exec(a[2]);if(!m||a[2].replace(m[0],'').trim())throw new E('this practice database understands only quad_segs=N in buffer parameters',c.pos);return buf(a,c,Math.max(1,+m[1]));});
def('st_collect',['geometry','geometry'],'geometry',(a,c)=>{mixed('ST_Collect',a[0],a[1],c.pos);return G.collect([a[0],a[1]]);});
const pointsUnion=(gs,c)=>{const ok=gs.filter(Boolean);if(!ok.length)return null;if(ok.some(g=>G.dim(g)!==0))throw new E('this practice database runs ST_Union on points only for now',c.pos);
  for(const g of ok)mixed('ST_Union',ok[0],g,c.pos);
  const seen=new Map();for(const g of ok)for(const p of G.verts(g))seen.set(p[0]+','+p[1],p);const pts=[...seen.values()];return pts.length===1?G.make('Point',pts[0],ok[0].srid):G.make('MultiPoint',pts,ok[0].srid);};
def('st_union',['geometry','geometry'],'geometry',(a,c)=>pointsUnion([a[0],a[1]],c));

// aggregates: impl receives the list of argument lists of the group's rows
const nn=rows=>rows.map(r=>r[0]).filter(v=>v!==null);
def('count',['any'],'bigint',rows=>nn(rows).length,{agg:true,strict:false});
def('sum',['anynum'],t=>t[0]==='integer'?'bigint':t[0],rows=>{const v=nn(rows);return v.length?v.reduce((s,x)=>s+x,0):null;},{agg:true,strict:false});
def('avg',['anynum'],t=>t[0]==='double precision'?t[0]:'numeric',rows=>{const v=nn(rows);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;},{agg:true,strict:false});
for(const [n,s] of [['min',-1],['max',1]])def(n,['any'],t=>t[0],(rows,c)=>{const v=nn(rows);if(!v.length)return null;if(G.isGeom(v[0]))throw new E('function '+n+'(geometry) does not exist',c.pos);return v.reduce((m,x)=>cmp(x,m)*s>0?x:m);},{agg:true,strict:false});
def('st_collect',['geometry'],'geometry',(rows,c)=>{const v=nn(rows);for(const g of v)mixed('ST_Collect',v[0],g,c.pos);return G.collect(v);},{agg:true,strict:false});
def('st_union',['geometry'],'geometry',(rows,c)=>pointsUnion(nn(rows),c),{agg:true,strict:false});
def('st_extent',['geometry'],'box2d',rows=>{const v=nn(rows);if(!v.length)return null;const b=G.bbox(G.collect(v));return {box:[b.xmin,b.ymin,b.xmax,b.ymax]};},{agg:true,strict:false});

// window functions: impl receives the partition's argument lists in row order and returns one value per row
def('st_clusterkmeans',['geometry','int'],'integer',(rows,c)=>{const k=rows.length?rows[0][1]:1;if(k===null||k<1)throw new E('kmeans: number of clusters must be a positive integer',c.pos);return CL.kmeans(rows.map(r=>r[0]),k);},{win:true,names:['geom','number_of_clusters'],cluster:true});
def('st_clusterdbscan',['geometry','float8','int'],'integer',(rows,c)=>{const e=rows.length?rows[0][1]:0,m=rows.length?rows[0][2]:1;if(e===null||e<0)throw new E('eps must be a non-negative number',c.pos);return CL.dbscan(rows.map(r=>r[0]),e,m??1);},{win:true,names:['geom','eps','minpoints'],cluster:true});
def('row_number',[],'bigint',rows=>rows.map((_,i)=>i+1),{win:true,ordered:true});

// plain helpers
def('round',['numeric'],'numeric',a=>Math.sign(a[0])*Math.round(Math.abs(a[0])));
def('round',['numeric','int'],'numeric',a=>{const f=10**a[1];return Math.sign(a[0])*Math.round(Math.abs(a[0])*f+1e-9)/f;});
def('round',['float8'],'double precision',a=>Math.round(a[0]));
for(const [n,f] of [['abs',Math.abs],['floor',Math.floor],['ceil',Math.ceil],['ceiling',Math.ceil]])def(n,['anynum'],t=>t[0],a=>f(a[0]));
def('sqrt',['float8'],'double precision',(a,c)=>{if(a[0]<0)throw new E('cannot take square root of a negative number',c.pos);return Math.sqrt(a[0]);});
def('pi',[],'double precision',()=>Math.PI);
def('lower',['text'],'text',a=>a[0].toLowerCase());
def('upper',['text'],'text',a=>a[0].toUpperCase());
def('length',['text'],'integer',a=>[...a[0]].length);
def('coalesce',['any','any'],t=>t.find(x=>x!=='unknown')||'text',a=>a.find(v=>v!==null)??null,{strict:false,variadic:true});
def('concat',['any'],'text',a=>a.map(v=>v===null?'':typeof v==='boolean'?(v?'t':'f'):G.isGeom(v)?G.hex(v):String(v)).join(''),{strict:false,variadic:true});

PQ.FN=FN;
const KNOWN=Object.keys(FN);
function lev(a,b){const m=a.length,n=b.length;if(Math.abs(m-n)>2)return 9;let prev=Array.from({length:n+1},(_,j)=>j);for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}return prev[n];}
const closest=(w,list)=>{let best=null,bd=3;for(const x of list){const d=lev(w,x);if(d<bd){bd=d;best=x;}}return best;};
PQ.closest=closest;

/* ---------- comparing and keying values ---------- */
function cmp(a,b){
  if(a===b)return 0;
  if(typeof a==='number'&&typeof b==='number')return a<b?-1:a>b?1:0;
  if(typeof a==='boolean'&&typeof b==='boolean')return a===b?0:a?1:-1;
  if(G.isGeom(a)&&G.isGeom(b)){const x=G.hex(a),y=G.hex(b);return x<y?-1:x>y?1:0;}
  const x=String(a),y=String(b);return x<y?-1:x>y?1:0;
}
const keyOf=v=>v===null?'\u0000N':G.isGeom(v)?'g'+G.hex(v):v&&v.box?'b'+v.box.join(','):typeof v+':'+String(v);
PQ.cmp=cmp;PQ.keyOf=keyOf;

/* ---------- compiling ---------- */
/* a scope is the FROM list of one query level: rels [{alias, cols:[{name,type,cluster}], off, pk}] and the parent level.
   A compiled expression is {ty, ev(ctx), name, cluster}; ctx is {row, parent, group, wins, ri}. */
const strip=n=>JSON.stringify(n,(k,v)=>k==='pos'||k==='raw'||k==='src'?undefined:v);
function hasAgg(n){
  if(!n||typeof n!=='object')return false;
  if(n.t==='call'&&!n.over&&FN[n.name]&&FN[n.name].some(f=>f.agg)&&!FN[n.name].some(f=>!f.agg&&f.params.length===n.args.length+Object.keys(n.named).length&&!n.star))return true;
  if(n.t==='sub'||n.t==='exists'||n.t==='insub')return hasAgg(n.a);
  for(const k of Object.keys(n)){if(k==='query')continue;const v=n[k];if(Array.isArray(v)){if(v.some(x=>Array.isArray(x)?x.some(hasAgg):hasAgg(x)))return true;}else if(v&&typeof v==='object'&&hasAgg(v))return true;}
  return false;
}
function charge(db,n){db.used+=n;if(db.used>BUDGET)throw new E('this practice database stopped the query: it ran too long. Narrow it down with WHERE or a JOIN ... ON condition.',null);}

function compileQuery(db,q,parent,ctes){
  ctes=new Map(ctes||[]);
  const cteSteps=[];
  for(const c of q.with||[]){
    if(ctes.has(c.name)&&cteSteps.some(s=>s.name===c.name))throw new E('WITH query name "'+c.name+'" specified more than once',c.pos);
    const cq=compileQuery(db,c.query,null,ctes);
    const rel={name:c.name,cols:cq.cols,q:cq,rows:null};
    ctes.set(c.name,rel);cteSteps.push(rel);
  }
  // FROM: a tree of sources; each leaf becomes one rel of the scope
  const scope={rels:[],parent,width:0};
  const leaves=[];
  function addRel(alias,cols,pos,pk){
    if(scope.rels.some(r=>r.alias===alias))throw new E('table name "'+alias+'" specified more than once',pos);
    const r={alias,cols,off:scope.width,pk};scope.rels.push(r);scope.width+=cols.length;return r;
  }
  function src(f){
    if(f.type==='table'){
      if(f.schema&&f.schema!=='public')throw new E('relation "'+f.schema+'.'+f.name+'" does not exist',f.pos);
      const c=!f.schema&&ctes.get(f.name);
      if(c){const r=addRel(f.alias,c.cols,f.pos);return {kind:'cte',rel:r,cte:c};}
      const t=db.tables[f.name];
      if(!t){const near=closest(f.name,Object.keys(db.tables));throw new E('relation "'+f.name+'" does not exist',f.pos,near?'Perhaps you meant the table "'+near+'".':'The tables here are '+Object.keys(db.tables).join(', ')+'.');}
      const r=addRel(f.alias,t.cols,f.pos,t.pk);return {kind:'table',rel:r,table:t};
    }
    if(f.type==='sub'){const cq=compileQuery(db,f.query,null,ctes);const r=addRel(f.alias,cq.cols,f.pos);return {kind:'sub',rel:r,q:cq};}
    const L=src(f.left),R=src(f.right);
    const node={kind:'join',jk:f.kind,L,R,on:null,pos:f.pos};
    joins.push([node,f]);
    return node;
  }
  const joins=[];
  const tree=q.from?src(q.from):null;
  const grouped=q.group.length>0||q.cols.some(c=>!c.star&&hasAgg(c.expr))||hasAgg(q.having)||q.order.some(o=>hasAgg(o.expr));
  const st={db,scope,ctes,grouped,groupKeys:[],wins:[],q};
  // ON conditions see the rels joined so far (all of them here: the names are checked, not the order)
  for(const [node,f] of joins)if(f.on){node.on=expr(st,f.on,{where:'JOIN/ON'});needBool(node.on,'JOIN/ON',f.on.pos);}
  const where=q.where?expr(st,q.where,{where:'WHERE'}):null;
  if(where)needBool(where,'WHERE',q.where.pos);
  st.groupKeys=q.group.map(g=>{
    if(g.t==='lit'&&typeof g.v==='number'&&Number.isInteger(g.v)){const i=g.v-1,c=q.cols[i];if(!c||c.star)throw new E('GROUP BY position '+g.v+' is not in select list',g.pos);return {node:c.expr,c:expr(st,c.expr,{where:'GROUP BY'})};}
    if(g.t==='col'&&!g.table){const i=q.cols.findIndex(c=>!c.star&&c.alias===g.name);if(i>=0&&!findCol(scope,g,true))return {node:q.cols[i].expr,c:expr(st,q.cols[i].expr,{where:'GROUP BY'})};}
    return {node:g,c:expr(st,g,{where:'GROUP BY'})};
  });
  st.inGroup=true;
  // the select list
  const out=[];
  for(const c of q.cols){
    if(c.star){
      const rels=c.table?scope.rels.filter(r=>r.alias===c.table):scope.rels;
      if(c.table&&!rels.length)throw new E('missing FROM-clause entry for table "'+c.table+'"',c.pos);
      if(!scope.rels.length)throw new E('SELECT * with no tables specified is not valid',c.pos);
      for(const r of rels)r.cols.forEach((col,i)=>{const at=r.off+i;out.push({name:col.name,ty:col.type,cluster:col.cluster,ev:x=>x.row[at],node:{t:'col',table:r.alias,name:col.name}});
        if(grouped)checkGrouped(st,{t:'col',table:r.alias,name:col.name,pos:c.pos},{rel:r,idx:i});});
      continue;
    }
    const e=expr(st,c.expr,{where:'SELECT'});
    out.push({name:c.alias||e.name||'?column?',ty:e.ty,cluster:e.cluster,ev:e.ev,node:c.expr});
  }
  const having=q.having?expr(st,q.having,{where:'HAVING'}):null;
  if(having)needBool(having,'HAVING',q.having.pos);
  if(q.having&&!grouped)throw new E('HAVING needs GROUP BY or an aggregate',q.having.pos);
  // ORDER BY: an output column by name or position, or any expression
  const order=q.order.map(o=>{
    const e=o.expr;
    if(e.t==='lit'&&typeof e.v==='number'&&Number.isInteger(e.v)){if(e.v<1||e.v>out.length)throw new E('ORDER BY position '+e.v+' is not in select list',e.pos);return {out:e.v-1,desc:o.desc,nulls:o.nulls};}
    // an output column's name wins over an input column's, as in PostgreSQL
    if(e.t==='col'&&!e.table){const hits=out.map((c,i)=>[c,i]).filter(([c])=>c.name===e.name);if(hits.length===1)return {out:hits[0][1],desc:o.desc,nulls:o.nulls};
      if(hits.length>1)throw new E('ORDER BY "'+e.name+'" is ambiguous',e.pos);}
    const match=out.findIndex(c=>c.node&&strip(c.node)===strip(e));
    if(match>=0)return {out:match,desc:o.desc,nulls:o.nulls};
    if(q.distinct)throw new E('for SELECT DISTINCT, ORDER BY expressions must appear in select list',e.pos);
    return {c:expr(st,e,{where:'ORDER BY'}),desc:o.desc,nulls:o.nulls};
  });
  const lim=q.limit?constInt(st,q.limit,'LIMIT'):null,off=q.offset?constInt(st,q.offset,'OFFSET'):null;

  // running it
  function rowsOf(node,ctx){
    if(node.kind==='table')return node.table.rows;
    if(node.kind==='cte'){if(!node.cte.rows)node.cte.rows=node.cte.q.run(null);return node.cte.rows;}
    if(node.kind==='sub')return node.q.run(null);
    return null;
  }
  function product(node,ctx){
    // returns arrays of the full scope width, with only this node's columns filled
    if(node.kind!=='join'){
      const rs=rowsOf(node,ctx),r=node.rel;charge(db,rs.length);
      return rs.map(x=>{const a=new Array(scope.width).fill(null);for(let i=0;i<x.length;i++)a[r.off+i]=x[i];return a;});
    }
    const L=product(node.L,ctx),R=product(node.R,ctx),res=[];
    const rCols=[];(function walk(n){if(n.kind==='join'){walk(n.L);walk(n.R);}else for(let i=0;i<n.rel.cols.length;i++)rCols.push(n.rel.off+i);})(node.R);
    for(const l of L){
      let hit=false;
      for(const r of R){
        const a=l.slice();for(const i of rCols)a[i]=r[i];
        charge(db,1);
        if(!node.on||node.on.ev({row:a,parent:ctx})===true){res.push(a);hit=true;if(res.length>MAXJOIN)throw new E('this practice database stops a join at '+MAXJOIN+' rows. Add a JOIN ... ON or WHERE condition so fewer pairs are made.',node.pos);}
      }
      if(!hit&&node.jk==='left')res.push(l.slice());
    }
    return res;
  }
  function run(pctx){
    for(const c of cteSteps)c.rows=null;
    let rows=tree?product(tree,pctx):[new Array(0)];
    if(where)rows=rows.filter(r=>{charge(db,1);return where.ev({row:r,parent:pctx})===true;});
    let units; // {row, group}
    if(grouped){
      const m=new Map();
      for(const r of rows){const ctx={row:r,parent:pctx};const k=st.groupKeys.map(g=>keyOf(g.c.ev(ctx))).join('\u0001');if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
      units=[...m.values()].map(g=>({row:g[0],group:g}));
      if(!q.group.length&&!units.length)units=[{row:new Array(scope.width).fill(null),group:[]}];
    }else units=rows.map(r=>({row:r,group:null}));
    let ctxs=units.map((u,i)=>({row:u.row,group:u.group,parent:pctx,ri:i,wins:null}));
    if(having)ctxs=ctxs.filter(x=>having.ev(x)===true);
    // windows
    if(st.wins.length){
      ctxs.forEach((x,i)=>{x.ri=i;x.wins=[];});
      for(const w of st.wins){
        const parts=new Map();
        ctxs.forEach(x=>{const k=w.part.map(p=>keyOf(p.ev(x))).join('\u0001');if(!parts.has(k))parts.set(k,[]);parts.get(k).push(x);});
        for(const list of parts.values()){
          let ordered=list;
          if(w.order.length)ordered=list.slice().sort((a,b)=>{for(const o of w.order){const c=sortCmp(o.c.ev(a),o.c.ev(b),o);if(c)return c;}return 0;});
          const args=ordered.map(x=>w.args.map(a=>a.ev(x)));
          charge(db,args.length*args.length);
          const vals=w.agg?(()=>{const v=w.f.impl(args,w.call);return args.map(()=>v);})():w.f.impl(args,w.call);
          ordered.forEach((x,i)=>{x.wins[w.id]=vals[i];});
        }
      }
    }
    let res=ctxs.map(x=>({x,vals:out.map(c=>c.ev(x))}));
    if(q.distinct){const seen=new Set();res=res.filter(r=>{const k=r.vals.map(keyOf).join('\u0001');if(seen.has(k))return false;seen.add(k);return true;});}
    if(order.length){
      const keyed=res.map((r,i)=>({r,i,k:order.map(o=>o.out!==undefined?r.vals[o.out]:o.c.ev(r.x))}));
      keyed.sort((a,b)=>{for(let j=0;j<order.length;j++){const c=sortCmp(a.k[j],b.k[j],order[j]);if(c)return c;}return a.i-b.i;});
      res=keyed.map(k=>k.r);
    }
    if(off!==null)res=res.slice(off);
    if(lim!==null)res=res.slice(0,lim);
    return res.map(r=>r.vals);
  }
  return {cols:out.map(c=>({name:c.name,type:c.ty,cluster:!!c.cluster})),run};
}
function sortCmp(a,b,o){
  const nullsFirst=o.nulls?o.nulls==='first':o.desc;
  if(a===null&&b===null)return 0;
  if(a===null)return nullsFirst?-1:1;
  if(b===null)return nullsFirst?1:-1;
  const c=cmp(a,b);return o.desc?-c:c;
}
function constInt(st,n,what){
  const e=expr({...st,scope:{rels:[],parent:null,width:0},grouped:false,wins:[]},n,{where:what});
  if(!['integer','bigint','unknown'].includes(e.ty))throw new E('argument of '+what+' must be type bigint, not type '+e.ty,n.pos);
  const v=e.ev({row:[],parent:null});
  if(v===null)return null;
  const k=+v;if(!Number.isInteger(k))throw new E('invalid input syntax for type bigint: "'+v+'"',n.pos);
  if(k<0)throw new E(what+' must not be negative',n.pos);
  return k;
}
function needBool(e,where,pos){if(e.ty!=='boolean'&&e.ty!=='unknown')throw new E('argument of '+where+' must be type boolean, not type '+e.ty,pos);}

/* find a column in the scope chain: {depth, rel, idx} */
function findCol(scope,n,quiet){
  let depth=0;
  for(let s=scope;s;s=s.parent,depth++){
    if(n.table){
      const r=s.rels.find(r=>r.alias===n.table);
      if(!r)continue;
      const i=r.cols.findIndex(c=>c.name===n.name);
      if(i<0){if(quiet)return null;throw new E('column '+n.table+'.'+n.name+' does not exist',n.pos,hintCol(scope,n.name));}
      return {depth,rel:r,idx:i};
    }
    const hits=[];
    for(const r of s.rels)r.cols.forEach((c,i)=>{if(c.name===n.name)hits.push({depth,rel:r,idx:i});});
    if(hits.length>1){if(quiet)return null;throw new E('column reference "'+n.name+'" is ambiguous',n.pos,'Write which table it comes from: '+hits.map(h=>h.rel.alias+'.'+n.name).join(' or ')+'.');}
    if(hits.length)return hits[0];
  }
  if(quiet)return null;
  if(n.table)throw new E('missing FROM-clause entry for table "'+n.table+'"',n.pos,scope.rels.length?'The tables in FROM are called '+scope.rels.map(r=>r.alias).join(', ')+' here.':null);
  throw new E('column "'+n.name+'" does not exist',n.pos,hintCol(scope,n.name));
}
function hintCol(scope,name){
  const all=[];for(let s=scope;s;s=s.parent)for(const r of s.rels)for(const c of r.cols)all.push([r.alias,c.name]);
  const best=closest(name,all.map(x=>x[1]));
  if(best)return 'Perhaps you meant to reference the column "'+all.find(x=>x[1]===best).join('.')+'".';
  if(!scope.rels.length)return 'There is no FROM, so there are no columns to read. Add FROM and a table name.';
  return null;
}
function checkGrouped(st,n,hit){
  if(st.aggDepth||st.groupOk)return;
  if(hit.depth)return;
  const same=st.groupKeys.some(g=>{if(g.node.t!=='col')return false;const h=findCol(st.scope,g.node,true);return h&&h.rel===hit.rel&&h.idx===hit.idx;});
  if(same)return;
  if(hit.rel.pk&&st.groupKeys.some(g=>{if(g.node.t!=='col')return false;const h=findCol(st.scope,g.node,true);return h&&h.rel===hit.rel&&h.rel.cols[h.idx].name===hit.rel.pk;}))return;
  throw new E('column "'+hit.rel.alias+'.'+n.name+'" must appear in the GROUP BY clause or be used in an aggregate function',n.pos);
}

/* compile one expression in a query's state st; o.where names the clause, for errors */
function expr(st,n,o){
  const {db,scope}=st;
  // inside a grouped query, a whole expression that is a GROUP BY key is fine as it is
  if(st.grouped&&st.inGroup&&!st.aggDepth&&!st.groupOk&&st.groupKeys.some(g=>strip(g.node)===strip(n))){st.groupOk=true;try{return expr(st,n,o);}finally{st.groupOk=false;}}
  switch(n.t){
    case 'lit':return {ty:n.ty,ev:()=>n.v,name:null};
    case 'col':{
      const h=findCol(scope,n);
      const col=h.rel.cols[h.idx],at=h.rel.off+h.idx,d=h.depth;
      if(st.grouped&&st.inGroup)checkGrouped(st,n,h);
      const ev=d===0?(x=>x.row[at]):(x=>{let c=x;for(let k=0;k<d;k++)c=c.parent;return c.row[at];});
      return {ty:col.type,ev,name:col.name,cluster:col.cluster};
    }
    case 'cast':{
      const a=expr(st,n.a,o);
      if(a.ty==='geometry'&&isNum(n.to))throw new E('cannot cast type geometry to '+n.to,n.pos);
      return {ty:n.to,ev:x=>cast(a.ev(x),a.ty,n.to,n.pos),name:a.name||(n.to==='text'?'text':n.to==='geometry'?'geometry':n.to),cluster:a.cluster};
    }
    case 'neg':{const a=expr(st,n.a,o);if(!isNum(a.ty)&&a.ty!=='unknown')throw new E('operator does not exist: - '+a.ty,n.pos);return {ty:a.ty==='unknown'?'numeric':a.ty,ev:x=>{const v=a.ev(x);return v===null?null:-coerce(v,'numeric',n.pos);},name:null};}
    case 'not':{const a=expr(st,n.a,o);needBool(a,'NOT',n.pos);return {ty:'boolean',ev:x=>{const v=a.ev(x);return v===null?null:!v;},name:null};}
    case 'isnull':{const a=expr(st,n.a,o);return {ty:'boolean',ev:x=>(a.ev(x)===null)!==n.not,name:null};}
    case 'istrue':{const a=expr(st,n.a,o);needBool(a,'IS '+(n.v?'TRUE':'FALSE'),n.pos);return {ty:'boolean',ev:x=>(a.ev(x)===n.v)!==n.not,name:null};}
    case 'distinctfrom':{const a=expr(st,n.a,o),b=expr(st,n.b,o);return {ty:'boolean',ev:x=>(keyOf(a.ev(x))!==keyOf(b.ev(x)))!==n.not,name:null};}
    case 'bin':return binary(st,n,o);
    case 'in':{
      const a=expr(st,n.a,o),list=n.list.map(e=>expr(st,e,o));
      for(const l of list)compareTypes(a.ty,l.ty,'=',n.pos);
      return {ty:'boolean',name:null,ev:x=>{const v=a.ev(x);if(v===null)return null;let nul=false;for(const l of list){let w=l.ev(x);if(w===null){nul=true;continue;}w=l.ty==='unknown'?coerce(w,a.ty,n.pos):w;if(cmp(v,w)===0&&keyOf(v)===keyOf(w)||typeof v==='number'&&v===w)return !n.not;}return nul?null:n.not;}};
    }
    case 'like':{
      const a=expr(st,n.a,o),b=expr(st,n.b,o);
      if(!['text','unknown'].includes(a.ty)||!['text','unknown'].includes(b.ty))throw new E('operator does not exist: '+a.ty+' ~~ '+b.ty,n.pos,'No operator matches the given name and argument types. You might need to add explicit type casts.');
      return {ty:'boolean',name:null,ev:x=>{const v=a.ev(x),p=b.ev(x);if(v===null||p===null)return null;const re=new RegExp('^'+p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'[\\s\\S]*').replace(/_/g,'[\\s\\S]')+'$',n.ci?'i':'');return re.test(v)!==n.not;}};
    }
    case 'between':{
      const a=expr(st,n.a,o),lo=expr(st,n.lo,o),hi=expr(st,n.hi,o);
      compareTypes(a.ty,lo.ty,'>=',n.pos);compareTypes(a.ty,hi.ty,'<=',n.pos);
      return {ty:'boolean',name:null,ev:x=>{const v=a.ev(x),l=lo.ev(x),h=hi.ev(x);if(v===null||l===null||h===null)return null;const r=cmp(v,coerce(l,a.ty))>=0&&cmp(v,coerce(h,a.ty))<=0;return r!==n.not;}};
    }
    case 'case':{
      const base=n.base?expr(st,n.base,o):null;
      const ws=n.whens.map(([w,t])=>[expr(st,w,o),expr(st,t,o)]),other=n.other?expr(st,n.other,o):null;
      if(!base)for(const [w] of ws)needBool(w,'CASE/WHEN',n.pos);
      const tys=[...ws.map(w=>w[1].ty),...(other?[other.ty]:[])].filter(t=>t!=='unknown');
      const ty=tys.length?tys.reduce((a,b)=>{if(a===b)return a;if(isNum(a)&&isNum(b))return promote(a,b);throw new E('CASE types '+a+' and '+b+' cannot be matched',n.pos);}):'text';
      return {ty,name:'case',ev:x=>{const bv=base?base.ev(x):null;for(const [w,t] of ws){const c=w.ev(x);if(base?(bv!==null&&c!==null&&cmp(bv,c)===0):c===true)return t.ev(x);}return other?other.ev(x):null;}};
    }
    case 'row':throw new E('this practice database does not support row values like (a, b) yet',n.pos);
    case 'sub':{
      const cq=compileQuery(db,n.query,scope,st.ctes);
      if(cq.cols.length!==1)throw new E('subquery must return only one column',n.pos);
      return {ty:cq.cols[0].type,name:cq.cols[0].name,ev:x=>{const r=cq.run(x);if(r.length>1)throw new E('more than one row returned by a subquery used as an expression',n.pos);return r.length?r[0][0]:null;}};
    }
    case 'exists':{const cq=compileQuery(db,n.query,scope,st.ctes);return {ty:'boolean',name:'exists',ev:x=>cq.run(x).length>0};}
    case 'insub':{
      const a=expr(st,n.a,o),cq=compileQuery(db,n.query,scope,st.ctes);
      if(cq.cols.length!==1)throw new E('subquery has too many columns',n.pos);
      compareTypes(a.ty,cq.cols[0].type,'=',n.pos);
      return {ty:'boolean',name:null,ev:x=>{const v=a.ev(x);if(v===null)return null;const rs=cq.run(x);let nul=false;for(const r of rs){if(r[0]===null){nul=true;continue;}if(keyOf(r[0])===keyOf(v)||cmp(r[0],v)===0&&typeof v==='number')return !n.not;}return nul?null:n.not;}};
    }
    case 'call':return call(st,n,o);
  }
  throw new E('this practice database does not support that expression yet',n.pos);
}
function compareTypes(a,b,op,pos){
  if(a==='unknown'||b==='unknown'||a===b)return;
  if(isNum(a)&&isNum(b))return;
  throw new E('operator does not exist: '+a+' '+op+' '+b,pos,'No operator matches the given name and argument types. You might need to add explicit type casts.');
}
function binary(st,n,o){
  const a=expr(st,n.a,o),b=expr(st,n.b,o),op=n.op;
  const nameless=(ty,ev)=>({ty,ev,name:null});
  if(op==='and'||op==='or'){
    needBool(a,op.toUpperCase(),n.pos);needBool(b,op.toUpperCase(),n.pos);
    return nameless('boolean',op==='and'?x=>{const l=a.ev(x);if(l===false)return false;const r=b.ev(x);if(r===false)return false;return l===null||r===null?null:true;}
      :x=>{const l=a.ev(x);if(l===true)return true;const r=b.ev(x);if(r===true)return true;return l===null||r===null?null:false;});
  }
  if(op==='<->'){
    const ok=t=>t==='geometry'||t==='unknown';
    if(!ok(a.ty)||!ok(b.ty))throw new E('operator does not exist: '+a.ty+' <-> '+b.ty,n.pos,'No operator matches the given name and argument types. You might need to add explicit type casts.');
    return nameless('double precision',x=>{const l=coerce(a.ev(x),'geometry',n.pos),r=coerce(b.ev(x),'geometry',n.pos);if(l===null||r===null)return null;mixed('ST_Distance',l,r,n.pos);charge(st.db,10);return REL.distance(l,r);});
  }
  if(op==='||'){
    if(a.ty==='geometry'||b.ty==='geometry')throw new E('operator does not exist: '+a.ty+' || '+b.ty,n.pos);
    return nameless('text',x=>{const l=a.ev(x),r=b.ev(x);if(l===null||r===null)return null;const s=(v,t)=>typeof v==='number'?show(v,t):typeof v==='boolean'?(v?'true':'false'):String(v);return s(l,a.ty)+s(r,b.ty);});
  }
  if(['=','<>','<','>','<=','>='].includes(op)){
    if((a.ty==='geometry'||b.ty==='geometry')&&!['=','<>'].includes(op)&&!(a.ty==='geometry'&&b.ty==='geometry'))throw new E('operator does not exist: '+a.ty+' '+op+' '+b.ty,n.pos);
    compareTypes(a.ty,b.ty,op,n.pos);
    const ty=a.ty==='unknown'?b.ty:a.ty;
    return nameless('boolean',x=>{
      let l=a.ev(x),r=b.ev(x);if(l===null||r===null)return null;
      if(a.ty==='unknown'&&b.ty!=='unknown')l=coerce(l,b.ty,n.pos);
      if(b.ty==='unknown'&&a.ty!=='unknown')r=coerce(r,a.ty,n.pos);
      const c=ty==='geometry'?(G.hex(l)===G.hex(r)?0:1):cmp(l,r);
      return op==='='?c===0:op==='<>'?c!==0:op==='<'?c<0:op==='>'?c>0:op==='<='?c<=0:c>=0;
    });
  }
  // + - * / %
  const at=a.ty==='unknown'?'numeric':a.ty,bt=b.ty==='unknown'?'numeric':b.ty;
  if(!isNum(at)||!isNum(bt))throw new E('operator does not exist: '+a.ty+' '+op+' '+b.ty,n.pos,'No operator matches the given name and argument types. You might need to add explicit type casts.');
  const ty=promote(at,bt),intish=ty==='integer'||ty==='bigint';
  return nameless(ty,x=>{
    let l=a.ev(x),r=b.ev(x);if(l===null||r===null)return null;
    l=coerce(l,'numeric',n.pos);r=coerce(r,'numeric',n.pos);
    switch(op){
      case '+':return l+r;case '-':return l-r;case '*':return l*r;
      case '/':if(r===0)throw new E('division by zero',n.pos);return intish?Math.trunc(l/r):l/r;
      default:if(r===0)throw new E('division by zero',n.pos);return l%r;
    }
  });
}
function call(st,n,o){
  const list=FN[n.name];
  const named=Object.keys(n.named);
  const where=o.where;
  if(!list){
    const near=closest(n.name,KNOWN);
    throw new E('function '+n.name+'('+(n.star?'*':n.args.map(a=>argType(st,a,o)).join(', '))+') does not exist',n.pos,
      'No function matches the given name and argument types. You might need to add explicit type casts.'+(near?' Did you mean '+near+'?':''));
  }
  // aggregates and windows: where they may appear, and their arguments
  const isWin=!!n.over,aggName=list.some(f=>f.agg),winOnly=list.every(f=>f.win);
  if(winOnly&&!isWin)throw new E('window function '+n.name+' requires an OVER clause',n.pos);
  if(isWin&&!aggName&&!list.some(f=>f.win))throw new E('OVER specified, but '+n.name+' is not a window function nor an aggregate function',n.pos);
  if(isWin&&(where==='WHERE'||where==='JOIN/ON'||where==='GROUP BY'||where==='HAVING'))throw new E('window functions are not allowed in '+where,n.pos);
  if(isWin&&st.grouped)throw new E('this practice database does not support window functions in a query that groups yet; group in an outer query (WITH ... AS) instead',n.pos);
  let args;
  if(n.star){if(n.name!=='count')throw new E(n.name+'(*) must be used to call a parameterless aggregate function',n.pos);args=[];}
  const sub=(e)=>{const prev=st.aggDepth;st.aggDepth=(prev||0)+1;try{return expr(st,e,{where:'aggregate'});}finally{st.aggDepth=prev;}};
  // is this an aggregate call? only if some overload of that arity is one
  const arity=n.args.length+named.length;
  const aggCall=!n.star?list.some(f=>f.agg&&f.params.length===arity)&&!list.some(f=>!f.agg&&!f.win&&(f.params.length===arity||f.variadic)):true;
  if(aggCall&&!isWin){
    if(where==='WHERE'||where==='JOIN/ON')throw new E('aggregate functions are not allowed in '+where,n.pos,where==='WHERE'?'Use HAVING to filter groups after GROUP BY.':null);
    if(where==='GROUP BY')throw new E('aggregate functions are not allowed in GROUP BY',n.pos);
    if(st.aggDepth)throw new E('aggregate function calls cannot be nested',n.pos);
  }
  if(!n.star)args=(aggCall&&!isWin)?n.args.map(sub):n.args.map(e=>expr(st,e,o));
  // named arguments go into their places
  let f=null;
  if(named.length){
    f=list.find(x=>x.names&&named.every(k=>x.names.includes(k))&&x.params.length===arity);
    if(!f)throw new E('function '+n.name+'('+[...n.args.map(a=>argType(st,a,o)),...named.map(k=>k+' => '+argType(st,n.named[k],o))].join(', ')+') does not exist',n.pos,'No function matches the given name and argument types. Check the names before :=.');
    const placed=args.slice();
    for(const k of named){const i=f.names.indexOf(k);if(i<args.length)throw new E('argument "'+k+'" is given twice',n.pos);placed[i]=(aggCall&&!isWin)?sub(n.named[k]):expr(st,n.named[k],o);}
    if(placed.some(a=>!a))throw new E('function '+n.name+' needs every argument',n.pos);
    args=placed;
  }
  const tys=n.star?[]:args.map(a=>a.ty);
  if(!f)f=list.find(x=>{
    if(n.star)return x.agg;
    if(x.variadic)return tys.length>=1&&tys.every(t=>fits(t,x.params[0]));
    return x.params.length===tys.length&&tys.every((t,i)=>fits(t,x.params[i]))&&(!!x.agg===(aggCall&&!isWin)||isWin&&x.agg||x.win);
  });
  if(!f)throw new E('function '+n.name+'('+tys.map(tname).join(', ')+') does not exist',n.pos,'No function matches the given name and argument types. You might need to add explicit type casts.'+hintTypes(n.name,tys));
  const ty=typeof f.ret==='function'?f.ret(tys):f.ret;
  const want=i=>f.variadic?f.params[0]:f.params[i];
  const c={pos:n.pos,argPos:n.args.map(a=>a.pos)};
  const name=n.name;
  const prep=(vals)=>vals.map((v,i)=>{if(tys[i]==='unknown')return coerce(v,want(i)==='int'?'integer':want(i),n.args[i]?.pos);if(want(i)==='int'&&typeof v==='number'&&!Number.isInteger(v))return Math.round(v);return v;});
  if(isWin){
    const id=st.wins.length,part=n.over.partition.map(e=>expr(st,e,{where:'window'}));
    const ord=n.over.order.map(x=>({c:expr(st,x.expr,{where:'window'}),desc:x.desc,nulls:x.nulls}));
    if(f.agg&&ord.length)throw new E('this practice database does not support ORDER BY in the OVER of an aggregate yet',n.pos);
    st.wins.push({id,f:{impl:(rows,cc)=>f.impl(rows.map(prep),cc)},args:n.star?[]:args,part,order:ord,call:c,agg:!!f.agg});
    return {ty,name,cluster:!!f.cluster,ev:x=>x.wins?x.wins[id]:null};
  }
  if(f.agg){
    const distinct=n.distinct;
    return {ty,name,ev:x=>{
      const g=x.group||[];charge(st.db,g.length);
      let rows=n.star?g.map(()=>[1]):g.map(r=>prep(args.map(a=>a.ev({row:r,parent:x.parent}))));
      if(distinct){const seen=new Set();rows=rows.filter(r=>{const k=r.map(keyOf).join('\u0001');if(seen.has(k))return false;seen.add(k);return true;});}
      return f.impl(rows,c);
    }};
  }
  const strict=f.strict!==false;
  return {ty,name,ev:x=>{
    const vals=prep(args.map(a=>a.ev(x)));
    if(strict&&vals.some(v=>v===null))return null;
    charge(st.db,vals.some(v=>G.isGeom(v))?10:1);
    return f.impl(vals,c);
  }};
}
function argType(st,a,o){try{return tname(expr(st,a,o).ty);}catch(e){return 'unknown';}}
// a hint for the usual mix-ups: round of a double, a text where a geometry belongs
function hintTypes(name,tys){
  if(name==='round'&&tys[0]==='double precision'&&tys.length===2)return ' round(x, n) needs a numeric: write round(x::numeric, n).';
  if(name.startsWith('st_')&&tys.includes('text'))return ' A text value is not a geometry: drop ST_AsText here, or wrap the text in ST_GeomFromText.';
  return '';
}

/* ---------- running SQL ---------- */
PQ.createDb=tables=>{
  const t={};
  for(const [name,x] of Object.entries(tables))t[name]={cols:x.cols.map(c=>({name:c.name,type:c.type})),rows:x.rows,pk:x.pk||null};
  return {tables:t,used:0};
};
/* run every statement; stop at the first error. results: [{cols, rows, cmd}] */
PQ.run=(db,sql)=>{
  const results=[];
  let stmts;
  try{stmts=PQ.parse(String(sql??''));}catch(e){return {ok:false,results,error:errOf(e),stmts:[]};}
  for(const s of stmts){
    db.used=0;
    try{
      const q=compileQuery(db,s,null,null);
      const rows=q.run(null);
      results.push({cols:q.cols,rows,cmd:'SELECT '+rows.length,ast:s});
    }catch(e){return {ok:false,results,error:errOf(e),stmts};}
  }
  return {ok:true,results,error:null,stmts};
};
function errOf(e){
  if(e instanceof E)return {message:e.message,pos:e.pos,hint:e.hint};
  if(e instanceof RangeError)return {message:'this practice database stopped the query: it is nested too deeply',pos:null,hint:null};
  return {message:'something went wrong inside this practice database: '+(e&&e.message||e),pos:null,hint:null,internal:true};
}
/* psql-style text: the error with its LINE and caret, like
   ERROR:  column "nme" does not exist
   LINE 1: SELECT nme FROM places;
                  ^                                                                                                     */
PQ.errorText=(sql,err)=>{
  const out=['ERROR:  '+err.message];
  if(err.pos!==null&&err.pos!==undefined&&sql){
    const before=sql.slice(0,err.pos),line=before.split('\n').length,start=before.lastIndexOf('\n')+1;
    let end=sql.indexOf('\n',err.pos);if(end<0)end=sql.length;
    const prefix='LINE '+line+': ';
    out.push(prefix+sql.slice(start,end));
    out.push(' '.repeat(prefix.length+err.pos-start)+'^');
  }
  if(err.hint)out.push('HINT:  '+err.hint);
  return out.join('\n');
};
})();
