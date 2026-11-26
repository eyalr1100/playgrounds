/* PostGIS Quest app: state and saving, chapters and the mission card, the SQL editor, the result table and the map, XP
   and ranks, quick-fire and the field guide. A mission is checked by its own session (PQ.session: the fixed island and
   the query just run), so the check never depends on UI state. */
(()=>{
'use strict';
const {CH,RANKS,QF,GUIDE,KINDS}=PQ;
const XP=PQ.XP||10;
const KEY=window.PROGRESS.key;
const $=s=>document.querySelector(s);
const esc=PQUI.esc;
const TABS=['quest','fire','guide'];
const isObj=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
const isKey=k=>{const m=/^(\d+)\.(\d+)$/.exec(k);return !!m&&+m[1]<CH.length&&+m[2]<CH[+m[1]].missions.length;};
const validDone=d=>Object.keys(d).filter(k=>d[k]===true&&isKey(k));
const MAXSQL=20000;

/* ---------- state ---------- */
function fresh(){return {ch:0,mi:0,done:{},xp:0,best:0,tab:'quest',codes:{}};}
/* every field falls back on its own, so one bad value never costs the rest of a save */
function load(raw){
  const S=fresh();let o=null;
  try{o=JSON.parse(raw);}catch(e){return S;}
  if(!isObj(o))return S;
  if(isObj(o.done))for(const k of Object.keys(o.done))if(o.done[k]===true)S.done[k]=true;
  S.xp=typeof o.xp==='number'&&Number.isFinite(o.xp)&&o.xp>=0?o.xp:XP*validDone(S.done).length;
  S.best=typeof o.best==='number'&&Number.isFinite(o.best)&&o.best>=0?o.best:0;
  if(Number.isInteger(o.ch)&&o.ch>=0&&o.ch<CH.length){S.ch=o.ch;if(Number.isInteger(o.mi)&&o.mi>=0&&o.mi<=CH[o.ch].missions.length)S.mi=o.mi;}
  if(TABS.includes(o.tab))S.tab=o.tab;
  if(isObj(o.codes))for(const k of Object.keys(o.codes))if(typeof o.codes[k]==='string'&&(isKey(k)||/^\d+\.end$/.test(k)))S.codes[k]=o.codes[k].slice(0,MAXSQL);
  return S;
}
let S=fresh();
try{const raw=localStorage.getItem(KEY);if(raw!==null)S=load(raw);}catch(e){}
let saveT=0,pending=false;
const write=()=>{pending=false;try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}};
function save(){pending=true;clearTimeout(saveT);saveT=setTimeout(write,200);}
addEventListener('pagehide',()=>{if(pending){clearTimeout(saveT);write();}});

const mkey=()=>S.ch+'.'+S.mi;
// the editor's own slot: the mission's key, or '<chapter>.end' on a chapter's finish page
const codeKey=()=>S.mi<CH[S.ch].missions.length?mkey():S.ch+'.end';
const curMission=()=>CH[S.ch].missions[S.mi]||null;
const totalDone=ci=>CH[ci].missions.filter((_,i)=>S.done[ci+'.'+i]).length;
const chapterDone=ci=>totalDone(ci)===CH[ci].missions.length;

const missionEl=$('#mission'),chaptersEl=$('#chapters'),fbEl=$('#feedback'),outEl=$('#out');
const sqlIn=$('#sql'),hl=$('#hl');

/* ---------- names on the map: base features a result names ---------- */
const NAMED=new Map();
for(const [t,x] of Object.entries(PQ.WORLD)){const ni=x.cols.findIndex(c=>c.name==='name'),gi=x.cols.findIndex(c=>c.type==='geometry');if(ni<0||gi<0)continue;for(const r of x.rows)NAMED.set(r[ni],{name:r[ni],g:r[gi],table:t});}
const named=row=>row.filter(v=>typeof v==='string'&&NAMED.has(v)).map(v=>NAMED.get(v));
/* the base features a result points at when it has no geometry of its own: by id when the query reads one table and
   returns its id column (cluster numbers next to stone ids), else by name */
function featuresFor(r){
  const res=r&&r.ok&&r.results.at(-1);if(!res)return named;
  const reads=[...PQ.shape(r.stmts).reads],idc=res.cols.findIndex(c=>c.name==='id');
  if(reads.length!==1||idc<0||!PQ.WORLD[reads[0]])return named;
  const T=PQ.WORLD[reads[0]],ti=T.cols.findIndex(c=>c.name==='id'),ni=T.cols.findIndex(c=>c.name==='name'),gi=T.cols.findIndex(c=>c.type==='geometry');
  const byId=new Map(T.rows.map(x=>[x[ti],{name:ni>=0?x[ni]:reads[0].replace(/s$/,'')+' '+x[ti],g:x[gi]}]));
  return row=>{const f=byId.get(row[idc]);return f?[f]:named(row);};
}

/* ---------- the editor ---------- */
function paint(){hl.innerHTML=PQUI.highlight(sqlIn.value);hl.scrollTop=sqlIn.scrollTop;}
let codeT=0;
sqlIn.addEventListener('input',()=>{paint();clearTimeout(codeT);codeT=setTimeout(()=>{const k=codeKey(),v=sqlIn.value.slice(0,MAXSQL);if(v){if(S.codes[k]!==v){S.codes[k]=v;save();}}else if(k in S.codes){delete S.codes[k];save();}},400);});
sqlIn.addEventListener('scroll',()=>{hl.scrollTop=sqlIn.scrollTop;});
sqlIn.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runSql();return;}
  if(e.key==='Escape'){sqlIn.dataset.esc='1';return;}
  if(e.key==='Tab'&&!e.shiftKey&&sqlIn.dataset.esc!=='1'){e.preventDefault();const s=sqlIn.selectionStart,t=sqlIn.selectionEnd;sqlIn.setRangeText('  ',s,t,'end');paint();return;}
  sqlIn.dataset.esc='';
});
const setSql=v=>{sqlIn.value=v;paint();};
$('#run').addEventListener('click',()=>runSql());
$('#clearSql').addEventListener('click',()=>{setSql('');const k=codeKey();if(k in S.codes){delete S.codes[k];save();}sqlIn.focus();});

