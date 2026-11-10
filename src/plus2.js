// ===== v8: резервная копия, ключ Claude, напоминания, режим врача, RIR, блины, суперсеты, карточка рекорда, «Здоровье» =====
const NATIVE=()=>window.RYCHAG_NATIVE||null;

// ---------- Сохранение файлов: приложение → «Поделиться», claude.ai → загрузка ----------
async function saveOut(filename,data,mime){
  const N=NATIVE();
  if(N&&N.saveFile){try{await N.saveFile(filename,data,mime);return true}catch(e){toast('Не удалось сохранить файл');return false}}
  try{const C=window.claude,dl=C&&C.use?await C.use('downloads'):null;
    if(dl){const blob=typeof data==='string'&&data.startsWith('data:')?await (await fetch(data)).blob():new Blob([data],{type:mime});await dl.save({filename,data:blob});return true}}
  catch(e){if(e&&e.code==='declined')return false}
  try{const blob=typeof data==='string'&&data.startsWith('data:')?await (await fetch(data)).blob():new Blob([data],{type:mime});
    if(navigator.canShare&&navigator.canShare({files:[new File([blob],filename,{type:mime})]})){await navigator.share({files:[new File([blob],filename,{type:mime})]});return true}
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();return true}catch(e){return false}
}
async function copyText(t){try{await navigator.clipboard.writeText(t);toast('Скопировано');return true}catch(e){toast('Не удалось скопировать');return false}}

// ===================== РЕЗЕРВНАЯ КОПИЯ =====================
function backupData(){return {app:'rychag',v:2,ts:Date.now(),prof:store.prof,concerns:store.concerns,favs:store.favs,gym:store.gym,program:store.program,body:store.body,voice:store.voice,remind:store.remind||null,rx:store.rx||null,log:store.log}}
function lastBackup(){try{return +localStorage.getItem('rychag.backup')||0}catch(e){return 0}}
function backupHtml(){
  const lb=lastBackup(), n=store.log.filter(s=>s.done).length, old=n>=3&&Date.now()-lb>14*DAY;
  return `<section class="pbox" id="bkp"><h2 class="sec">Резервная копия</h2>
  <p class="note">${store.mode==='db'?'Данные и так хранятся в аккаунте Claude. Копия пригодится, чтобы перенести журнал в приложение на телефоне.':'Журнал хранится '+HERE+'. Сохрани копию в файл — в облако, мессенджер или почту, — чтобы не потерять данные при смене телефона.'}</p>
  ${old?`<div class="w warn"><span class="wi">${ICON.warn}</span><p>${lb?`Последняя копия — ${fmtDate(lb)}.`:'Копия ещё ни разу не сохранялась.'} В журнале ${n} ${plural(n,'тренировка','тренировки','тренировок')}.</p></div>`:lb?`<p class="note">Последняя копия: ${fmtDate(lb)}.</p>`:''}
  <div class="row2"><button class="btn sm" id="bexp">Сохранить копию</button><label class="btn sm ghost" for="bimp">Восстановить из файла</label><input type="file" id="bimp" accept=".json,application/json,text/plain" hidden></div></section>`;
}
function bindBackup(){
  const e=$('#bexp');if(!e)return;
  e.addEventListener('click',async()=>{const d=new Date(),name=`rychag-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.json`;
    const ok=await saveOut(name,JSON.stringify(backupData()),'application/json');if(ok){try{localStorage.setItem('rychag.backup',String(Date.now()))}catch(x){}toast('Копия сохранена');showProfileTab()}});
  $('#bimp').addEventListener('change',async ev=>{const f=ev.target.files[0];if(!f)return;let d;try{d=JSON.parse(await f.text())}catch(x){toast('Это не файл копии «Рычага»');return}
    if(!d||d.app!=='rychag'||!Array.isArray(d.log)){toast('Это не файл копии «Рычага»');return}
    const have=new Set(store.log.map(s=>s.id)), add=d.log.filter(s=>s&&s.id&&!have.has(s.id));
    for(const k of ['prof','concerns','favs','gym','program','body','voice','remind','rx'])if(d[k]!=null)store[k]=k==='prof'?{...store.prof,...d[k],set:true}:d[k];
    store.log=[...store.log,...add].sort((a,b)=>b.ts-a.ts);setBody(store.prof);syncRx();
    saveSettings();for(const s of add)saveSession(s);
    toast(`Восстановлено: ${add.length} ${plural(add.length,'тренировка','тренировки','тренировок')}, настройки и замеры`);renderTopConcerns();showProfileTab()});
}

