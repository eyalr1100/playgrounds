/* PostGIS Quest geometry: values, WKT and EWKT in and out, hex EWKB, planar measures, centroid, envelope, convex hull,
   point buffers and the spherical distance of ST_DistanceSphere. A geometry is {type, srid, c} with c the coordinates
   (Point [x,y], LineString [[x,y]...], Polygon [ring...], Multi* lists of those) or {type:'GeometryCollection', srid, g}.
   Coordinates are x (longitude) then y (latitude), as in PostGIS. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const G=PQ.geo={};
const err=(m,h)=>new PQ.SqlError(m,null,h);
const NAMES={point:'Point',linestring:'LineString',polygon:'Polygon',multipoint:'MultiPoint',multilinestring:'MultiLineString',multipolygon:'MultiPolygon',geometrycollection:'GeometryCollection'};
const CODE={Point:1,LineString:2,Polygon:3,MultiPoint:4,MultiLineString:5,MultiPolygon:6,GeometryCollection:7};
G.isGeom=v=>!!v&&typeof v==='object'&&typeof v.type==='string'&&v.type in CODE;
G.dim=g=>({Point:0,MultiPoint:0,LineString:1,MultiLineString:1,Polygon:2,MultiPolygon:2}[g.type]??Math.max(-1,...g.g.map(G.dim)));
G.make=(type,c,srid)=>({type,c,srid:srid||0});

/* ---------- WKT in ---------- */
G.parse=(text)=>{
  let s=String(text).trim(),srid=0;
  const sm=/^SRID=(-?\d+);/i.exec(s);if(sm){srid=+sm[1];s=s.slice(sm[0].length);}
  if(/^(00|01)[0-9A-F]+$/i.test(s)&&s.length>=10)return G.fromHex(s);
  let i=0;
  const bad=()=>err('parse error - invalid geometry',"\""+s.slice(0,Math.max(i,1)+8)+"\" <-- parse error at position "+i+" within geometry");
  const ws=()=>{while(i<s.length&&/\s/.test(s[i]))i++;};
  const word=()=>{ws();const m=/^[A-Za-z]+/.exec(s.slice(i));if(!m)throw bad();i+=m[0].length;return m[0].toLowerCase();};
  const ch=c=>{ws();if(s[i]!==c)throw bad();i++;};
  const peekc=()=>{ws();return s[i];};
  const num=()=>{ws();const m=/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));if(!m)throw bad();i+=m[0].length;return +m[0];};
  const pt=()=>{const x=num(),y=num();if(/[-+.\d]/.test(peekc()||''))throw err('this practice database works in 2D: give each point an x and a y only');return [x,y];};
  const list=f=>{ch('(');const a=[f()];while(peekc()===','){i++;a.push(f());}ch(')');return a;};
  const ring=()=>list(pt);
  function geom(){
    const w=word(),type=NAMES[w];
    if(!type)throw bad();
    if(w!=='geometrycollection'&&/^\s*(z|m|zm)\b/i.test(s.slice(i)))throw err('this practice database works in 2D: drop the Z or M');
    ws();if(/^empty\b/i.test(s.slice(i))){i+=5;return {type,srid,c:type==='Point'?null:[],g:type==='GeometryCollection'?[]:undefined,empty:true};}
    if(type==='Point'){ch('(');const c=pt();ch(')');return {type,srid,c};}
    if(type==='LineString')return {type,srid,c:list(pt)};
    if(type==='Polygon')return {type,srid,c:list(ring)};
    if(type==='MultiPoint')return {type,srid,c:list(()=>{if(peekc()==='('){ch('(');const c=pt();ch(')');return c;}return pt();})};
    if(type==='MultiLineString')return {type,srid,c:list(()=>list(pt))};
    if(type==='MultiPolygon')return {type,srid,c:list(()=>list(ring))};
    return {type,srid,g:list(geom)};
  }
  const g=geom();ws();
  if(i<s.length)throw bad();
  if(g.empty)throw err('this practice database does not support EMPTY geometries yet');
  G.validate(g);
  return g;
};
/* what PostGIS refuses while reading: too few points and rings that do not close */
G.validate=g=>{
  const each=(x)=>{
    if(x.type==='GeometryCollection'){x.g.forEach(each);return;}
    if(x.type==='LineString'&&x.c.length<2)throw err('geometry requires more points','LineString needs at least two points');
    if(x.type==='MultiLineString')x.c.forEach(l=>{if(l.length<2)throw err('geometry requires more points');});
    const polys=x.type==='Polygon'?[x.c]:x.type==='MultiPolygon'?x.c:[];
    for(const p of polys)for(const r of p){
      if(r.length<4)throw err('geometry requires more points','A polygon ring needs at least four points: three corners and the first one again to close it.');
      const a=r[0],b=r[r.length-1];if(a[0]!==b[0]||a[1]!==b[1])throw err('geometry contains non-closed rings','The last point of a ring must repeat the first one.');
    }
  };
  each(g);return g;
};

