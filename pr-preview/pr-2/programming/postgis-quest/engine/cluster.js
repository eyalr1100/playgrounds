/* PostGIS Quest clustering: the two window functions ST_ClusterDBSCAN and ST_ClusterKMeans. Both take the rows'
   geometries in order and return one cluster number per row, counting from 0. The numbers are labels: which rows share
   one is the answer, and real PostGIS may number the same groups differently. Deterministic. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const G=PQ.geo,REL=PQ.relate,C=PQ.cluster={};

/* DBSCAN: a row with at least minpoints rows (itself included) within eps is a core; cores within eps of each other join
   one cluster, and a row within eps of a core joins that core's cluster. Others are noise (NULL). Clusters are numbered
   in the order their first row appears. */
C.dbscan=(geoms,eps,minpoints)=>{
  const n=geoms.length,lab=new Array(n).fill(undefined);
  const near=i=>{const out=[];for(let j=0;j<n;j++)if(geoms[i]&&geoms[j]&&REL.distance(geoms[i],geoms[j])<=eps)out.push(j);return out;};
  const nb=geoms.map((_,i)=>near(i)),core=nb.map(x=>x.length>=minpoints);
  let next=0;
  for(let i=0;i<n;i++){
    if(lab[i]!==undefined||!core[i])continue;
    const id=next++,q=[i];lab[i]=id;
    while(q.length){const k=q.shift();if(!core[k])continue;for(const j of nb[k])if(lab[j]===undefined){lab[j]=id;q.push(j);}}
  }
  return lab.map(v=>v===undefined?null:v);
};

/* k-means on the rows' centroids: the first seed is the row farthest from the centre of them all, each next seed the row
   farthest from the seeds so far (ties go to the earlier row), then Lloyd's steps until nothing moves. Clusters are then
   renumbered in the order their first row appears. A NULL geometry gets NULL. */
C.kmeans=(geoms,k)=>{
  const idx=[],pts=[];
  geoms.forEach((g,i)=>{if(g){idx.push(i);pts.push(G.centroid(g).c);}});
  const out=geoms.map(()=>null);
  if(!pts.length)return out;
  if(k>pts.length)k=pts.length;
  const d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
  const mean=[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length];
  const far=(score)=>{let b=-1,bi=0;pts.forEach((p,i)=>{const s=score(p);if(s>b+1e-18){b=s;bi=i;}});return bi;};
  const seeds=[pts[far(p=>d2(p,mean))]];
  while(seeds.length<k)seeds.push(pts[far(p=>Math.min(...seeds.map(s=>d2(p,s))))]);
  let cent=seeds.map(s=>[...s]),lab=new Array(pts.length).fill(-1);
  for(let it=0;it<100;it++){
    let moved=false;
    pts.forEach((p,i)=>{let b=0;for(let j=1;j<cent.length;j++)if(d2(p,cent[j])<d2(p,cent[b])-1e-18)b=j;if(lab[i]!==b){lab[i]=b;moved=true;}});
    if(!moved)break;
    cent=cent.map((c,j)=>{const m=pts.filter((_,i)=>lab[i]===j);return m.length?[m.reduce((s,p)=>s+p[0],0)/m.length,m.reduce((s,p)=>s+p[1],0)/m.length]:c;});
  }
  const ren=new Map();
  lab.forEach((l,i)=>{if(!ren.has(l))ren.set(l,ren.size);out[idx[i]]=ren.get(l);});
  return out;
};
})();