// ===================== КЛЮЧ CLAUDE API (только приложение) =====================
function apiKeyHtml(){
  const N=NATIVE();if(!N||!N.apiKey)return '';
  const k=N.apiKey.get(), m=N.apiKey.model();
  return `<section class="pbox"><h2 class="sec">Тренер и фото (Claude API)</h2>
  <p class="note">Чтобы работали чат «Тренер» и распознавание тренажёра по фото, вставь свой ключ из console.anthropic.com. Ключ хранится только на этом телефоне, запросы идут напрямую в Anthropic. Оплата — по факту использования.</p>
  <label class="fld"><span>Ключ API</span><input id="akey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${k?'••••••••'+esc(k.slice(-4)):''}"></label>
  <div class="seg sm" id="amod">${[['claude-haiku-5-5','Быстрее и дешевле'],['claude-sonnet-5-5','Умнее']].map(([id,n])=>`<button data-m="${id}" class="${m===id?'on':''}">${n}</button>`).join('')}</div>
  <div class="row2"><button class="btn sm" id="asave">Сохранить ключ</button>${k?'<button class="link danger" id="adel">Удалить ключ</button>':''}</div>
  ${k?'<p class="note">Ключ сохранён ✓</p>':''}</section>`;
}
function bindApiKey(){
  const N=NATIVE();if(!N||!N.apiKey||!$('#asave'))return;
  $('#amod').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;N.apiKey.setModel(b.dataset.m);$('#amod').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))});
  $('#asave').addEventListener('click',()=>{const v=$('#akey').value.trim();if(!v||v.startsWith('••')){toast('Вставь ключ целиком');return}if(!/^sk-ant-/.test(v)){toast('Ключ должен начинаться с sk-ant-');return}N.apiKey.set(v);samplePromise=null;sampleFn=null;toast('Ключ сохранён — тренер и фото включены');showProfileTab()});
  const d=$('#adel');if(d)d.addEventListener('click',()=>{N.apiKey.set('');samplePromise=null;sampleFn=null;showProfileTab()});
}

// ===================== НАПОМИНАНИЯ (только приложение) =====================
const WDAYS=[[2,'Пн'],[3,'Вт'],[4,'Ср'],[5,'Чт'],[6,'Пт'],[7,'Сб'],[1,'Вс']];
function remindHtml(){
  const N=NATIVE();if(!N||!N.notify)return '';
  const r=store.remind||{on:false,days:[2,4,6],time:'18:00'};
  return `<section class="pbox"><h2 class="sec">Напоминания</h2>
  <p class="note">В дни тренировок пришлю уведомление, какой день программы следующий. Таймер отдыха тоже напомнит уведомлением, если свернуть приложение.</p>
  <div class="wdays" id="rdays">${WDAYS.map(([d,n])=>`<button data-d="${d}" class="${r.days.includes(d)?'on':''}" aria-pressed="${r.days.includes(d)}">${n}</button>`).join('')}</div>
  <div class="row2"><label class="fld inl"><span>Время</span><input type="time" id="rtime" value="${r.time}"></label><button class="btn sm${r.on?' ghost':''}" id="ron">${r.on?'Выключить':'Включить напоминания'}</button></div></section>`;
}
function bindRemind(){
  const N=NATIVE();if(!N||!N.notify||!$('#ron'))return;
  const r=store.remind||{on:false,days:[2,4,6],time:'18:00'};
  const apply=async()=>{store.remind={...r};saveSettings();const ok=await rescheduleReminders();if(r.on&&!ok){toast('Уведомления не разрешены — включи их в настройках телефона');store.remind.on=false;saveSettings()}};
  $('#rdays').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=+b.dataset.d;r.days=r.days.includes(d)?r.days.filter(x=>x!==d):[...r.days,d];b.classList.toggle('on');b.setAttribute('aria-pressed',r.days.includes(d));if(r.on)apply()});
  $('#rtime').addEventListener('change',e=>{r.time=e.target.value||'18:00';if(r.on)apply()});
  $('#ron').addEventListener('click',async()=>{r.on=!r.on;await apply();showProfileTab()});
}
async function rescheduleReminders(){
  const N=NATIVE();if(!N||!N.notify)return false;
  const r=store.remind;await N.notify.cancelWeekly().catch(()=>{});
  if(!r||!r.on||!r.days.length)return true;
  const ps=progState(), body=ps&&!ps.finished?`${ps.P.short}: ${ps.P.days[ps.day].n}`:'Время тренировки — план соберу за минуту';
  return N.notify.weekly(r.days,r.time,'Сегодня тренировка 💪',body).then(()=>true).catch(()=>false);
}

