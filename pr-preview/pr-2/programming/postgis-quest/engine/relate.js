/* PostGIS Quest spatial predicates. Each one follows its DE-9IM definition, decided by sampling: the vertices of both
   shapes, every point where their edges meet, the middle of every edge piece between those points, and one point inside
   each polygon. Every sample is located as interior, boundary or exterior of each shape. Between two consecutive sample
   points an edge piece cannot change sides, so for the simple shapes this course uses (points, lines, polygons with or
   without holes, and their Multi forms) the answers are exact. It is not a general topology library. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const G=PQ.geo,REL=PQ.relate={};
const EPS=1e-10; // degrees: about a hundredth of a millimetre

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const same=(a,b)=>Math.abs(a[0]-b[0])<=EPS&&Math.abs(a[1]-b[1])<=EPS;
// distance from p to segment ab
const segDist=(p,a,b)=>{const d=sub(b,a),l2=d[0]*d[0]+d[1]*d[1];let t=l2?((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/l2:0;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-a[0]-t*d[0],p[1]-a[1]-t*d[1]);};
const onSeg=(p,a,b)=>segDist(p,a,b)<=EPS;

/* where two segments meet: [] for none, one point, or the two ends of a shared stretch */
function meet(a,b,c,d){
  const r=sub(b,a),s=sub(d,c),den=cross(r,s),qp=sub(c,a);
  const scale=Math.max(Math.hypot(...r),Math.hypot(...s),1e-300);
  if(Math.abs(den)<=EPS*scale){
    // parallel: shared stretch only when collinear
    if(segDist(c,a,b)>EPS&&segDist(d,a,b)>EPS&&segDist(a,c,d)>EPS&&segDist(b,c,d)>EPS)return [];
    const pts=[a,b,c,d].filter((p,i)=>i<2?onSeg(p,c,d):onSeg(p,a,b));
    const u=[];for(const p of pts)if(!u.some(q=>same(p,q)))u.push(p);
    return u.slice(0,2);
  }
  const t=cross(qp,s)/den,u=cross(qp,r)/den,tol=EPS/scale;
  if(t<-tol||t>1+tol||u<-tol||u>1+tol){
    // near misses at an end point still count, judged by distance rather than by the parameters
    for(const [p,x,y] of [[a,c,d],[b,c,d],[c,a,b],[d,a,b]])if(onSeg(p,x,y))return [p];
    return [];
  }
  // snap to an end point the crossing sits on, so a vertex on an edge gives that exact vertex
  const p=[a[0]+t*r[0],a[1]+t*r[1]];
  for(const q of [a,b,c,d])if(same(p,q))return [q];
  return [p];
}

/* ---------- locating a point ---------- */
// in a ring: 1 inside, 0 on the edge, -1 outside
function inRing(p,r){
  let inside=false;
  for(let k=0;k+1<r.length;k++){
    const a=r[k],b=r[k+1];
    if(onSeg(p,a,b))return 0;
    if((a[1]>p[1])!==(b[1]>p[1])){const x=a[0]+(p[1]-a[1])*(b[0]-a[0])/(b[1]-a[1]);if(p[0]<x)inside=!inside;}
  }
  return inside?1:-1;
}
function locPart(p,g){
  if(g.type==='Point')return same(p,g.c)?'i':'e';
  if(g.type==='LineString'){
    const l=g.c,closed=same(l[0],l[l.length-1]);
    if(!closed&&(same(p,l[0])||same(p,l[l.length-1])))return 'b';
    for(let k=0;k+1<l.length;k++)if(onSeg(p,l[k],l[k+1]))return 'i';
    return 'e';
  }
  const shell=inRing(p,g.c[0]);
  if(shell<0)return 'e';if(shell===0)return 'b';
  for(const h of g.c.slice(1)){const r=inRing(p,h);if(r===0)return 'b';if(r>0)return 'e';}
  return 'i';
}
// in a whole geometry; a Multi line's ends follow the "odd number of ends" rule
REL.locate=(p,g)=>{
  const parts=G.parts(g);let b=false,ends=0,onLine=false;
  for(const q of parts){
    const l=locPart(p,q);
    if(q.type==='LineString'){if(l==='b')ends++;else if(l==='i')onLine=true;continue;}
    if(l==='i')return 'i';if(l==='b')b=true;
  }
  if(onLine)return 'i';
  if(ends)return ends%2?'b':'i';
  return b?'b':'e';
};