/* ---------- mission session ---------- */
/* a session is one go at a mission: the island, and the last query run. ran: anything run yet (no nagging before that);
   won: this session already completed the mission (never celebrate it twice). */
let sess=null,ran=false,won=false,mapApi=null,lastRun=null;
const sessionMission=()=>curMission()||CH[S.ch].missions[CH[S.ch].missions.length-1];
function startSession(){
  sess=PQ.session(sessionMission());ran=false;won=false;lastRun=null;
  setSql(S.codes[codeKey()]||'');
  PQUI.table(outEl,'',null);renderFeedback(null);drawMap(null);
}
function drawMap(r){
  const res=r&&r.ok?r.results.at(-1):null;
  mapApi=PQUI.map($('#map'),{result:res,named:featuresFor(r),coords:$('#coords'),onHover:i=>hotRow(i)});
  $('#mapNote').innerHTML=mapApi.note;$('#legend').innerHTML=mapApi.legend;$('#mapItems').innerHTML=mapApi.list;
}
function hotRow(i){
  outEl.querySelectorAll('tbody tr').forEach(tr=>tr.classList.toggle('hot',+tr.dataset.row===i));
  if(mapApi)mapApi.hot(i);
}
outEl.addEventListener('pointerover',e=>{const tr=e.target.closest('tbody tr');if(tr)hotRow(+tr.dataset.row);});
outEl.addEventListener('pointerleave',()=>hotRow(-1));
outEl.addEventListener('focusin',e=>{const tr=e.target.closest('tbody tr');if(tr)hotRow(+tr.dataset.row);});
outEl.addEventListener('keydown',e=>{const tr=e.target.closest('tbody tr.geo');if(!tr||(e.key!=='Enter'&&e.key!==' '))return;e.preventDefault();hotRow(+tr.dataset.row);if(innerWidth<820){setView('map');}});
function runSql(){
  const sql=sqlIn.value.slice(0,MAXSQL);
  if(sql!==sqlIn.value)setSql(sql);
  let r;
  try{r=sess.run(sql);}catch(e){r={ok:false,results:[],error:{message:'something went wrong inside this practice database. Clear the editor and try again.',pos:null}};}
  lastRun=r;ran=true;
  const feats=featuresFor(r);
  PQUI.table(outEl,sql,r,{named:row=>feats(row).length>0,anyNamed:r.ok&&r.results.length&&r.results.at(-1).rows.some(row=>feats(row).length)});
  drawMap(r);
  const k=codeKey();if(sql.trim()&&S.codes[k]!==sql){S.codes[k]=sql;save();}
  evaluate();
}
function evaluate(){
  const m=curMission();if(!m)return;
  let r;try{r=sess.check();}catch(e){r=null;}
  if(r===true){complete();return;}
  if(won)return;
  renderFeedback(typeof r==='string'?{tip:r}:null);
}
function complete(){
  if(won)return;won=true;
  const k=mkey(),first=!S.done[k],hadBadge=chapterDone(S.ch);
  let badge=false;
  if(first){S.done[k]=true;S.xp+=XP;badge=!hadBadge&&chapterDone(S.ch);pop=true;save();}
  renderFeedback({win:true,first,badge});
  renderChapters();renderMission();renderXP();
}
const nextBtn=()=>`<button type="button" class="btn" data-act="next">${S.mi>=CH[S.ch].missions.length-1?'Finish the chapter':'Next mission'} →</button>`;
const WINS=['Look at the map: every highlighted shape came straight out of your query.','Nice. That query would run the same on a real PostGIS database.','Clean. You are asking the map questions now.','That is how GIS people work: ask, look at the map, ask a better question.'];
function renderFeedback(f){
  if(!f){fbEl.innerHTML='';return;}
  if(f.win){fbEl.innerHTML=`<div class="msg win"><span class="h">${f.first?'Mission complete! +'+XP+' XP':'Mission complete (you had already earned this one)'}${f.badge?' · Badge earned: '+esc(CH[S.ch].badge):''}</span><p>${WINS[(S.ch*7+S.mi)%WINS.length]}</p><div class="actions">${nextBtn()}<button type="button" class="btn ghost narrow-only" data-act="map">See the map</button></div></div>`;return;}
  if(!ran)return;
  fbEl.innerHTML=`<div class="msg tip"><span class="h">Not quite yet</span><p>${f.tip}</p></div>`;
}
fbEl.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;
  if(b.dataset.act==='next'){setView('sql');gotoMission(S.ch,S.mi+1,true);}
  else if(b.dataset.act==='map'){setView('map');$('#map').scrollIntoView({block:'nearest'});}});

