// ===== Хранилище: аккаунт (db) с запасом в браузере =====
const LSK='rychag.v1';
const S0={prof:{h:178,kg:78,sex:null,femur:0,set:false},concerns:[],favs:[],tab:'muscles',log:[],gym:[],program:null,body:[],voice:{on:false,count:true,rate:1},remind:null,rx:null};
const SKEYS=['prof','concerns','favs','gym','program','body','voice','remind','rx'];
const store={...JSON.parse(JSON.stringify(S0)),mode:'local',uid:null,db:null,onChange:null};
function lsRead(){try{return JSON.parse(localStorage.getItem(LSK)||'null')}catch(e){return null}}
function lsWrite(){try{localStorage.setItem(LSK,JSON.stringify({prof:store.prof,concerns:store.concerns,favs:store.favs,gym:store.gym,program:store.program,body:store.body.slice(0,300),voice:store.voice,remind:store.remind,rx:store.rx,tab:store.tab,log:store.log.slice(0,120)}))}catch(e){}}
(function(){const l=lsRead();if(l){for(const k of [...SKEYS,'tab','log'])if(l[k]!=null)store[k]=k==='prof'?{...S0.prof,...l[k]}:k==='voice'?{...S0.voice,...l[k]}:l[k]}setBody(store.prof)})();

const chains={};
function queueWrite(key,fn){const prev=chains[key]||Promise.resolve();const next=prev.then(fn).catch(e=>{if(e&&(e.code==='invalid_argument'||e.code==='revoked'||e.code==='not_granted')){store.mode='local';store.onChange&&store.onChange('mode')}});chains[key]=next;return next}
function settingsBody(){return JSON.parse(JSON.stringify({prof:store.prof,concerns:store.concerns,favs:store.favs,gym:store.gym,program:store.program,body:store.body.slice(0,300),voice:store.voice,remind:store.remind,rx:store.rx,updated:Date.now()}))}
let saveT=0;
function saveSettings(){lsWrite();clearTimeout(saveT);saveT=setTimeout(()=>{if(store.mode!=='db')return;const ref=store.db.doc('data/users/'+store.uid+'/state');queueWrite('state',()=>ref.set(settingsBody()))},700)}
function saveSession(s){
  const i=store.log.findIndex(x=>x.id===s.id); if(i>=0)store.log[i]=s; else store.log.unshift(s);
  store.log.sort((a,b)=>b.ts-a.ts); lsWrite();
  if(store.mode==='db'){const ref=store.db.doc('data/users/'+store.uid+'/state').collection('log').doc(s.id);const body=JSON.parse(JSON.stringify(s));queueWrite('log-'+s.id,()=>ref.set(body))}
}
function deleteSession(id){store.log=store.log.filter(x=>x.id!==id);lsWrite();if(store.mode==='db'){const ref=store.db.doc('data/users/'+store.uid+'/state').collection('log').doc(id);queueWrite('log-'+id,()=>ref.delete())}}
function setTab(t){store.tab=t;lsWrite()}

async function connectStore(){
  const C=window.claude; if(!C||!C.use)return;
  try{
    const [db,user]=await Promise.all([C.use('db'),C.use('user')]);
    if(!db||!user)return;
    const uid=await user.id(); if(!uid)return;
    store.db=db; store.uid=uid;
    const stRef=db.doc('data/users/'+uid+'/state');
    const timeout=new Promise((_,rej)=>setTimeout(()=>rej({code:'timeout'}),10000));
    const snap=await Promise.race([stRef.get(),timeout]);
    if(snap.exists){const d=snap.data();if(d.prof)store.prof={...store.prof,...d.prof};if(d.concerns)store.concerns=d.concerns;if(d.favs)store.favs=d.favs;if(d.gym)store.gym=d.gym;if('program' in d)store.program=d.program;if(d.body)store.body=d.body;if(d.voice)store.voice={...S0.voice,...d.voice};if('remind' in d)store.remind=d.remind;if('rx' in d){store.rx=d.rx;syncRx()}setBody(store.prof)}
    const logs=await Promise.race([stRef.collection('log').orderBy('ts','desc').limit(200).get(),timeout]);
    const remote=logs.docs.map(d=>d.data()).filter(Boolean);
    const ids=new Set(remote.map(x=>x.id)), localOnly=store.log.filter(x=>!ids.has(x.id));
    store.log=[...remote,...localOnly].sort((a,b)=>b.ts-a.ts);
    store.mode='db';
    if(!snap.exists&&(store.favs.length||store.concerns.length||store.prof.set||store.gym.length||store.body.length||store.program))queueWrite('state',()=>stRef.set(settingsBody()));
    for(const s of localOnly)saveSession(s);
    lsWrite(); store.onChange&&store.onChange('loaded');
  }catch(e){store.mode='local'}
}