// ===================== RIR и автопрогрессия =====================
function rirAvg(sets){const a=sets.filter(x=>x.rir!=null);return a.length?a.reduce((s,x)=>s+x.rir,0)/a.length:null}
function fatigueFor(id,exceptId){
  const hist=[];for(const s of store.log){if(s.id===exceptId||!s.done)continue;const it=(s.items||[]).find(i=>i.id===id);if(it&&it.sets.length)hist.push(it);if(hist.length>=3)break}
  if(hist.length<3)return null;
  const e=hist.map(it=>Math.max(...it.sets.map(x=>e1rm(x.w,x.r)))), r=hist.map(it=>rirAvg(it.sets));
  if(e[0]<e[1]&&e[1]<e[2]&&r.every(x=>x!=null&&x<=1))return 'Три тренировки подряд результат падает при подходах почти до отказа — это утомление. Сделай лёгкую неделю: −10% веса и на подход меньше.';
  return null;
}
function globalFatigue(){
  const since=Date.now()-10*DAY, sets=[];for(const s of store.log)if(s.done&&s.ts>=since)for(const it of s.items)for(const x of it.sets)if(x.rir!=null)sets.push(x.rir);
  if(sets.length<15)return null;const a=sets.reduce((x,y)=>x+y,0)/sets.length;
  return a<=.8?`За 10 дней в среднем ${kg(Math.round(a*10)/10)} повтора в запасе — почти каждый подход до отказа. Через 4–6 таких недель стоит сделать разгрузку.`:null;
}
const _suggest=suggest;
suggest=function(id,exceptId){
  const base=_suggest(id,exceptId), l=lastSets(id,exceptId);if(!base||!l)return base;
  const [lo,hi]=l.reps||[8,12], w=Math.max(...l.sets.map(s=>s.w)), top=l.sets.filter(s=>s.w===w), ra=rirAvg(top), inc=HEAVY.includes(id)?5:2.5;
  const f=fatigueFor(id,exceptId);
  if(f)return {w:Math.max(inc,Math.round(w*.9/inc)*inc),r:lo,tx:f,warn:true};
  if(ra!=null&&ra>=3&&top.every(s=>s.r>=lo)&&base.w===w)return {w:w+inc,r:lo,tx:`В прошлый раз оставалось ${kg(Math.round(ra*10)/10)} повтора в запасе — вес лёгкий. Попробуй ${kg(w+inc)} кг.`};
  if(ra!=null&&ra<=.5&&top.some(s=>s.r<lo))return {w:Math.max(0,w-inc),r:lo,tx:`Подходы были до отказа и меньше ${lo} повторов — сбавь до ${kg(w-inc)} кг и выполни полный диапазон.`};
  return base;
};
function rirHtml(){const r=wk.rir??2;return `<div class="rir" id="rir"><span>Сколько ещё мог бы сделать?</span><div>${[0,1,2,3,4].map(n=>`<button data-rir="${n}" class="${r===n?'on':''}" aria-pressed="${r===n}">${n===4?'4+':n}</button>`).join('')}</div><small>0 — до отказа, 1–2 — оптимально для роста</small></div>`}

// ===================== КАЛЬКУЛЯТОР БЛИНОВ =====================
const PLATES=[25,20,15,10,5,2.5,1.25];
const usesPlates=e=>/Плитов|Свободн|Смит/.test(e.eq||'')||['smith','smithbench','rack','deadlift','rdl','benchpress'].includes(e.id);
function plateCalc(total,bar){
  let side=(total-bar)/2;if(side<0)return null;const out=[];for(const p of PLATES){let n=0;while(side>=p-1e-6){side-=p;n++}if(n)out.push([p,n])}
  return {out,rest:Math.round(side*100)/100};
}
function platesHtml(e){if(!usesPlates(e))return '';return `<button class="link" id="plbtn">🏋 Какие блины вешать</button><div id="plbox" hidden></div>`}
function drawPlates(e){
  const box=$('#plbox');if(!box)return;const bar=wk.bar??(/Плитов/.test(e.eq||'')&&!/Смит/.test(e.eq||'')?0:20);
  const r=plateCalc(wk.w,bar);
  box.innerHTML=`<div class="plates"><div class="seg sm" id="plbar">${[[20,'Гриф 20'],[15,'Гриф 15'],[10,'EZ 10'],[0,'Без грифа']].map(([b,n])=>`<button data-b="${b}" class="${bar===b?'on':''}">${n}</button>`).join('')}</div>
  ${!r?`<p class="note">Вес меньше веса грифа.</p>`:`<p class="pltx">На каждую сторону ${r.out.length?'':'— ничего'}</p><div class="plrow">${r.out.flatMap(([p,n])=>Array(n).fill(p)).map(p=>`<i class="pl" style="--h:${30+p*2.2}px">${kg(p)}</i>`).join('')}</div>${r.rest>0?`<p class="note">Остаток ${kg(r.rest)} кг на сторону не собрать — ближайший вес ${kg(wk.w-r.rest*2)} кг.</p>`:''}`}
  <p class="note">${bar?`Гриф ${bar} кг + `:''}${r?r.out.map(([p,n])=>`${n}×${kg(p)}`).join(' + ')||'0':''} с каждой стороны. В рычажных тренажёрах вес самого рычага не учтён.</p></div>`;
  $('#plbar').onclick=ev=>{const b=ev.target.closest('button');if(!b)return;wk.bar=+b.dataset.b;drawPlates(e)};
}