/* ---------- WKT, EWKT, GeoJSON out ---------- */
// PostGIS prints the shortest form that reads back, with at most 15 decimals
G.fmt=n=>{const v=+(+n).toFixed(15);return v===0?'0':String(v);};
const P=c=>G.fmt(c[0])+' '+G.fmt(c[1]);
const L=a=>'('+a.map(P).join(',')+')';
const R=p=>'('+p.map(L).join(',')+')';
G.wkt=g=>{
  const T=g.type.toUpperCase();
  switch(g.type){
    case 'Point':return T+'('+P(g.c)+')';
    case 'LineString':return T+L(g.c);
    case 'Polygon':return T+R(g.c);
    case 'MultiPoint':return T+'('+g.c.map(c=>P(c)).join(',')+')';
    case 'MultiLineString':return T+'('+g.c.map(L).join(',')+')';
    case 'MultiPolygon':return T+'('+g.c.map(R).join(',')+')';
    default:return T+'('+g.g.map(G.wkt).join(',')+')';
  }
};
G.ewkt=g=>(g.srid?'SRID='+g.srid+';':'')+G.wkt(g);
G.geojson=(g,digits)=>{
  const d=digits===undefined?9:digits;
  const r=n=>{const v=+(+n).toFixed(d);return Object.is(v,-0)?0:v;};
  const C=c=>[r(c[0]),r(c[1])];
  const o=x=>{
    switch(x.type){
      case 'Point':return {type:'Point',coordinates:C(x.c)};
      case 'LineString':case 'MultiPoint':return {type:x.type,coordinates:x.c.map(C)};
      case 'Polygon':case 'MultiLineString':return {type:x.type,coordinates:x.c.map(a=>a.map(C))};
      case 'MultiPolygon':return {type:x.type,coordinates:x.c.map(p=>p.map(a=>a.map(C)))};
      default:return {type:'GeometryCollection',geometries:x.g.map(o)};
    }
  };
  return JSON.stringify(o(g));
};

/* ---------- hex EWKB (what a bare geometry column prints) ---------- */
G.hex=g=>{
  const out=[];
  const byte=b=>out.push(b.toString(16).padStart(2,'0'));
  const u32=n=>{for(let k=0;k<4;k++)byte((n>>>(8*k))&255);};
  const f64=x=>{const b=new DataView(new ArrayBuffer(8));b.setFloat64(0,x,true);for(let k=0;k<8;k++)byte(b.getUint8(k));};
  const pt=c=>{f64(c[0]);f64(c[1]);};
  const pts=a=>{u32(a.length);a.forEach(pt);};
  const w=(x,top)=>{
    byte(1);u32(CODE[x.type]|(top&&x.srid?0x20000000:0));if(top&&x.srid)u32(x.srid);
    switch(x.type){
      case 'Point':pt(x.c);break;
      case 'LineString':pts(x.c);break;
      case 'Polygon':u32(x.c.length);x.c.forEach(pts);break;
      case 'MultiPoint':u32(x.c.length);x.c.forEach(c=>w({type:'Point',c}));break;
      case 'MultiLineString':u32(x.c.length);x.c.forEach(c=>w({type:'LineString',c}));break;
      case 'MultiPolygon':u32(x.c.length);x.c.forEach(c=>w({type:'Polygon',c}));break;
      default:u32(x.g.length);x.g.forEach(y=>w(y));
    }
  };
  w(g,true);return out.join('').toUpperCase();
};
G.fromHex=h=>{
  const b=new Uint8Array(h.length/2);for(let k=0;k<b.length;k++)b[k]=parseInt(h.substr(k*2,2),16);
  const dv=new DataView(b.buffer);let o=0;
  const bad=()=>err('invalid hex EWKB string');
  const rd=()=>{
    if(o+5>b.length)throw bad();
    const le=b[o]===1;o++;const u=()=>{const v=dv.getUint32(o,le);o+=4;return v;},f=()=>{const v=dv.getFloat64(o,le);o+=8;return v;};
    let t=u(),srid=0;if(t&0x20000000){srid=u();}if(t&0xC0000000)throw err('this practice database works in 2D: drop the Z or M');t&=0xff;
    const pt=()=>[f(),f()],pts=()=>{const n=u();const a=[];for(let k=0;k<n;k++)a.push(pt());return a;};
    const type=Object.keys(CODE).find(k=>CODE[k]===t);if(!type)throw bad();
    let g;
    switch(type){
      case 'Point':g={type,c:pt()};break;
      case 'LineString':g={type,c:pts()};break;
      case 'Polygon':{const n=u(),c=[];for(let k=0;k<n;k++)c.push(pts());g={type,c};break;}
      case 'GeometryCollection':{const n=u(),a=[];for(let k=0;k<n;k++)a.push(rd());g={type,g:a};break;}
      default:{const n=u(),a=[];for(let k=0;k<n;k++)a.push(rd().c);g={type,c:a};}
    }
    g.srid=srid;return g;
  };
  try{const g=rd();return G.validate(g);}catch(e){if(e instanceof PQ.SqlError)throw e;throw bad();}
};