/* ---------- narrow screens: one panel at a time ---------- */
const VIEWS=['sql','map'];
function setView(v){if(!VIEWS.includes(v))v='sql';$('.quest').dataset.view=v;document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===v)));}
$('.seg').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b)setView(b.dataset.view);});

/* ---------- chapters and the mission card ---------- */
let pop=false;
const mq=q=>{try{return !!(window.matchMedia&&matchMedia(q).matches);}catch(e){return false;}};
const wide=()=>mq('(min-width:820px)'),reduced=()=>mq('(prefers-reduced-motion: reduce)');
function anatomy(t){if(!t||!t.length)return '';return `<div class="anat" aria-label="Parts of the query">${t.map(([s,k,l])=>`<div class="tok k-${esc(k)}"><b>${esc(s)}</b><span>${esc(l||KINDS[k]||k)}</span></div>`).join('')}</div>`;}
function renderChapters(){chaptersEl.innerHTML=CH.map((c,i)=>{const all=chapterDone(i);return `<button class="chap${all?' earned':''}" data-ch="${i}" aria-current="${i===S.ch}"><span class="num">${all?'★':i+1}</span><span class="nm">${esc(c.name)}${all?'<span class="sr"> (badge earned: '+esc(c.badge)+')</span>':''}</span><span class="ct">${totalDone(i)}/${c.missions.length}</span></button>`;}).join('');}
function renderMission(){
  const ch=CH[S.ch],n=ch.missions.length;
  const dots=`<div class="dots" aria-label="Missions in this chapter">${ch.missions.map((m,i)=>`<button class="dot${S.done[S.ch+'.'+i]?' done':''}${i===S.mi?' cur':''}" data-mi="${i}" title="${esc(m.title)}" aria-label="Mission ${i+1}: ${esc(m.title)}${S.done[S.ch+'.'+i]?' (done)':''}"${i===S.mi?' aria-current="step"':''}>${i+1}</button>`).join('')}</div>`;
  let h;
  if(S.mi>=n){const all=chapterDone(S.ch),last=S.ch===CH.length-1;
    h=`${Trail.html(ch.story)}<div class="eyebrow">Chapter ${S.ch+1} complete</div><div class="badge-art${all?'':' dim'}" aria-hidden="true">${all?'★':S.ch+1}</div>
    <h2>${all?'Badge earned: '+esc(ch.badge):'Chapter finished'}</h2>
    <p class="explain">${all?'Every mission in this chapter is done. ':'A few missions are still open: the dots below show which. '}You can now write these in PostGIS:</p>
    <div class="learned">${ch.learned.map(x=>`<code>${esc(x)}</code>`).join('')}</div>
    <p class="note">The editor still runs, so keep asking the island questions as long as you like.</p>
    ${last?`<p class="note">${all?'You found Odile\'s Compass Rose at the bottom of the Wishing Well. ':''}That is every chapter there is for now. Play Quick-fire to keep the facts fresh, or browse the field guide.</p><div class="actions"><button class="btn" data-act="tab-fire">Play Quick-fire</button><button class="btn ghost" data-act="tab-guide">Open the field guide</button></div>`
      :`<div class="actions"><button class="btn" data-act="nextch">Start chapter ${S.ch+2}: ${esc(CH[S.ch+1].name)}</button></div>`}${dots}`;}
  else{const m=ch.missions[S.mi];
    h=`${Trail.html(ch.story)}<div class="eyebrow">Chapter ${S.ch+1} · Mission ${S.mi+1} of ${n}${S.done[mkey()]?' · done ✓':''}</div>
    <h2>${esc(m.title)}</h2>
    <div class="goal"><div class="label">Your goal</div><p>${m.goal}</p></div>
    <button type="button" class="btn ghost narrow-only" data-act="tosql">Open the editor ↓</button>
    ${anatomy(m.anat)}
    ${HowSteps.html(m.how)}
    <p class="explain">${m.explain}</p>
    ${m.note?`<p class="note">${m.note}</p>`:''}
    <details class="hint"><summary>Show a hint</summary><p>${m.hint}</p></details>
    <div class="actions"><button class="btn ghost" data-act="fill">Type it for me</button></div>
    <details class="about"${S.mi===0&&!S.done[mkey()]&&wide()?' open':''}><summary>About this chapter</summary><p class="intro">${ch.intro}</p></details>${dots}`;}
  missionEl.innerHTML=h;
  if(pop){missionEl.classList.remove('pop');void missionEl.offsetWidth;missionEl.classList.add('pop');pop=false;}
}
missionEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.mi!==undefined){gotoMission(S.ch,+b.dataset.mi);const d=missionEl.querySelector(`[data-mi="${S.mi}"]`);if(d)d.focus({preventScroll:true});return;}
  const a=b.dataset.act;
  if(a==='tosql'){setView('sql');$('#sqlPanel').scrollIntoView({block:'start',behavior:reduced()?'auto':'smooth'});sqlIn.focus({preventScroll:true});}
  else if(a==='fill'){const m=curMission();if(!m)return;setSql(m.answer);setView('sql');sqlIn.focus({preventScroll:!wide()});}
  else if(a==='nextch')gotoMission(S.ch+1,0);
  else if(a&&a.startsWith('tab-'))showTab(a.slice(4),true);});