// ===================== СУПЕРСЕТЫ =====================
const ssPrev=(s,i)=>i>0&&s.items[i-1].ss;
const ssTarget=it=>it.plan||3;

// ===================== КАРТОЧКА РЕКОРДА =====================
function prsOf(s){
  const out=[];for(const it of s.items){const best=it.sets.reduce((a,x)=>e1rm(x.w,x.r)>e1rm(a.w,a.r)?x:a,it.sets[0]);const be=e1rm(best.w,best.r);
    let prev=0;for(const o of store.log){if(o.id===s.id)continue;const p=(o.items||[]).find(i=>i.id===it.id);if(p)for(const x of p.sets)prev=Math.max(prev,e1rm(x.w,x.r))}
    if(prev>0&&be>prev+.01)out.push({id:it.id,target:it.target,set:best,e:be,prev})}
  return out;
}
async function prCard(pr,ts){
  const c=document.createElement('canvas');c.width=1080;c.height=1350;const x=c.getContext('2d');
  try{await document.fonts.ready}catch(e){}
  const e=EXI[pr.id], M=MUSCLES[pr.target]||{c:'#ff7a2f',n:''};
  const g=x.createRadialGradient(540,520,80,540,600,900);g.addColorStop(0,'#1d2130');g.addColorStop(1,'#0c0d12');x.fillStyle=g;x.fillRect(0,0,1080,1350);
  x.strokeStyle=M.c;x.globalAlpha=.25;x.lineWidth=2;for(let i=0;i<6;i++){x.beginPath();x.arc(540,560,220+i*70,0,7);x.stroke()}x.globalAlpha=1;
  // логотип
  x.save();x.translate(96,110);x.scale(2.4,2.4);x.strokeStyle='#eef0f6';x.lineWidth=2.4;x.lineCap='round';x.beginPath();x.moveTo(3,19);x.lineTo(23,9);x.stroke();x.fillStyle='#ff7a2f';x.beginPath();x.moveTo(10,21);x.lineTo(13,15);x.lineTo(16,21);x.fill();x.fillStyle='#ff47b5';x.beginPath();x.arc(23,9,2.6,0,7);x.fill();x.restore();
  x.fillStyle='#eef0f6';x.font='700 44px Unbounded, system-ui';x.fillText('Рычаг',180,165);
  x.fillStyle='#ff9a5c';x.font='600 40px "Golos Text", system-ui';x.fillText('🏆 НОВЫЙ РЕКОРД',96,330);
  x.fillStyle='#eef0f6';x.font='600 58px "Golos Text", system-ui';
  const words=e.n.split(' ');let line='',y=420;for(const w of words){const t=line?line+' '+w:w;if(x.measureText(t).width>880){x.fillText(line,96,y);y+=70;line=w}else line=t}x.fillText(line,96,y);
  x.fillStyle=M.c;x.font='700 210px Unbounded, system-ui';const big=`${kg(pr.set.w)}`;x.fillText(big,96,y+260);const bw=x.measureText(big).width;
  x.fillStyle='#8f95ab';x.font='600 64px "Golos Text", system-ui';x.fillText(`кг × ${pr.set.r}`,96+bw+24,y+260);
  x.fillStyle='#eef0f6';x.font='500 44px "JetBrains Mono", monospace';x.fillText(`≈ ${kg(Math.round(pr.e))} кг — расчётный 1ПМ`,96,y+360);
  if(pr.prev>0){x.fillStyle='#3fd99a';x.fillText(`+${kg(Math.round((pr.e-pr.prev)*10)/10)} кг к прошлому рекорду`,96,y+430)}
  x.fillStyle='#5d6377';x.font='500 36px "Golos Text", system-ui';x.fillText(`${M.n} · ${new Date(ts).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}`,96,1250);
  return c.toDataURL('image/png');
}
async function sharePr(pr,ts){const url=await prCard(pr,ts);const N=NATIVE();if(N&&N.shareImage){try{await N.shareImage(url,'rychag-record.png');return}catch(e){}}await saveOut('rychag-record.png',url,'image/png')}