/* ---------- parts, points, segments ---------- */
// the simple pieces of a geometry: points, lines and polygons
G.parts=g=>{
  switch(g.type){
    case 'MultiPoint':return g.c.map(c=>({type:'Point',c}));
    case 'MultiLineString':return g.c.map(c=>({type:'LineString',c}));
    case 'MultiPolygon':return g.c.map(c=>({type:'Polygon',c}));
    case 'GeometryCollection':return g.g.flatMap(G.parts);
    default:return [g];
  }
};
G.verts=g=>G.parts(g).flatMap(p=>p.type==='Point'?[p.c]:p.type==='LineString'?p.c:p.c.flat());
G.segs=g=>{const s=[];for(const p of G.parts(g)){const lines=p.type==='LineString'?[p.c]:p.type==='Polygon'?p.c:[];for(const l of lines)for(let k=0;k+1<l.length;k++)if(l[k][0]!==l[k+1][0]||l[k][1]!==l[k+1][1])s.push([l[k],l[k+1]]);}return s;};
G.npoints=g=>G.verts(g).length;
G.bbox=g=>{const v=G.verts(g);let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const [x,y] of v){if(x<a)a=x;if(y<b)b=y;if(x>c)c=x;if(y>d)d=y;}return {xmin:a,ymin:b,xmax:c,ymax:d};};

/* ---------- measures (planar, in the units of the coordinates: degrees on 4326) ---------- */
// measured from the ring's first point, as PostGIS does, so coordinates far from 0 keep their precision
const ringArea=r=>{const o=r[0];let s=0;for(let k=1;k+1<r.length;k++)s+=(r[k][0]-o[0])*(r[k+1][1]-o[1])-(r[k+1][0]-o[0])*(r[k][1]-o[1]);return s/2;};
const len=l=>{let s=0;for(let k=0;k+1<l.length;k++)s+=Math.hypot(l[k+1][0]-l[k][0],l[k+1][1]-l[k][1]);return s;};
G.area=g=>G.parts(g).reduce((s,p)=>p.type!=='Polygon'?s:s+Math.abs(ringArea(p.c[0]))-p.c.slice(1).reduce((t,r)=>t+Math.abs(ringArea(r)),0),0);
G.length=g=>G.parts(g).reduce((s,p)=>p.type==='LineString'?s+len(p.c):s,0);
G.perimeter=g=>G.parts(g).reduce((s,p)=>p.type==='Polygon'?s+p.c.reduce((t,r)=>t+len(r),0):s,0);
G.typeName=g=>'ST_'+g.type;