/* a point well inside a polygon: the middle of the widest gap on a horizontal line through the middle */
function inside(poly){
  const ys=[...new Set(poly.flat().map(c=>c[1]))].sort((a,b)=>a-b);
  let best=null,bw=-1;
  const mid=(ys[0]+ys[ys.length-1])/2;
  // try lines half-way between neighbouring vertex heights, nearest the middle first
  const lines=ys.slice(1).map((y,i)=>(y+ys[i])/2).sort((a,b)=>Math.abs(a-mid)-Math.abs(b-mid));
  for(const y of lines){
    const xs=[];
    for(const r of poly)for(let k=0;k+1<r.length;k++){const a=r[k],b=r[k+1];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
    xs.sort((a,b)=>a-b);
    for(let k=0;k+1<xs.length;k+=2)if(xs[k+1]-xs[k]>bw){bw=xs[k+1]-xs[k];best=[(xs[k]+xs[k+1])/2,y];}
    if(best)return best;
  }
  return poly[0][0];
}

/* ---------- the samples ---------- */
function samples(A,B){
  const sa=G.segs(A),sb=G.segs(B),X=[];
  for(const [a,b] of sa)for(const [c,d] of sb)for(const p of meet(a,b,c,d))X.push(p);
  // each edge cut at the meeting points on it; the middle of every piece is a sample
  const mids=(segs)=>{const out=[];for(const [a,b] of segs){
    const cut=[a,b,...X.filter(p=>onSeg(p,a,b))],d=sub(b,a),l2=d[0]*d[0]+d[1]*d[1];
    const ts=[...new Set(cut.map(p=>l2?((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/l2:0))].sort((x,y)=>x-y);
    for(let k=0;k+1<ts.length;k++){const t=(ts[k]+ts[k+1])/2;if(ts[k+1]-ts[k]>1e-12)out.push([a[0]+t*d[0],a[1]+t*d[1]]);}
  }return out;};
  const own=(g,segs)=>[...G.verts(g),...mids(segs),...G.parts(g).filter(p=>p.type==='Polygon').map(p=>inside(p.c))];
  return {a:own(A,sa),b:own(B,sb),x:X,ma:mids(sa),mb:mids(sb)};
}
// every sample with its place in A and in B
function table(A,B){
  const S=samples(A,B),rows=[];
  for(const p of S.a)rows.push({p,from:'a',la:REL.locate(p,A),lb:REL.locate(p,B)});
  for(const p of S.b)rows.push({p,from:'b',la:REL.locate(p,A),lb:REL.locate(p,B)});
  for(const p of S.x)rows.push({p,from:'x',la:REL.locate(p,A),lb:REL.locate(p,B)});
  return rows;
}

/* ---------- the predicates ---------- */
const area=g=>G.dim(g)===2;
function facts(A,B){
  const t=table(A,B);
  const hit=t.some(r=>r.la!=='e'&&r.lb!=='e');
  // interiors meet: a sample inside both, or any point of one shape inside a polygon of the other (a point of a shape on
  // a polygon's inside has the shape's own inside right next to it)
  const ii=t.some(r=>(r.la==='i'&&r.lb==='i')||(area(B)&&r.lb==='i'&&r.la!=='e')||(area(A)&&r.la==='i'&&r.lb!=='e'));
  // some of B lies outside A: a sample of B outside A, or (B a polygon) A's edge running through B's inside
  const bOut=t.some(r=>r.from==='b'&&r.la==='e')||(area(B)&&area(A)&&t.some(r=>r.from==='a'&&r.la==='b'&&r.lb==='i'));
  const aOut=t.some(r=>r.from==='a'&&r.lb==='e')||(area(A)&&area(B)&&t.some(r=>r.from==='b'&&r.lb==='b'&&r.la==='i'));
  return {t,hit,ii,aOut,bOut};
}
REL.intersects=(A,B)=>facts(A,B).hit;
REL.disjoint=(A,B)=>!facts(A,B).hit;
REL.contains=(A,B)=>{if(G.dim(B)>G.dim(A))return false;const f=facts(A,B);return f.ii&&!f.bOut;};
REL.within=(A,B)=>REL.contains(B,A);
REL.covers=(A,B)=>{if(G.dim(B)>G.dim(A))return false;const f=facts(A,B);return f.hit&&!f.bOut;};
REL.coveredby=(A,B)=>REL.covers(B,A);
REL.touches=(A,B)=>{if(G.dim(A)===0&&G.dim(B)===0)return false;const f=facts(A,B);return f.hit&&!f.ii;};
REL.equals=(A,B)=>{if(G.dim(A)!==G.dim(B))return false;const f=facts(A,B);return f.hit&&!f.aOut&&!f.bOut;};
REL.crosses=(A,B)=>{
  const da=G.dim(A),db=G.dim(B);
  if(da===db&&da!==1)return false;
  const f=facts(A,B);
  if(!f.ii)return false;
  if(da===1&&db===1){
    // lines cross when they meet in points only: no shared stretch (an edge piece inside both)
    const S=samples(A,B);
    return !S.ma.some(p=>REL.locate(p,B)!=='e')&&!S.mb.some(p=>REL.locate(p,A)!=='e');
  }
  return da<db?f.aOut:f.bOut;
};
REL.overlaps=(A,B)=>{
  const da=G.dim(A);if(da!==G.dim(B))return false;
  const f=facts(A,B);
  if(!f.ii||!f.aOut||!f.bOut)return false;
  if(da===1){const S=samples(A,B);return S.ma.some(p=>REL.locate(p,B)==='i');}
  return true;
};

/* ---------- distance ---------- */
REL.distance=(A,B)=>{
  if(REL.intersects(A,B))return 0;
  const va=G.verts(A),vb=G.verts(B),sa=G.segs(A),sb=G.segs(B);
  let d=Infinity;
  for(const p of va){for(const [a,b] of sb)d=Math.min(d,segDist(p,a,b));for(const q of vb)d=Math.min(d,Math.hypot(p[0]-q[0],p[1]-q[1]));}
  for(const p of vb)for(const [a,b] of sa)d=Math.min(d,segDist(p,a,b));
  return d;
};
REL.dwithin=(A,B,d)=>REL.distance(A,B)<=d;
REL.inside=inside;
})();