// ===================== РЕЖИМ ВРАЧА =====================
const enc64=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const dec64=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
function rxEncode(r){return 'RYCHAG1:'+enc64(JSON.stringify({v:1,n:r.n,by:r.by,w:r.weeks,p:r.per,nt:r.note,d:r.days.map(d=>d.map(x=>[x.id,x.sets,x.r0,x.r1,x.note||''])),ts:Date.now()}))}
function rxDecode(t){const m=String(t).trim().match(/RYCHAG1:([A-Za-z0-9_-]+)/);if(!m)return null;try{const o=JSON.parse(dec64(m[1]));if(o.v!==1||!Array.isArray(o.d))return null;
  return {n:String(o.n||'Программа').slice(0,80),by:String(o.by||'').slice(0,80),weeks:clamp(+o.w||4,1,16),per:clamp(+o.p||2,1,6),note:String(o.nt||'').slice(0,600),ts:o.ts||Date.now(),
    days:o.d.slice(0,6).map(d=>d.filter(x=>EXI[x[0]]).slice(0,12).map(x=>({id:x[0],sets:clamp(+x[1]||3,1,8),r0:clamp(+x[2]||10,1,50),r1:clamp(+x[3]||12,1,60),note:String(x[4]||'').slice(0,160)})))}}catch(e){return null}}