/* centroid: area-weighted for polygons, length-weighted for lines, the mean for points; a mix uses its highest dimension */
G.centroid=g=>{
  const parts=G.parts(g),d=Math.max(...parts.map(G.dim));
  let sx=0,sy=0,w=0;
  for(const p of parts){
    if(G.dim(p)!==d)continue;
    if(d===0){sx+=p.c[0];sy+=p.c[1];w+=1;}
    else if(d===1){for(let k=0;k+1<p.c.length;k++){const a=p.c[k],b=p.c[k+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]);sx+=(a[0]+b[0])/2*l;sy+=(a[1]+b[1])/2*l;w+=l;}}
    else p.c.forEach((r,ri)=>{
      // signed area of each ring made positive for the shell and negative for holes, so a hole pulls the centre away
      const A=ringArea(r),sg=(ri===0?1:-1)*Math.sign(A||1);
      // ring centroid about the first vertex, for precision with coordinates far from 0
      const o=r[0];let cx=0,cy=0;
      for(let k=0;k+1<r.length;k++){const x0=r[k][0]-o[0],y0=r[k][1]-o[1],x1=r[k+1][0]-o[0],y1=r[k+1][1]-o[1],cr=x0*y1-x1*y0;cx+=(x0+x1)*cr;cy+=(y0+y1)*cr;}
      if(A!==0){cx=cx/(6*A)+o[0];cy=cy/(6*A)+o[1];}
      const a=Math.abs(A)*sg;sx+=cx*a;sy+=cy*a;w+=a;
    });
  }
  if(!w){ // degenerate (zero length or area): fall back to the mean of the vertices
    const v=G.verts(g);return {type:'Point',srid:g.srid,c:[v.reduce((s,c)=>s+c[0],0)/v.length,v.reduce((s,c)=>s+c[1],0)/v.length]};}
  return {type:'Point',srid:g.srid,c:[sx/w,sy/w]};
};
G.envelope=g=>{const b=G.bbox(g);if(b.xmin===b.xmax&&b.ymin===b.ymax)return {type:'Point',srid:g.srid,c:[b.xmin,b.ymin]};
  if(b.xmin===b.xmax||b.ymin===b.ymax)return {type:'LineString',srid:g.srid,c:[[b.xmin,b.ymin],[b.xmax,b.ymax]]};
  return {type:'Polygon',srid:g.srid,c:[[[b.xmin,b.ymin],[b.xmin,b.ymax],[b.xmax,b.ymax],[b.xmax,b.ymin],[b.xmin,b.ymin]]]};};
G.box=(xmin,ymin,xmax,ymax,srid)=>({type:'Polygon',srid:srid||0,c:[[[xmin,ymin],[xmin,ymax],[xmax,ymax],[xmax,ymin],[xmin,ymin]]]});
/* convex hull (monotone chain); like GEOS's, the ring starts at the lowest point (then the leftmost) and runs clockwise */
G.hull=g=>{
  const v=[...new Map(G.verts(g).map(c=>[c[0]+','+c[1],c])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(v.length===1)return {type:'Point',srid:g.srid,c:v[0]};
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],hi=[];
  for(const p of v){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
  for(let k=v.length-1;k>=0;k--){const p=v[k];while(hi.length>=2&&cr(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p);}
  const h=lo.slice(0,-1).concat(hi.slice(0,-1));
  if(h.length<3)return {type:'LineString',srid:g.srid,c:[v[0],v[v.length-1]]};
  const cw=h.reverse();let s=0;
  cw.forEach((p,i)=>{if(p[1]<cw[s][1]||(p[1]===cw[s][1]&&p[0]<cw[s][0]))s=i;});
  const ring=cw.slice(s).concat(cw.slice(0,s));ring.push(ring[0]);
  return {type:'Polygon',srid:g.srid,c:[ring]};
};
/* a point's buffer: a 32-sided circle (8 segments per quarter, PostGIS's default), starting east and turning clockwise */
G.buffer=(g,r,quad)=>{
  if(g.type!=='Point')throw err('this practice database buffers points only for now');
  if(!(r>0))throw err('this practice database needs a buffer distance above 0');
  const q=quad||8,n=4*q,ring=[];
  for(let k=0;k<n;k++){const a=-2*Math.PI*k/n;ring.push([g.c[0]+r*Math.cos(a),g.c[1]+r*Math.sin(a)]);}
  ring.push(ring[0]);
  return {type:'Polygon',srid:g.srid,c:[ring]};
};
/* ST_DistanceSphere: haversine on PostGIS's sphere radius, in meters */
G.R_SPHERE=6370986;
G.sphere=(a,b)=>{
  if(a.type!=='Point'||b.type!=='Point')throw err('this practice database measures ST_DistanceSphere between points only');
  const rad=Math.PI/180,[x1,y1]=a.c,[x2,y2]=b.c;
  const h=Math.sin((y2-y1)*rad/2)**2+Math.cos(y1*rad)*Math.cos(y2*rad)*Math.sin((x2-x1)*rad/2)**2;
  return 2*G.R_SPHERE*Math.asin(Math.min(1,Math.sqrt(h)));
};
/* collect a list of geometries into the matching Multi type, or a GeometryCollection when they mix */
G.collect=(list,srid)=>{
  const gs=list.filter(Boolean);
  if(!gs.length)return null;
  const s=srid??gs[0].srid;
  const kinds=new Set(gs.map(g=>g.type));
  if(kinds.size===1&&['Point','LineString','Polygon'].includes(gs[0].type))return {type:'Multi'+gs[0].type,srid:s,c:gs.map(g=>g.c)};
  return {type:'GeometryCollection',srid:s,g:gs};
};
})();
