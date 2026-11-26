/* PostGIS Quest UI pieces: SQL highlighting, the result table and the island map. DOM code only; the engine stays in
   engine/. Everything from a query reaches the page through esc() or textContent, never as raw markup. Exposes window.PQUI. */
(()=>{
'use strict';
const UI=window.PQUI=window.PQUI||{};
const G=PQ.geo;
const esc=UI.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- SQL highlighting ---------- */
const KW=new Set(['select','from','where','and','or','not','as','order','by','group','having','limit','offset','join','left','inner','outer','cross','on','with','distinct','asc','desc','null','is','in','like','ilike','between','case','when','then','else','end','true','false','over','partition','nulls','first','last','cast','exists','all']);
UI.highlight=src=>{
  let out='',i=0;const n=src.length;
  const span=(c,t)=>'<span class="'+c+'">'+esc(t)+'</span>';
  while(i<n){
    const r=src.slice(i);let m;
    if((m=/^--[^\n]*/.exec(r))||(m=/^\/\*[\s\S]*?(\*\/|$)/.exec(r))){out+=span('sy-cm',m[0]);i+=m[0].length;continue;}
    if((m=/^'(?:[^']|'')*'?/.exec(r))){out+=span('sy-str',m[0]);i+=m[0].length;continue;}
    if((m=/^"(?:[^"]|"")*"?/.exec(r))){out+=esc(m[0]);i+=m[0].length;continue;}
    if((m=/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(r))){out+=span('sy-num',m[0]);i+=m[0].length;continue;}
    if((m=/^[A-Za-z_][A-Za-z0-9_$]*/.exec(r))){
      const w=m[0],after=src.slice(i+w.length);
      if(/^\s*\(/.test(after)&&!KW.has(w.toLowerCase()))out+=span('sy-fn',w);
      else if(KW.has(w.toLowerCase()))out+=span('sy-kw',w);
      else out+=esc(w);
      i+=w.length;continue;}
    if((m=/^(<->|::|:=|<>|!=|<=|>=|\|\||[=<>*+\/%-])/.exec(r))){out+=span('sy-op',m[0]);i+=m[0].length;continue;}
    out+=esc(src[i]);i++;
  }
  // a trailing newline needs a character after it, or the copy is one line short of the textarea
  return out+(src.endsWith('\n')?' ':'');
};

/* ---------- results ---------- */
const MAXROWS=500;
const NUMT=['integer','bigint','numeric','double precision'];
/* the column whose values colour the map: one a cluster function made */
UI.clusterCol=res=>res?res.cols.findIndex(c=>c.cluster):-1;
UI.labelCol=res=>res?res.cols.findIndex(c=>c.type==='text'):-1;
UI.table=(el,sql,r,opts)=>{
  if(!r){el.innerHTML='';return;}
  if(!r.ok){
    const t=PQ.errorText(sql,r.error).split('\n');
    el.innerHTML=`<pre class="perr" role="alert">${t.map(l=>/^ERROR:/.test(l)?`<span class="e">${esc(l)}</span>`:/^HINT:/.test(l)?`<span class="h">${esc(l)}</span>`:esc(l)).join('\n')}</pre>`;
    return;
  }
  const res=r.results.at(-1);
  if(!res){el.innerHTML='<p class="rmeta">Nothing ran: the editor holds only comments.</p>';return;}
  const cc=UI.clusterCol(res),geoCols=res.cols.map((c,j)=>c.type==='geometry'?j:-1).filter(j=>j>=0);
  const hasShape=row=>geoCols.some(j=>row[j])||!!(opts&&opts.named&&opts.named(row));
  const head=res.cols.map(c=>`<th scope="col">${esc(c.name)}<small>${esc(c.type==='unknown'?'text':c.type)}</small></th>`).join('');
  const body=res.rows.slice(0,MAXROWS).map((row,i)=>{
    const tds=row.map((v,j)=>{
      const t=res.cols[j].type;
      if(v===null)return '<td class="null">NULL</td>';
      const s=PQ.show(v,t);
      const sw=j===cc?`<span class="swatch" style="background:var(--c${v%6})"></span>`:'';
      return `<td class="${NUMT.includes(t)?'num':G.isGeom(v)?'hex':''}"${G.isGeom(v)?` title="${esc(G.wkt(v).slice(0,400))}"`:''}>${sw}${esc(s)}</td>`;
    }).join('');
    const geo=hasShape(row);
    return `<tr data-row="${i}"${geo?' class="geo" tabindex="0"':''}>${tds}</tr>`;
  }).join('');
  const n=res.rows.length;
  el.innerHTML=`<div class="rmeta"><span>${n} row${n===1?'':'s'}</span>${n>MAXROWS?`<span>showing the first ${MAXROWS}</span>`:''}${r.results.length>1?`<span>${r.results.length} queries ran; this is the last one's result</span>`:''}${geoCols.length||opts&&opts.anyNamed?'<span>hover a row to find it on the map</span>':''}</div>`+
    `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
};

/* ---------- the map ---------- */
/* plate carrée scaled by cos(latitude) at the middle of the view, so a kilometre is about as long east-west as north-south */
const W=600,PAD=0.006;
const STEPS=[0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,30,45,90];
function extentOf(gs){let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const g of gs){const x=G.bbox(g);a=Math.min(a,x.xmin);b=Math.min(b,x.ymin);c=Math.max(c,x.xmax);d=Math.max(d,x.ymax);}return {xmin:a,ymin:b,xmax:c,ymax:d};}
function view(ext){
  let {xmin,ymin,xmax,ymax}=ext;
  const pad=Math.max(PAD,(xmax-xmin)*.04,(ymax-ymin)*.04);
  xmin-=pad;xmax+=pad;ymin-=pad;ymax+=pad;
  const k=Math.max(.05,Math.cos(Math.max(-85,Math.min(85,(ymin+ymax)/2))*Math.PI/180));
  const s=W/((xmax-xmin)*k);
  const H=Math.max(160,Math.min(W*1.4,(ymax-ymin)*s));
  return {xmin,ymin,xmax,ymax,k,s,H,
    px:x=>((x-xmin)*k*s),py:y=>(H/2-(y-(ymin+ymax)/2)*s),
    lon:px=>xmin+px/(k*s),lat:py=>(ymin+ymax)/2-(py-H/2)/s};
}
const fmtN=n=>+n.toFixed(6);
function path(g,v){
  const ring=r=>r.map((c,i)=>(i?'L':'M')+fmtN(v.px(c[0]))+' '+fmtN(v.py(c[1]))).join('')+'Z';
  const line=l=>l.map((c,i)=>(i?'L':'M')+fmtN(v.px(c[0]))+' '+fmtN(v.py(c[1]))).join('');
  const parts=G.parts(g);
  return {
    polys:parts.filter(p=>p.type==='Polygon').map(p=>p.c.map(ring).join('')).join(''),
    lines:parts.filter(p=>p.type==='LineString').map(p=>line(p.c)).join(''),
    pts:parts.filter(p=>p.type==='Point').map(p=>[v.px(p.c[0]),v.py(p.c[1])])
  };
}
/* map(el, {result, named, onHover}): draws the base layers faint, then the result's shapes. named(row) gives base features
   (by name) to highlight when the result has no geometry of its own. Returns {hot(i)} to light up row i's shapes. */
UI.map=(el,o)=>{
  const W0=PQ.WORLD,res=o.result,named=o.named;
  const base=G.parse('POLYGON((-40.1 34.92,-40.1 35.08,-39.9 35.08,-39.9 34.92,-40.1 34.92))');
  const geoCols=res?res.cols.map((c,j)=>c.type==='geometry'?j:-1).filter(j=>j>=0):[];
  const items=[]; // {row, g, label, cls}
  const cc=UI.clusterCol(res),lc=UI.labelCol(res);
  if(res)res.rows.slice(0,MAXROWS).forEach((row,i)=>{
    const label=lc>=0&&row[lc]!==null?String(row[lc]):'';
    let cls='';
    if(cc>=0)cls=row[cc]===null?'noise':'cl cl'+(row[cc]%6);
    for(const j of geoCols)if(row[j])items.push({row:i,g:row[j],label,cls});
    if(!geoCols.length&&named)for(const f of named(row))items.push({row:i,g:f.g,label:f.name,cls,named:true});
  });
  const ext=extentOf([base,...items.map(x=>x.g)]);
  const far=items.filter(x=>{const b=G.bbox(x.g);return b.xmax<-40.2||b.xmin>-39.8||b.ymax<34.85||b.ymin>35.15;});
  const v=view(ext);
  const zoomed=ext.xmax-ext.xmin>1||ext.ymax-ext.ymin>1;
  let svg='';
  // graticule
  const span=Math.max(v.xmax-v.xmin,v.ymax-v.ymin),step=STEPS.find(s=>span/s<=7)||90;
  const lab=n=>{const d=step<0.01?3:step<0.1?2:step<1?1:0;return n.toFixed(d)+'°';};
  for(let x=Math.ceil(v.xmin/step)*step;x<=v.xmax;x+=step){const X=v.px(x);svg+=`<line class="m-grid" x1="${fmtN(X)}" y1="0" x2="${fmtN(X)}" y2="${fmtN(v.H)}"/><text class="m-glab" x="${fmtN(X+3)}" y="${fmtN(v.H-4)}">${lab(x)}</text>`;}
  for(let y=Math.ceil(v.ymin/step)*step;y<=v.ymax;y+=step){const Y=v.py(y);svg+=`<line class="m-grid" x1="0" y1="${fmtN(Y)}" x2="${W}" y2="${fmtN(Y)}"/><text class="m-glab" x="3" y="${fmtN(Y-3)}">${lab(y)}</text>`;}
  // base layers
  const r0=zoomed?1.5:4;
  let b='';
  for(const row of W0.island.rows)b+=`<path class="m-island" d="${path(row[1],v).polys}"><title>${esc(row[0])} (island)</title></path>`;
  for(const row of W0.zones.rows)b+=`<path class="m-zone z-${esc(row[2])}" d="${path(row[3],v).polys}"><title>${esc(row[1])} (zone, ${esc(row[2])})</title></path>`;
  for(const row of W0.trails.rows)b+=`<path class="m-trail" d="${path(row[2],v).lines}"><title>${esc(row[1])} (trail)</title></path>`;
  for(const row of W0.stones.rows){const [x,y]=path(row[2],v).pts[0];b+=`<circle class="m-stone" cx="${fmtN(x)}" cy="${fmtN(y)}" r="${r0*.6}"><title>stone ${row[0]} (${esc(row[1])})</title></circle>`;}
  for(const row of W0.wells.rows){const [x,y]=path(row[3],v).pts[0];b+=`<circle class="m-well" cx="${fmtN(x)}" cy="${fmtN(y)}" r="${r0*.9}"><title>${esc(row[1])} (well, ${row[2]} m)</title></circle>`;}
  for(const row of W0.places.rows){const [x,y]=path(row[3],v).pts[0];b+=`<rect class="m-place" x="${fmtN(x-r0)}" y="${fmtN(y-r0)}" width="${r0*2}" height="${r0*2}" rx="1.5"><title>${esc(row[1])} (${esc(row[2])})</title></rect>`;}
  if(!zoomed){
    // zone names sit just inside the zone's top edge, clear of the places' labels
    for(const row of W0.zones.rows){const bb=G.bbox(row[3]);if(row[2]==='square')continue;b+=`<text class="m-label dim" x="${fmtN(v.px((bb.xmin+bb.xmax)/2))}" y="${fmtN(v.py(bb.ymax)+12)}" text-anchor="middle">${esc(row[1])}</text>`;}
    for(const row of W0.places.rows){const c=row[3].c;b+=`<text class="m-label" x="${fmtN(v.px(c[0])+7)}" y="${fmtN(v.py(c[1])+4)}">${esc(row[1])}</text>`;}
  }
  // zoomed far out, the island is a speck: ring it and name it so the learner can see where home is
  if(zoomed){const c=G.centroid(W0.island.rows[0][1]).c;b+=`<circle class="hit noise" cx="${fmtN(v.px(c[0]))}" cy="${fmtN(v.py(c[1]))}" r="9"/><text class="m-label" x="${fmtN(v.px(c[0])+12)}" y="${fmtN(v.py(c[1])+4)}">Gullhaven</text>`;}
  svg+=`<g class="base${items.length?' faded':''}">${b}</g>`;
  // result layer: polygons, then lines, then points, so small things stay on top
  const R=zoomed&&items.length>14?3:5.5;
  let h='';
  const order=[...items.keys()].sort((a,b)=>G.dim(items[b].g)-G.dim(items[a].g));
  for(const k of order){
    const it=items[k],p=path(it.g,v),c=it.cls?' '+it.cls:'';
    let s='';
    if(p.polys)s+=`<path class="hit${c}" d="${p.polys}" fill-rule="evenodd"/>`;
    if(p.lines)s+=`<path class="hit line${c}" d="${p.lines}"/>`;
    for(const [x,y] of p.pts)s+=`<circle class="hit pt${c}" cx="${fmtN(x)}" cy="${fmtN(y)}" r="${R}"/>`;
    const t=`row ${it.row+1}${it.label?': '+it.label:''}`;
    h+=`<g class="hit-g" data-row="${it.row}"><title>${esc(t)}</title>${s}</g>`;
  }
  // labels for the result, when there are few enough to read
  // a line is labelled at its middle vertex, anything else at its centroid
  const anchor=g=>g.type==='LineString'?g.c[Math.floor((g.c.length-1)/2)]:G.centroid(g).c;
  if(items.length<=14)for(const it of items){const label=it.label||(zoomed?'row '+(it.row+1):'');if(!label)continue;const c=anchor(it.g);const right=v.px(c[0])>W-110;h+=`<text class="hit-label" x="${fmtN(v.px(c[0])+(right?-8:8))}" y="${fmtN(v.py(c[1])-7)}"${right?' text-anchor="end"':''}>${esc(label)}</text>`;}
  svg+=h;
  const desc=items.length?`${items.length} shape${items.length===1?'':'s'} from your result, drawn over the island`:'The island of Gullhaven with its zones, trails, wells, stones and places';
  el.innerHTML=`<svg viewBox="0 0 ${W} ${fmtN(v.H)}" role="img" aria-label="${esc(desc)}">${svg}</svg>`;
  const svgEl=el.firstChild;
  // where the pointer is, longitude first
  const coords=o.coords;
  if(coords){
    svgEl.addEventListener('pointermove',e=>{const m=svgEl.getScreenCTM();if(!m)return;const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());coords.textContent='lon '+v.lon(pt.x).toFixed(4)+', lat '+v.lat(pt.y).toFixed(4);});
    svgEl.addEventListener('pointerleave',()=>{coords.textContent='';});
  }
  const hot=i=>{svgEl.querySelectorAll('.hit-g').forEach(g=>{const on=+g.dataset.row===i;g.querySelectorAll('.hit').forEach(x=>x.classList.toggle('hot',on));if(on)g.parentNode.appendChild(g);});};
  svgEl.addEventListener('pointerover',e=>{const g=e.target.closest('.hit-g');if(g&&o.onHover)o.onHover(+g.dataset.row);});
  svgEl.addEventListener('pointerout',e=>{const g=e.target.closest('.hit-g');if(g&&o.onHover)o.onHover(-1);});
  // notes, legend and the text list
  let note='';
  if(far.length)note=`<span class="far">${far.length===1?'One shape lies':far.length+' shapes lie'} far off the island, so the map zoomed out to show ${far.length===1?'it':'them'}.</span> `;
  if(items.length&&items.some(x=>x.named))note+='Your result has no shapes of its own, but it names these features (or gives their <code>id</code>), so the map lights them up.';
  else if(items.length)note+=`${items.length} shape${items.length===1?'':'s'} from your result.`;
  else if(res&&res.rows.length)note+='Your result has no shapes to draw. Select a <code>geom</code> column, or a function that returns a geometry, to see it here.';
  else note+='Run a query, and the shapes in its result are drawn here.';
  const legend=[];
  if(cc>=0){const ids=[...new Set(res.rows.map(r=>r[cc]))].sort((a,b)=>a===null?1:b===null?-1:a-b);
    for(const id of ids)legend.push(id===null?'<span><i style="background:var(--surface);border-style:dashed"></i>NULL (noise)</span>':`<span><i style="background:var(--c${id%6})"></i>cluster ${id}</span>`);}
  else legend.push('<span><i style="background:var(--m-place)"></i>place</span><span><i style="background:var(--m-well);border-radius:50%"></i>well</span><span><i style="background:var(--m-stone);border-radius:50%"></i>stone</span><span><i style="background:var(--m-trail)"></i>trail</span>'+(items.length?'<span><i style="background:var(--m-hit)"></i>your result</span>':''));
  const list=items.slice(0,200).map(it=>`<li>row ${it.row+1}${it.label?' ('+esc(it.label)+')':''}: ${esc(G.wkt(it.g).slice(0,160))}${G.wkt(it.g).length>160?'…':''}</li>`).join('')||'<li>Only the island\'s own layers: the coast, six zones, four trails, nine wells, twenty stones and ten places.</li>';
  return {hot,note,legend:legend.join(''),list};
};

/* the tables, for the reference list under the map */
UI.schema=()=>Object.entries(PQ.WORLD).map(([t,x])=>`<dt>${esc(t)}</dt><dd>${x.cols.map(c=>esc(c.name)+' '+esc(c.type)).join(', ')} · ${x.rows.length} row${x.rows.length===1?'':'s'}</dd>`).join('');
})();