const topMus=e=>Object.entries(e.mus).sort((a,b)=>b[1]-a[1])[0][0];
function syncRx(){
  if(store.rx&&store.rx.days&&store.rx.days.some(d=>d.length)){const r=store.rx;
    PROGRAMS.rx={n:r.n,short:'От специалиста',weeks:r.weeks,per:r.per,lvl:r.by?`назначил: ${r.by}`:'назначено специалистом',desc:r.note||'Индивидуальная программа от врача или реабилитолога.',rx:true,
      days:r.days.filter(d=>d.length).map((d,i)=>({n:`День ${i+1}`,items:d.map(x=>[x.id,topMus(EXI[x.id]),x.sets,[x.r0,x.r1],x.note])}))}}
  else delete PROGRAMS.rx;
}
// заметки специалиста к упражнениям и без автозамен в назначенной программе
const _progItems=progItems;
progItems=function(P,dayIdx,week){
  if(!P.rx)return _progItems(P,dayIdx,week);
  return P.days[dayIdx].items.map(([id,target,sets,reps,note])=>({...planItem(EXI[id],target),reps:[...reps],plan:sets,note,swap:null}));
};
const rxDraft={n:'',by:'',weeks:4,per:3,note:'',days:[[]],day:0,q:''};
try{const d=JSON.parse(localStorage.getItem('rychag.rxdraft')||'null');if(d&&Array.isArray(d.days))Object.assign(rxDraft,d,{q:''})}catch(e){}
const saveDraft=()=>{try{localStorage.setItem('rychag.rxdraft',JSON.stringify(rxDraft))}catch(e){}};
function qrSvg(text){const q=qrcode(0,'L');q.addData(text,'Byte');q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true})}
function showRx(mode){
  mode=mode||showRx.mode||'patient';showRx.mode=mode;
  view().innerHTML=`${backBtn('programs')}<section class="intro"><h1>Программа от специалиста</h1><p>Врач или реабилитолог собирает программу и показывает QR-код. Пациент сканирует его в приложении — программа открывается с подходами, повторами и заметками к каждому упражнению. Всё работает без интернета и без сервера.</p></section>
  <div class="subnav two">${[['patient','Я пациент'],['doc','Я специалист']].map(([k,n])=>`<a href="#rx" data-mode="${k}" class="${mode===k?'on':''}">${n}</a>`).join('')}</div>
  <div id="rxbody"></div>`;
  view().querySelector('.subnav').addEventListener('click',e=>{const a=e.target.closest('[data-mode]');if(!a)return;e.preventDefault();showRx(a.dataset.mode)});
  mode==='doc'?drawRxBuilder():drawRxPatient();
}
function drawRxPatient(){
  const box=$('#rxbody'), r=store.rx, ps=progState();box.onclick=null;box.oninput=null;
  box.innerHTML=`${r?`<section class="pbox prog"><p class="eyebrow">Назначенная программа${r.by?' · '+esc(r.by):''}</p><h2>${esc(r.n)}</h2>${r.note?`<p class="note">${esc(r.note)}</p>`:''}
    <p class="note">${r.weeks} ${plural(r.weeks,'неделя','недели','недель')} · ${r.per} ${plural(r.per,'раз','раза','раз')} в неделю · ${r.days.filter(d=>d.length).length} ${plural(r.days.length,'день','дня','дней')}</p>
    <div class="row2">${ps&&ps.id==='rx'?'<a class="btn sm" href="#programs">Открыть программу</a>':'<button class="btn sm" id="rxgo">Начать программу</button>'}<button class="btn sm ghost" id="rxrep">Отчёт для специалиста</button><button class="link danger" id="rxdel">Удалить</button></div></section>`:''}
  <section class="pbox"><h2 class="sec">Получить программу</h2>
    <label class="btn wide" for="rxcam">📷 Сфотографировать QR-код</label><input type="file" id="rxcam" accept="image/*" capture="environment" hidden>
    <p class="note">Или вставь код, который прислал специалист:</p>
    <textarea id="rxcode" class="ta" rows="3" placeholder="RYCHAG1:…"></textarea><button class="btn sm ghost" id="rxpaste">Открыть код</button></section>
  <div id="rxprev"></div>`;
  const open=t=>{const r2=rxDecode(t);if(!r2){toast('Код не распознан');return}previewRx(r2)};
  $('#rxpaste').addEventListener('click',()=>open($('#rxcode').value));
  $('#rxcam').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;toast('Ищу QR-код…');const t=await readQr(f);if(!t){toast('QR-код не найден — сфотографируй ближе и ровнее');return}open(t)});
  const g=$('#rxgo');if(g)g.addEventListener('click',()=>{store.program={id:'rx',start:Date.now(),done:0};saveSettings();rescheduleReminders();go('programs')});
  const rp=$('#rxrep');if(rp)rp.addEventListener('click',()=>rxReport());
  const dl=$('#rxdel');if(dl)dl.addEventListener('click',()=>{if(!dl.dataset.a){dl.dataset.a=1;dl.textContent='Нажми ещё раз';return}store.rx=null;if(store.program&&store.program.id==='rx')store.program=null;syncRx();saveSettings();drawRxPatient()});
}
async function readQr(file){
  try{const img=await createImageBitmap(file);
    for(const size of [1000,1600,700]){const k=Math.min(1,size/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
      const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height);const r=jsQR(d.data,c.width,c.height,{inversionAttempts:'attemptBoth'});if(r&&r.data)return r.data}
  }catch(e){}
  return null;
}
function previewRx(r){
  $('#rxprev').innerHTML=`<section class="pbox prog"><p class="eyebrow">Новая программа${r.by?' · '+esc(r.by):''}</p><h2>${esc(r.n)}</h2>${r.note?`<p class="note">${esc(r.note)}</p>`:''}
  ${r.days.map((d,i)=>d.length?`<h3 class="dayn">День ${i+1}</h3><div class="plan">${d.map(x=>`<div class="pitem">${icon(x.id)}<div class="rowmain"><b>${esc(EXI[x.id].n)}</b><div class="rowsub">${x.sets} × ${x.r0}–${x.r1}</div>${x.note?`<p class="tip">📋 ${esc(x.note)}</p>`:''}</div></div>`).join('')}</div>`:'').join('')}
  <button class="btn wide" id="rxacc">Сохранить и начать</button></section>`;
  $('#rxacc').addEventListener('click',()=>{store.rx=r;syncRx();store.program={id:'rx',start:Date.now(),done:0};saveSettings();rescheduleReminders();toast('Программа сохранена');go('programs')});
  $('#rxprev').scrollIntoView({behavior:'smooth'});
}
function rxReport(){
  const r=store.rx;if(!r)return;const L=store.log.filter(s=>s.done&&s.prog&&s.prog.id==='rx').sort((a,b)=>a.ts-b.ts);
  const lines=[`Отчёт «Рычаг»: ${r.n}`,r.by?`Специалист: ${r.by}`:'',`Выполнено тренировок: ${L.length} из ${r.weeks*r.per}`,''];
  for(const s of L){lines.push(`${fmtDate(s.ts)}${s.pain!=null?` · боль ${s.pain}/10`:''}`);for(const it of s.items)lines.push(`  ${EXI[it.id]?EXI[it.id].n:it.id}: ${it.sets.map(x=>`${kg(x.w)}×${x.r}${x.rir!=null?` (запас ${x.rir})`:''}`).join(', ')}`)}
  const pains=L.filter(s=>s.pain!=null).map(s=>s.pain);if(pains.length)lines.push('',`Боль: от ${Math.min(...pains)} до ${Math.max(...pains)} из 10, последняя — ${pains[pains.length-1]}`);
  const t=lines.filter((x,i)=>x||lines[i-1]).join('\n');
  $('#rxprev').innerHTML=`<section class="pbox"><h2 class="sec">Отчёт</h2><pre class="rep">${esc(t)}</pre><div class="row2"><button class="btn sm" id="rpcopy">Скопировать</button>${navigator.share?'<button class="btn sm ghost" id="rpshare">Отправить</button>':''}</div></section>`;
  $('#rpcopy').addEventListener('click',()=>copyText(t));const sh=$('#rpshare');if(sh)sh.addEventListener('click',()=>navigator.share({title:'Отчёт «Рычаг»',text:t}).catch(()=>{}));
  $('#rxprev').scrollIntoView({behavior:'smooth'});
}
function drawRxBuilder(){
  const d=rxDraft, box=$('#rxbody'), day=d.days[d.day]||(d.days[d.day]=[]);
  const q=d.q.trim().toLowerCase(), list=q?EX.filter(e=>(e.n+' '+(e.aka||'')).toLowerCase().includes(q)).slice(0,12):[];
  box.innerHTML=`<section class="pbox"><h2 class="sec">Программа</h2>
    <label class="fld"><span>Название</span><input id="rxn" value="${esc(d.n)}" placeholder="Например: колено, 6–12 недель после пластики ПКС"></label>
    <label class="fld"><span>Специалист</span><input id="rxby" value="${esc(d.by)}" placeholder="Фамилия И. О., должность"></label>
    <div class="row2"><label class="fld inl"><span>Недель</span><input id="rxw" type="number" min="1" max="16" value="${d.weeks}"></label><label class="fld inl"><span>Раз в неделю</span><input id="rxp" type="number" min="1" max="6" value="${d.per}"></label></div>
    <label class="fld"><span>Общие указания</span><textarea id="rxnt" class="ta" rows="3" placeholder="Боль во время упражнения — не выше 3/10. При отёке — пропустить день и сообщить.">${esc(d.note)}</textarea></label></section>
  <section class="pbox"><div class="subnav days">${d.days.map((_,i)=>`<a href="#rx" data-day="${i}" class="${i===d.day?'on':''}">День ${i+1}</a>`).join('')}${d.days.length<4?'<a href="#rx" data-day="add">＋</a>':''}</div>
    ${day.length?`<div class="plan">${day.map((x,i)=>`<div class="pitem rxi">${icon(x.id)}<div class="rowmain"><b>${esc(EXI[x.id].n)}</b>
      <div class="rxnums"><label>Подходы <input data-k="sets" data-i="${i}" type="number" min="1" max="8" value="${x.sets}"></label><label>Повторы <input data-k="r0" data-i="${i}" type="number" min="1" max="50" value="${x.r0}">–<input data-k="r1" data-i="${i}" type="number" min="1" max="60" value="${x.r1}"></label></div>
      <input class="rxnote" data-k="note" data-i="${i}" value="${esc(x.note||'')}" placeholder="Заметка: амплитуда, темп, ограничения"></div><button class="ib" data-del="${i}" aria-label="Убрать">✕</button></div>`).join('')}</div>`:'<p class="note">В этом дне пока нет упражнений.</p>'}
    <label class="fld"><span>Добавить упражнение</span><input id="rxq" value="${esc(d.q)}" placeholder="Найти: разгибание, мост, тяга…" autocomplete="off"></label>
    <div class="list">${list.map(e=>`<button class="row rowbtn" data-add="${e.id}">${icon(e.id)}<div class="rowmain"><b>${esc(e.n)}</b><div class="rowsub">${esc(CATS[e.cat]||'')}</div></div><span class="chev">＋</span></button>`).join('')}</div>
    ${d.days.length>1?'<button class="link danger" id="rxdday">Удалить этот день</button>':''}</section>
  <button class="btn wide" id="rxmake">Показать QR-код для пациента</button><button class="link danger" id="rxclr">Очистить</button><div id="rxout"></div>`;
  const keep=()=>{d.n=$('#rxn').value;d.by=$('#rxby').value;d.weeks=clamp(+$('#rxw').value||4,1,16);d.per=clamp(+$('#rxp').value||3,1,6);d.note=$('#rxnt').value;saveDraft()};
  box.querySelectorAll('#rxn,#rxby,#rxw,#rxp,#rxnt').forEach(i=>i.addEventListener('input',keep));
  box.querySelector('.days').addEventListener('click',e=>{const a=e.target.closest('[data-day]');if(!a)return;e.preventDefault();keep();if(a.dataset.day==='add'){d.days.push([]);d.day=d.days.length-1}else d.day=+a.dataset.day;saveDraft();drawRxBuilder()});
  box.oninput=e=>{const t=e.target;if(t.dataset.k&&t.dataset.i!=null){const x=day[+t.dataset.i];x[t.dataset.k]=t.dataset.k==='note'?t.value:+t.value;saveDraft()}};
  let qT=0;$('#rxq').addEventListener('input',e=>{d.q=e.target.value;clearTimeout(qT);qT=setTimeout(()=>{keep();drawRxBuilder();const i=$('#rxq');i.focus();i.setSelectionRange(i.value.length,i.value.length)},250)});
  box.onclick=e=>{const a=e.target.closest('[data-add]'),dl=e.target.closest('[data-del]');
    if(a){keep();const ex=EXI[a.dataset.add],r=repsFor(ex,topMus(ex));day.push({id:ex.id,sets:3,r0:r[0],r1:r[1],note:''});d.q='';saveDraft();drawRxBuilder()}
    if(dl){keep();day.splice(+dl.dataset.del,1);saveDraft();drawRxBuilder()}};
  const dd=$('#rxdday');if(dd)dd.addEventListener('click',()=>{d.days.splice(d.day,1);d.day=0;saveDraft();drawRxBuilder()});
  $('#rxclr').addEventListener('click',e=>{const b=e.target;if(!b.dataset.a){b.dataset.a=1;b.textContent='Нажми ещё раз';return}Object.assign(rxDraft,{n:'',by:'',weeks:4,per:3,note:'',days:[[]],day:0,q:''});saveDraft();drawRxBuilder()});
  $('#rxmake').addEventListener('click',()=>{keep();if(!d.days.some(x=>x.length)){toast('Добавь хотя бы одно упражнение');return}
    const code=rxEncode({...d,n:d.n||'Программа'});
    $('#rxout').innerHTML=`<section class="pbox qrbox"><h2 class="sec">QR-код программы</h2><div class="qrimg">${qrSvg(code)}</div>
    <p class="note">Пациент открывает «Рычаг» → Программы → «От специалиста» → «Сфотографировать QR-код». Код можно и переслать текстом.</p>
    <div class="row2"><button class="btn sm" id="rxcopy">Скопировать код</button><button class="btn sm ghost" id="rxsave">Сохранить картинку</button></div></section>`;
    $('#rxcopy').addEventListener('click',()=>copyText(code));
    $('#rxsave').addEventListener('click',async()=>{const svg=$('#rxout svg').outerHTML,img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();const c=document.createElement('canvas');c.width=c.height=1000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1000,1000);x.drawImage(img,40,40,920,920);await saveOut('rychag-programma.png',c.toDataURL('image/png'),'image/png')});
    $('#rxout').scrollIntoView({behavior:'smooth'})});
}