chaptersEl.addEventListener('click',e=>{const b=e.target.closest('.chap');if(!b)return;const ci=+b.dataset.ch;let mi=CH[ci].missions.findIndex((_,i)=>!S.done[ci+'.'+i]);if(mi<0)mi=0;gotoMission(ci,mi);const c=chaptersEl.querySelector(`[data-ch="${ci}"]`);if(c)c.focus({preventScroll:true});});
function gotoMission(ci,mi,focusSql){
  if(!CH[ci])return;
  S.ch=ci;S.mi=Math.max(0,Math.min(mi,CH[ci].missions.length));save();
  renderChapters();renderMission();startSession();
  if(innerWidth<820)missionEl.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'start'});
  if(focusSql)sqlIn.focus({preventScroll:innerWidth<820});
}

/* ---------- XP ---------- */
function renderXP(){let i=0;while(i+1<RANKS.length&&S.xp>=RANKS[i+1][0])i++;const lo=RANKS[i][0],hi=i+1<RANKS.length?RANKS[i+1][0]:lo;
  $('#rank').textContent=RANKS[i][1];$('#xpText').textContent=S.xp+' XP';$('#xpFill').style.width=(hi>lo?Math.min(100,(S.xp-lo)/(hi-lo)*100):100)+'%';}

/* ---------- tabs ---------- */
function showTab(t,user){if(!TABS.includes(t))t='quest';if(user&&S.tab!==t){S.tab=t;save();}else S.tab=t;
  document.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===t)));
  TABS.forEach(x=>{$('#tab-'+x).hidden=x!==t;});
  if(t!=='fire')stopFire(true);if(t==='guide'&&!$('#guide').dataset.ready)renderGuide();if(t==='fire'&&!fireOn)fireIdle();}
