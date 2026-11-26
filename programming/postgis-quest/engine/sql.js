/* PostGIS Quest SQL front end: a lexer and a recursive-descent parser for the SELECT subset the course teaches.
   Errors carry PostgreSQL's wording and the character position they point at (PQ.SqlError). DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
class SqlError extends Error{constructor(msg,pos,hint){super(msg);this.pos=pos;this.hint=hint||null;}}
PQ.SqlError=SqlError;
const MAXLEN=20000,MAXDEPTH=60;

/* ---------- lexer ---------- */
const OPS=['<->','::',':=','<>','!=','<=','>=','||','(',')',',','.',';','*','+','-','/','%','=','<','>','[',']'];
function lex(src){
  if(src.length>MAXLEN)throw new SqlError('this practice database takes queries of up to '+MAXLEN+' characters',0);
  const out=[];let i=0;const n=src.length;
  while(i<n){
    const c=src[i];
    if(/\s/.test(c)){i++;continue;}
    if(c==='-'&&src[i+1]==='-'){while(i<n&&src[i]!=='\n')i++;continue;}
    if(c==='/'&&src[i+1]==='*'){const j=src.indexOf('*/',i+2);if(j<0)throw new SqlError('unterminated /* comment at or near "'+src.slice(i,i+10)+'"',i);i=j+2;continue;}
    const at=i;
    if(c==="'"){let s='';i++;for(;;){if(i>=n)throw new SqlError('unterminated quoted string at or near "'+src.slice(at,at+20)+'"',at);if(src[i]==="'"){if(src[i+1]==="'"){s+="'";i+=2;continue;}i++;break;}s+=src[i++];}out.push({t:'str',v:s,pos:at,raw:src.slice(at,i)});continue;}
    if(c==='"'){let s='';i++;for(;;){if(i>=n)throw new SqlError('unterminated quoted identifier at or near "'+src.slice(at,at+20)+'"',at);if(src[i]==='"'){if(src[i+1]==='"'){s+='"';i+=2;continue;}i++;break;}s+=src[i++];}out.push({t:'id',v:s,q:true,pos:at,raw:src.slice(at,i)});continue;}
    if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(src[i+1]||''))){
      const m=/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));i+=m[0].length;
      if(/[A-Za-z_]/.test(src[i]||''))throw new SqlError('trailing junk after numeric literal at or near "'+src.slice(at,i+1)+'"',at);
      out.push({t:'num',v:+m[0],int:/^\d+$/.test(m[0]),pos:at,raw:m[0]});continue;}
    if(/[A-Za-z_À-￿]/.test(c)){const m=/^[A-Za-z_À-￿][A-Za-z0-9_$À-￿]*/.exec(src.slice(i));i+=m[0].length;out.push({t:'id',v:m[0].toLowerCase(),pos:at,raw:m[0]});continue;}
    const op=OPS.find(o=>src.startsWith(o,i));
    if(!op)throw new SqlError('syntax error at or near "'+c+'"',at);
    i+=op.length;out.push({t:'op',v:op==='!='?'<>':op,pos:at,raw:op});
  }
  out.push({t:'eof',pos:n,raw:''});
  return out;
}
PQ.lex=lex;

/* ---------- parser ---------- */
// words that end an expression or a FROM item; a bare one cannot be a column alias
const RESERVED=new Set(['select','from','where','group','by','having','order','limit','offset','join','inner','left','right','full','outer','cross','on','and','or','not','as','asc','desc','union','with','is','null','in','like','ilike','between','distinct','all','case','when','then','else','end','true','false','over','partition','nulls','first','last','using','natural','into','values','insert','update','delete','create','drop','table','set','returning','window','fetch','except','intersect','lateral']);
const UNSUPPORTED={insert:'INSERT',update:'UPDATE',delete:'DELETE',create:'CREATE',drop:'DROP',alter:'ALTER',explain:'EXPLAIN',copy:'COPY',truncate:'TRUNCATE',grant:'GRANT',vacuum:'VACUUM',analyze:'ANALYZE',begin:'transactions',commit:'transactions',rollback:'transactions'};
const TYPES={int:'integer',integer:'integer',int4:'integer',int8:'bigint',bigint:'bigint',smallint:'integer',numeric:'numeric',decimal:'numeric',float:'double precision',float8:'double precision',real:'double precision',float4:'double precision',text:'text',varchar:'text',geometry:'geometry',boolean:'boolean',bool:'boolean',box2d:'box2d'};