// ===================== «ЗДОРОВЬЕ»: Health Connect / Apple Health =====================
function healthHtml(){
  const N=NATIVE();if(!N||!N.health||!N.health.ok)return '';
  const on=localStorage.getItem('rychag.health')==='1';
  return `<section class="pbox"><h2 class="sec">${N.health.name}</h2><p class="note">Вес из замеров записывается в ${N.health.name}, а оттуда можно подтянуть последний вес — например, с умных весов.</p>
  <div class="row2"><button class="btn sm${on?' ghost':''}" id="hlon">${on?'Отключить':'Подключить'}</button>${on?'<button class="btn sm ghost" id="hlread">Загрузить вес</button>':''}</div></section>`;
}
function bindHealth(){
  const N=NATIVE();if(!N||!N.health||!N.health.ok||!$('#hlon'))return;
  $('#hlon').addEventListener('click',async()=>{const on=localStorage.getItem('rychag.health')==='1';if(on){localStorage.setItem('rychag.health','0');showProfileTab();return}
    const ok=await N.health.auth().catch(()=>false);if(!ok){toast('Доступ не дан');return}localStorage.setItem('rychag.health','1');toast('Подключено');showProfileTab()});
  const r=$('#hlread');if(r)r.addEventListener('click',async()=>{const w=await N.health.lastWeight().catch(()=>null);if(!w){toast('В «Здоровье» нет записей веса');return}
    store.prof={...store.prof,kg:Math.round(w.kg)};setBody(store.prof);if(!store.body.some(b=>Math.abs(b.ts-w.ts)<6e4))store.body=[{ts:w.ts,kg:Math.round(w.kg*10)/10},...store.body].sort((a,b)=>b.ts-a.ts);saveSettings();toast(`Вес ${kg(Math.round(w.kg*10)/10)} кг от ${fmtDate(w.ts)}`)});
}
function healthWriteWeight(kgv){const N=NATIVE();if(N&&N.health&&N.health.ok&&localStorage.getItem('rychag.health')==='1')N.health.writeWeight(kgv).catch(()=>{})}