$('.tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)showTab(b.dataset.tab,true);});
$('.tabs').addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const bs=[...document.querySelectorAll('.tabs button[data-tab]')];let i=bs.findIndex(b=>b.getAttribute('aria-selected')==='true');i=(i+(e.key==='ArrowRight'?1:bs.length-1))%bs.length;showTab(bs[i].dataset.tab,true);bs[i].focus();});

/* ---------- quick-fire (no XP: ranks come from missions) ---------- */
const ROUND=75,fStage=$('#fStage');let fireOn=false,fT=0,fLeft=ROUND,fScore=0,fStreak=0,fQ=null,fDeck=[],fMiss=[],fLocked=false,fNext=0;
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
function setStats(){$('#fScore').textContent=fScore;$('#fStreak').textContent=fStreak;$('#fBest').textContent=S.best;$('#fTime').textContent=fLeft;$('#fTimer').style.width=(fLeft/ROUND*100)+'%';}
// a question is in the pool once every mission of its chapter is done, so nothing is asked before it was taught
const qfPool=()=>QF.filter(q=>chapterDone(q.ch|0));
function fireLocked(){const open=CH.map((c,i)=>i).filter(i=>!chapterDone(i)&&QF.some(q=>(q.ch|0)===i)).slice(0,1);
  return `<p class="explain">Quick-fire asks about things the missions have taught, so it opens once you finish a chapter. ${open.length?'Finish '+open.map(i=>`<b>Chapter ${i+1}: ${esc(CH[i].name)}</b> (${totalDone(i)} of ${CH[i].missions.length} missions done)`).join(' and ')+' first.':''}</p>
  <div class="actions"><button class="btn" data-act="tab-quest">Back to the missions</button></div>`;}
function fireIdle(){if(!qfPool().length){fStage.innerHTML=fireLocked();setStats();return;}
  fStage.innerHTML=`<p class="explain">You will get one question at a time with four answers. Pick fast: the clock runs for ${ROUND} seconds, and every correct answer in a row adds a streak bonus. Your best score is kept, and nothing here changes your XP.</p>
  <div class="actions"><button class="btn" id="fStart">Start the clock</button><span class="note" style="align-self:center">Keys <kbd>1</kbd>–<kbd>4</kbd> pick an answer.</span></div>`;setStats();}
function nextQ(){const pool=qfPool();if(!fDeck.length)fDeck=shuffle(pool.map(q=>QF.indexOf(q)));fQ=QF[fDeck.pop()];
  fQ.opts=shuffle([fQ.a,...fQ.w.filter(w=>w!==fQ.a).slice(0,3)]);fLocked=false;
  fStage.innerHTML=`<div class="task">${fQ.c}</div><div class="opts">${fQ.opts.map((o,i)=>`<button class="opt" data-i="${i}"><span class="n">${i+1}</span><span class="ot">${esc(o)}</span></button>`).join('')}</div>
  <p class="fb" id="fFb" aria-live="polite"></p><div class="actions"><button class="btn ghost" id="fStop">End round</button></div>`;fStage.querySelector('.opt').focus({preventScroll:true});}
function pick(i){if(!fireOn||fLocked||!fQ)return;fLocked=true;const ok=fQ.opts[i]===fQ.a;const bs=[...fStage.querySelectorAll('.opt')];
  bs.forEach((b,j)=>{b.disabled=true;if(fQ.opts[j]===fQ.a)b.classList.add('right');else if(j===i)b.classList.add('wrong');});const fb=$('#fFb');
  if(ok){fStreak++;const pts=10+Math.min(fStreak-1,5)*2;fScore+=pts;fb.className='fb good';fb.textContent=`Correct! +${pts}${fStreak>1?` (streak ${fStreak})`:''}`;}
  else{fStreak=0;fMiss.push(fQ);fb.className='fb bad';fb.textContent='Not this time. The answer is “'+fQ.a+'”. '+fQ.why;}
  setStats();clearTimeout(fNext);fNext=setTimeout(()=>{if(fireOn)nextQ();},ok?700:2600);}