function parse(src){
  const T=lex(src);let p=0,depth=0;
  const peek=(k=0)=>T[Math.min(p+k,T.length-1)];
  const near=t=>t.t==='eof'?new SqlError('syntax error at end of input',t.pos):new SqlError('syntax error at or near "'+t.raw+'"',t.pos);
  const isKw=(w,k=0)=>{const t=peek(k);return t.t==='id'&&!t.q&&t.v===w;};
  const isOp=(o,k=0)=>{const t=peek(k);return t.t==='op'&&t.v===o;};
  const kw=w=>{if(isKw(w)){return T[p++];}return null;};
  const op=o=>{if(isOp(o)){return T[p++];}return null;};
  const needKw=w=>{const t=kw(w);if(!t)throw near(peek());return t;};
  const needOp=o=>{const t=op(o);if(!t)throw near(peek());return t;};
  const deeper=f=>{if(++depth>MAXDEPTH)throw new SqlError('this practice database stops at queries nested '+MAXDEPTH+' levels deep',peek().pos);try{return f();}finally{depth--;}};
  const ident=()=>{const t=peek();if(t.t!=='id'||(!t.q&&RESERVED.has(t.v)))throw near(t);p++;return t.v;};

  function statement(){
    const t=peek();
    if(t.t==='id'&&!t.q&&UNSUPPORTED[t.v])throw new SqlError('this practice database runs SELECT queries only; '+UNSUPPORTED[t.v]+' is not supported yet',t.pos);
    const q=query();
    return q;
  }
  function query(){
    return deeper(()=>{
      let ctes=[];
      if(kw('with')){
        if(isKw('recursive'))throw new SqlError('this practice database does not support WITH RECURSIVE yet',peek().pos);
        do{const at=peek().pos,name=ident();needKw('as');needOp('(');const q=query();needOp(')');ctes.push({name,query:q,pos:at});}while(op(','));
      }
      const s=select();s.with=ctes;
      if(isKw('union')||isKw('except')||isKw('intersect'))throw new SqlError('this practice database does not support '+peek().v.toUpperCase()+' yet',peek().pos);
      return s;
    });
  }
  function select(){
    const st=needKw('select');
    const s={type:'select',pos:st.pos,distinct:false,cols:[],from:null,where:null,group:[],having:null,order:[],limit:null,offset:null};
    if(kw('distinct')){if(isKw('on'))throw new SqlError('this practice database does not support DISTINCT ON yet',peek().pos);s.distinct=true;}else kw('all');
    do{s.cols.push(selItem());}while(op(','));
    if(kw('into'))throw new SqlError('this practice database does not support SELECT INTO',T[p-1].pos);
    if(kw('from'))s.from=fromList();
    if(kw('where'))s.where=expr();
    if(isKw('group')){p++;needKw('by');do{s.group.push(expr());}while(op(','));}
    if(kw('having'))s.having=expr();
    if(isKw('window'))throw new SqlError('this practice database does not support a WINDOW clause yet; write OVER (...) after the function',peek().pos);
    if(isKw('order')){p++;needKw('by');s.order=orderList();}
    if(kw('limit')){s.limit=kw('all')?null:expr();}
    if(kw('offset')){s.offset=expr();kw('rows');kw('row');}
    if(kw('limit')){s.limit=expr();}
    return s;
  }
  function orderList(){const o=[];do{const e=expr();let desc=false;if(kw('desc'))desc=true;else kw('asc');let nulls=null;if(kw('nulls')){if(kw('first'))nulls='first';else{needKw('last');nulls='last';}}o.push({expr:e,desc,nulls});}while(op(','));return o;}
  function selItem(){
    const at=peek().pos;
    if(isOp('*')){p++;return {star:true,pos:at};}
    if(peek().t==='id'&&isOp('.',1)&&isOp('*',2)){const t=peek().v;p+=3;return {star:true,table:t,pos:at};}
    const e=expr();let alias=null;
    if(kw('as'))alias=aliasName();
    else if(peek().t==='id'&&(peek().q||!RESERVED.has(peek().v)))alias=T[p++].v;
    return {expr:e,alias,pos:at,src:src.slice(at,peek().pos).trim()};
  }
  const aliasName=()=>{const t=peek();if(t.t!=='id')throw near(t);p++;return t.v;};
  function fromList(){
    let f=fromJoin();
    while(op(',')){const r=fromJoin();f={type:'join',kind:'cross',left:f,right:r,on:null};}
    return f;
  }
  function fromJoin(){
    let f=fromItem();
    for(;;){
      let kind=null;const at=peek().pos;
      if(kw('join'))kind='inner';
      else if(isKw('inner')&&isKw('join',1)){p+=2;kind='inner';}
      else if(isKw('left')){p++;kw('outer');needKw('join');kind='left';}
      else if(isKw('cross')){p++;needKw('join');kind='cross';}
      else if(isKw('right')||isKw('full')||isKw('natural'))throw new SqlError('this practice database does not support '+peek().v.toUpperCase()+' JOIN yet; use JOIN or LEFT JOIN',peek().pos);
      if(!kind)return f;
      const r=fromItem();let on=null;
      if(kind!=='cross'){if(isKw('using'))throw new SqlError('this practice database does not support JOIN ... USING yet; write ON',peek().pos);needKw('on');on=expr();}
      f={type:'join',kind,left:f,right:r,on,pos:at};
    }
  }
  function fromItem(){
    const at=peek().pos;
    if(isKw('lateral'))throw new SqlError('this practice database does not support LATERAL yet',at);
    if(op('(')){
      if(!isKw('select')&&!isKw('with')){const f=fromList();needOp(')');return f;}
      const q=query();needOp(')');kw('as');
      if(peek().t!=='id'||(!peek().q&&RESERVED.has(peek().v)))throw new SqlError('subquery in FROM must have an alias',peek().pos,'For example, FROM (SELECT ...) AS c.');
      return {type:'sub',query:q,alias:T[p++].v,pos:at};
    }
    const name=ident();
    if(isOp('('))throw new SqlError('this practice database does not support functions in FROM yet',peek().pos);
    if(op('.'))return tableTail(ident(),at,name);
    return tableTail(name,at);
  }
  function tableTail(name,at,schema){
    let alias=null;
    if(kw('as'))alias=aliasName();
    else if(peek().t==='id'&&(peek().q||!RESERVED.has(peek().v)))alias=T[p++].v;
    return {type:'table',name,schema:schema||null,alias:alias||name,pos:at};
  }

  /* expressions, lowest precedence first: OR, AND, NOT, IS, comparison, IN/LIKE/BETWEEN, other operators, + -, * / %,
     unary minus, ::, then the primaries */
  const expr=()=>deeper(orE);
  function orE(){let a=andE();while(isKw('or')){const t=T[p++];a={t:'bin',op:'or',a,b:andE(),pos:t.pos};}return a;}
  function andE(){let a=notE();while(isKw('and')){const t=T[p++];a={t:'bin',op:'and',a,b:notE(),pos:t.pos};}return a;}
  function notE(){if(isKw('not')){const t=T[p++];return {t:'not',a:deeper(notE),pos:t.pos};}return isE();}
  function isE(){
    let a=cmpE();
    while(isKw('is')){const t=T[p++];const not=!!kw('not');
      if(kw('null'))a={t:'isnull',a,not,pos:t.pos};
      else if(kw('true'))a={t:'istrue',a,not,v:true,pos:t.pos};
      else if(kw('false'))a={t:'istrue',a,not,v:false,pos:t.pos};
      else if(kw('distinct')){needKw('from');a={t:'distinctfrom',a,b:cmpE(),not,pos:t.pos};}
      else throw near(peek());}
    return a;
  }
  const CMP=['=','<>','<','>','<=','>='];
  function cmpE(){let a=inE();while(peek().t==='op'&&CMP.includes(peek().v)){const t=T[p++];a={t:'bin',op:t.v,a,b:inE(),pos:t.pos};}return a;}
  function inE(){
    let a=otherE();
    for(;;){
      const not=isKw('not')&&(isKw('in',1)||isKw('like',1)||isKw('ilike',1)||isKw('between',1));
      if(not)p++;
      const t=peek();
      if(kw('in')){needOp('(');
        if(isKw('select')||isKw('with')){const q=query();needOp(')');a={t:'insub',a,query:q,not,pos:t.pos};continue;}
        const list=[];do{list.push(expr());}while(op(','));needOp(')');a={t:'in',a,list,not,pos:t.pos};continue;}
      if(kw('like')||kw('ilike')){a={t:'like',a,b:otherE(),not,ci:t.v==='ilike',pos:t.pos};continue;}
      if(kw('between')){const lo=otherE();needKw('and');const hi=otherE();a={t:'between',a,lo,hi,not,pos:t.pos};continue;}
      if(not)throw near(peek());
      return a;
    }
  }
  function otherE(){let a=addE();while(isOp('<->')||isOp('||')){const t=T[p++];a={t:'bin',op:t.v,a,b:addE(),pos:t.pos};}return a;}
  function addE(){let a=mulE();while(isOp('+')||isOp('-')){const t=T[p++];a={t:'bin',op:t.v,a,b:mulE(),pos:t.pos};}return a;}
  function mulE(){let a=unE();while(isOp('*')||isOp('/')||isOp('%')){const t=T[p++];a={t:'bin',op:t.v,a,b:unE(),pos:t.pos};}return a;}
  function unE(){if(isOp('-')||isOp('+')){const t=T[p++];const a=deeper(unE);if(t.v==='+')return a;if(a.t==='lit'&&typeof a.v==='number')return {...a,v:-a.v,pos:t.pos};return {t:'neg',a,pos:t.pos};}return castE();}
  function castE(){let a=primary();while(isOp('::')){const t=T[p++];a={t:'cast',a,to:typeName(),pos:t.pos};}return a;}
  function typeName(){
    const t=peek();if(t.t!=='id')throw near(t);p++;
    let name=t.v;
    if(name==='double'){needKw('precision');name='float8';}
    if(name==='character'&&kw('varying'))name='varchar';
    const ty=TYPES[name];
    if(!ty){if(name==='geography')throw new SqlError('this practice database has no geography type yet; for meters on 4326 points use ST_DistanceSphere',t.pos);throw new SqlError('type "'+t.raw+'" does not exist',t.pos);}
    if(op('(')){ // geometry(Point, 4326), numeric(10,2), varchar(20): the modifier does not change a value here
      let d=1;while(d>0){const x=T[p++];if(x.t==='eof')throw near(x);if(x.t==='op'&&x.v==='(')d++;if(x.t==='op'&&x.v===')')d--;}
    }
    return ty;
  }
  function primary(){
    const t=peek();
    if(t.t==='num'){p++;return {t:'lit',v:t.v,ty:t.int?(Math.abs(t.v)<=2147483647?'integer':'bigint'):'numeric',pos:t.pos};}
    if(t.t==='str'){p++;return {t:'lit',v:t.v,ty:'unknown',pos:t.pos};}
    if(t.t==='op'&&t.v==='('){
      p++;
      if(isKw('select')||isKw('with')){const q=query();needOp(')');return {t:'sub',query:q,pos:t.pos};}
      const e=expr();
      if(isOp(',')){const items=[e];while(op(','))items.push(expr());needOp(')');return {t:'row',items,pos:t.pos};}
      needOp(')');return e;
    }
    if(t.t==='op'&&t.v==='*')throw near(t);
    if(t.t!=='id')throw near(t);
    if(!t.q){
      if(t.v==='null'){p++;return {t:'lit',v:null,ty:'unknown',pos:t.pos};}
      if(t.v==='true'||t.v==='false'){p++;return {t:'lit',v:t.v==='true',ty:'boolean',pos:t.pos};}
      if(t.v==='case')return caseE();
      if(t.v==='exists'&&isOp('(',1)){p+=2;const q=query();needOp(')');return {t:'exists',query:q,pos:t.pos};}
      if(t.v==='cast'&&isOp('(',1)){p+=2;const a=expr();needKw('as');const to=typeName();needOp(')');return {t:'cast',a,to,pos:t.pos};}
      if(t.v==='array'||t.v==='interval')throw new SqlError('this practice database does not support '+t.v.toUpperCase()+' yet',t.pos);
      if(RESERVED.has(t.v))throw near(t);
    }
    p++;
    // a typed literal such as geometry 'POINT(1 2)'
    if(!t.q&&peek().t==='str'&&TYPES[t.v]){const s=T[p++];return {t:'cast',a:{t:'lit',v:s.v,ty:'unknown',pos:s.pos},to:TYPES[t.v],pos:t.pos};}
    if(isOp('('))return call(t);
    if(op('.')){
      const n=peek();
      if(n.t!=='id')throw near(n);p++;
      if(isOp('('))throw new SqlError('this practice database does not support schema-qualified functions; drop "'+t.raw+'."',t.pos);
      return {t:'col',table:t.v,name:n.v,pos:t.pos,raw:t.raw+'.'+n.raw};
    }
    return {t:'col',table:null,name:t.v,pos:t.pos,raw:t.raw};
  }
  function caseE(){
    const t=T[p++];let base=null;
    if(!isKw('when'))base=expr();
    const whens=[];
    while(kw('when')){const w=expr();needKw('then');whens.push([w,expr()]);}
    if(!whens.length)throw near(peek());
    let other=null;if(kw('else'))other=expr();
    needKw('end');
    return {t:'case',base,whens,other,pos:t.pos};
  }
  function call(t){
    p++; // (
    const c={t:'call',name:t.v,args:[],named:{},star:false,distinct:false,over:null,pos:t.pos,raw:t.raw};
    if(op('*')){c.star=true;needOp(')');}
    else if(!op(')')){
      if(kw('distinct'))c.distinct=true;
      do{
        if(peek().t==='id'&&(isOp(':=',1)||(isOp('=',1)&&isOp('>',2)))){const n=T[p++].v;p+=isOp(':=')?1:2;if(n in c.named)throw new SqlError('argument name "'+n+'" used more than once',T[p-1].pos);c.named[n]=expr();}
        else{if(Object.keys(c.named).length)throw new SqlError('positional argument cannot follow named argument',peek().pos);c.args.push(expr());}
      }while(op(','));
      if(isKw('order'))throw new SqlError('this practice database does not support ORDER BY inside a function call yet',peek().pos);
      needOp(')');
    }
    if(isKw('filter'))throw new SqlError('this practice database does not support FILTER yet',peek().pos);
    if(isKw('within'))throw new SqlError('this practice database does not support WITHIN GROUP yet',peek().pos);
    if(kw('over')){
      if(!isOp('('))throw new SqlError('this practice database does not support named windows yet; write OVER (...)',peek().pos);
      p++;const w={partition:[],order:[]};
      if(isKw('partition')){p++;needKw('by');do{w.partition.push(expr());}while(op(','));}
      if(isKw('order')){p++;needKw('by');w.order=orderList();}
      if(isKw('rows')||isKw('range')||isKw('groups'))throw new SqlError('this practice database does not support window frames yet',peek().pos);
      needOp(')');c.over=w;
    }
    return c;
  }

  // a script: statements split by ;
  const stmts=[];
  while(peek().t!=='eof'){
    if(op(';'))continue;
    const at=peek().pos;
    const s=statement();s.start=at;s.end=peek().pos;
    stmts.push(s);
    if(peek().t!=='eof'&&!isOp(';'))throw near(peek());
  }
  return stmts;
}
PQ.parse=parse;
PQ.TYPES=TYPES;
})();