function startFire(){if(!qfPool().length){fireIdle();return;}fDeck=[];fireOn=true;fLeft=ROUND;fScore=0;fStreak=0;fMiss=[];setStats();nextQ();clearInterval(fT);fT=setInterval(()=>{fLeft--;setStats();if(fLeft<=0)stopFire();},1000);}
function stopFire(silent){if(!fireOn)return;fireOn=false;clearInterval(fT);clearTimeout(fNext);if(silent){fLeft=ROUND;fScore=0;fStreak=0;fireIdle();return;}if(fScore>S.best){S.best=fScore;save();}setStats();
  fStage.innerHTML=`<div class="task">Round over: ${fScore} points</div><p class="note" style="margin:0">${fScore>=S.best&&fScore>0?'That is your best score so far.':`Your best is ${S.best}.`}</p>
  ${fMiss.length?`<div><p class="explain" style="margin:0 0 8px"><b>Worth another look:</b></p><ul class="misses">${fMiss.map(q=>`<li><span>${q.c}</span><span>Answer: <b>${esc(q.a)}</b></span><span class="note">${esc(q.why)}</span></li>`).join('')}</ul></div>`:'<p class="explain" style="margin:0">No misses. Your map is in order.</p>'}
  <div class="actions"><button class="btn" id="fStart">Play again</button></div>`;}
fStage.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.act==='tab-quest')showTab('quest',true);else if(b.id==='fStart')startFire();else if(b.id==='fStop')stopFire();else if(b.dataset.i!==undefined)pick(+b.dataset.i);});
document.addEventListener('keydown',e=>{if(!fireOn||$('#tab-fire').hidden)return;if(/^[1-4]$/.test(e.key)&&fQ&&+e.key<=fQ.opts.length){e.preventDefault();pick(+e.key-1);}});

/* ---------- field guide ---------- */
function renderGuide(){const g=$('#guide');g.dataset.ready='1';
  g.innerHTML=`<div><h2>Field guide</h2><p class="lede">A quick reference for the SQL and PostGIS the missions teach. Click an example to put it in the editor, then press Run.</p></div>
  ${CH.map((c,ci)=>{const items=GUIDE.filter(x=>x.ch===ci);return items.length?`<section class="gsec"><h3>Chapter ${ci+1}: ${esc(c.name)}</h3><div class="cards">${items.map(x=>`<article class="card panel"><h4>${esc(x.c)}</h4><p>${x.what}</p>${anatomy(x.syn)}<div class="ex">${x.ex.map(([q,note])=>`<div class="exrow"><button class="excmd" data-sql="${esc(q)}" title="Put this in the editor"><code>${esc(q)}</code><span class="try">Try it</span></button>${note?`<small>${note}</small>`:''}</div>`).join('')}</div></article>`).join('')}</div></section>`:'';}).join('')}
  <section class="gsec"><h3>On a real database</h3><div class="panel" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px"><p class="explain">Reference for later. Every query in this quest is real PostgreSQL with PostGIS: install PostgreSQL, run <code>CREATE EXTENSION postgis;</code>, and a table like <code>places</code> is <code>CREATE TABLE places (id int PRIMARY KEY, name text, kind text, geom geometry(Point, 4326));</code>. This practice database only reads the island's tables, and it numbers k-means clusters in its own way: a real one may give the same groups other numbers. Real tables with many rows want a spatial index: <code>CREATE INDEX ON places USING GIST (geom);</code>.</p>
   <div class="actions"><button class="linkbtn" id="resetProgress">Reset all progress</button></div></div></section>`;}
let armProg=0;
$('#guide').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.sql!==undefined){showTab('quest',true);setView('sql');setSql(b.dataset.sql);sqlIn.focus();return;}
  if(b.id==='resetProgress'){if(!b.classList.contains('armed')){b.classList.add('armed');b.textContent='Click again to erase your XP, finished missions and saved queries';clearTimeout(armProg);armProg=setTimeout(()=>{b.classList.remove('armed');b.textContent='Reset all progress';},4000);return;}
    S=fresh();save();renderXP();showTab('quest',true);gotoMission(0,0);}});

/* ---------- boot (reads the save, never writes it) ---------- */
$('#schemaList').innerHTML=PQUI.schema();
setView('sql');renderXP();renderChapters();renderMission();startSession();showTab(S.tab);
})();
