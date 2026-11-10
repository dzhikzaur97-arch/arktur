// ===== Новые разделы: мой зал, нагрузка, программы, голос, прогресс, разминка, тренер, здоровье =====
const MEL_URL=''; // ссылка на «Медицина — это легко», появится карточка, когда будет адрес
const gymSet=()=>store.gym&&store.gym.length>0;
const inGym=id=>!gymSet()||store.gym.includes(id);
const DAY=864e5;
function toast(t){let el=$('#toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';el.setAttribute('role','status');document.body.appendChild(el)}el.textContent=t;el.classList.add('on');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('on'),2600)}
const plural=(n,a,b,c)=>{const m=Math.abs(n)%100,k=m%10;return m>10&&m<20?c:k===1?a:k>=2&&k<=4?b:c};
function subNav(cur){return `<div class="subnav" role="tablist">${[['workout','Тренировка'],['programs','Программы'],['progress','Прогресс']].map(([h,n])=>`<a href="#${h}" role="tab" aria-selected="${cur===h}" class="${cur===h?'on':''}">${n}</a>`).join('')}</div>`}

// ---------- Дополнительные маршруты ----------
function plusRoute(h){
  if(h==='gym'){setNav('machines');showGym();return true}
  if(h==='programs'){setNav('workout');showPrograms();return true}
  if(h.startsWith('prog-')&&PROGRAMS[h.slice(5)]){setNav('workout');showProgram(h.slice(5));return true}
  if(h==='progress'){setNav('workout');showProgress();return true}
  if(h==='health'){setNav('profile');showHealth();return true}
  if(h==='rx'){setNav('workout');showRx();return true}
  if(h.startsWith('health-')&&HEALTH[h.slice(7)]){setNav('profile');showHealthTopic(h.slice(7));return true}
  return false;
}

// ===================== МОЙ ЗАЛ =====================
function showGym(){
  const sel=new Set(store.gym);
  view().innerHTML=`${backBtn('machines')}<section class="intro"><h1>Мой зал</h1><p>Отметь тренажёры, которые есть в твоём зале. План тренировки и программы будут собираться только из них, а остальные получат пометку «нет в зале».</p></section>
  <div class="gymbar"><span id="gcount"></span><button class="link" id="gall">Отметить все</button><button class="link danger" id="gnone">Снять все</button></div>
  ${Object.entries(CATS).map(([k,n])=>`<section class="gcat"><h2 class="sec">${n}</h2><div class="glist">${EX.filter(e=>e.cat===k).map(e=>`<label class="gitem">${icon(e.id)}<span>${esc(e.n)}</span><input type="checkbox" data-id="${e.id}" ${sel.has(e.id)?'checked':''}><i class="gtick" aria-hidden="true"></i></label>`).join('')}</div></section>`).join('')}
  <a class="btn wide" href="#machines">Готово</a>`;
  const upd=()=>{const n=store.gym.length;$('#gcount').textContent=n?`Отмечено ${n} из ${EX.length}`:'Ничего не отмечено — используются все тренажёры'};
  view().addEventListener('change',e=>{const c=e.target.closest('input[data-id]');if(!c)return;const id=c.dataset.id;store.gym=c.checked?[...new Set([...store.gym,id])]:store.gym.filter(x=>x!==id);saveSettings();upd()});
  $('#gall').addEventListener('click',()=>{store.gym=EX.map(e=>e.id);view().querySelectorAll('input[data-id]').forEach(c=>c.checked=true);saveSettings();upd()});
  $('#gnone').addEventListener('click',()=>{store.gym=[];view().querySelectorAll('input[data-id]').forEach(c=>c.checked=false);saveSettings();upd()});
  upd();
}
function gymToggleHtml(ex){if(!gymSet())return `<a class="gymask" href="#gym">Отметить тренажёры моего зала</a>`;const on=store.gym.includes(ex.id);return `<button class="gymtog${on?' on':''}" id="gymtog" aria-pressed="${on}">${on?'✓ Есть в моём зале':'＋ Есть в моём зале?'}</button>`}
function bindGymToggle(ex){const b=$('#gymtog');if(!b)return;b.addEventListener('click',()=>{const on=!store.gym.includes(ex.id);store.gym=on?[...store.gym,ex.id]:store.gym.filter(x=>x!==ex.id);saveSettings();b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);b.textContent=on?'✓ Есть в моём зале':'＋ Есть в моём зале?'})}

// ===================== КАРТА НАГРУЗКИ =====================
function weekLoad(days=7){
  const since=Date.now()-days*DAY, sets={}, last={};
  for(const s of store.log){for(const it of s.items||[]){const e=EXI[it.id];if(!e||!it.sets||!it.sets.length)continue;const n=it.sets.length;
    for(const [m,w] of Object.entries(e.mus)){const k=m===it.target||w===3?1:w===2?.5:0;if(!k)continue;if(s.ts>=since)sets[m]=(sets[m]||0)+n*k;if(k>=1)last[m]=Math.max(last[m]||0,s.ts)}}}
  return {sets,last};
}
const LOADLV=[[0,'нет','#3a3f52'],[5,'мало','#5b8cff'],[10,'средне','#ffbe4d'],[20.01,'оптимально','#3fd99a'],[1e9,'много','#ff4f63']];
function loadLevel(n){if(!n)return LOADLV[0];for(let i=1;i<LOADLV.length;i++)if(n<LOADLV[i][0])return LOADLV[i];return LOADLV[4]}
function bodyMapCustom(fn){
  const fig=(side,label)=>{const els=MAP[side].map(([id,list])=>{const {c,o}=fn(id);const shapes=list.map(([x,y,rx,ry,r])=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${x} ${y})"/>`).join('');
    return `<g class="mz" role="button" tabindex="0" data-m="${id}" aria-label="${MUSCLES[id].n}" style="--c:${c};--o:${o}">${shapes}<title>${MUSCLES[id].n}</title></g>`}).join('');
    return `<figure class="fig"><svg viewBox="0 0 120 248" role="img" aria-label="Нагрузка — ${label}">${silhouette()}${els}</svg><figcaption>${label}</figcaption></figure>`};
  return `<div class="bodymap">${fig('front','спереди')}${fig('back','сзади')}</div>`;
}
function loadViewHtml(){
  const {sets,last}=weekLoad(7), now=Date.now();
  const any=Object.keys(last).length;
  const map=bodyMapCustom(id=>{const n=sets[id]||0,lv=loadLevel(n);return {c:lv[2],o:n?.9:.25}});
  const ids=Object.keys(MUSCLES).filter(id=>sets[id]||last[id]).sort((a,b)=>(sets[b]||0)-(sets[a]||0)||(last[b]||0)-(last[a]||0)), never=Object.keys(MUSCLES).filter(id=>!last[id]);
  const ago=id=>last[id]?Math.floor((now-last[id])/DAY):null;
  const stale=Object.keys(MUSCLES).filter(id=>last[id]&&ago(id)>=7).sort((a,b)=>ago(b)-ago(a));
  const agoTx=d=>d==null?'не тренировал':d===0?'сегодня':d===1?'вчера':`${d} ${plural(d,'день','дня','дней')} назад`;
  return `${map}
  <div class="legend">${LOADLV.slice(1).map(([,n,c],i)=>`<span><i style="background:${c}"></i>${n}${i===0?' <5':i===1?' 5–9':i===2?' 10–20':' >20'}</span>`).join('')}</div>
  <p class="note">Рабочие подходы за 7 дней. Основная мышца упражнения — 1 подход, вспомогательная — ½. Для роста большинству мышц достаточно 10–20 подходов в неделю.</p>
  ${!any?'<p class="empty">Пока нет тренировок в журнале. Запиши первую — и карта оживёт.</p>':''}
  ${stale.length?`<div class="w warn"><span class="wi">${ICON.warn}</span><p><b>Давно не тренировал:</b> ${stale.slice(0,5).map(id=>`<a href="#m-${id}">${MUSCLES[id].n.toLowerCase()}</a> (${agoTx(ago(id))})`).join(', ')}</p></div>`:''}
  ${any?`<div class="ltable">${ids.map(id=>{const n=sets[id]||0,lv=loadLevel(n);return `<a class="lrow" href="#m-${id}"><i style="background:${MUSCLES[id].c}"></i><span class="ln">${MUSCLES[id].n}</span><span class="lb"><b style="width:${Math.min(100,n/25*100)}%;background:${lv[2]}"></b><em style="left:${10/25*100}%"></em><em style="left:${20/25*100}%"></em></span><span class="lv">${kg(n)}</span><span class="la">${agoTx(ago(id))}</span></a>`}).join('')}</div>${never.length?`<p class="note">Ещё не тренировал: ${never.map(id=>`<a href="#m-${id}">${MUSCLES[id].n.toLowerCase()}</a>`).join(', ')}.</p>`:''}`:''}`;
}

// ===================== ПРОГРАММЫ =====================
function progState(){const p=store.program;if(!p||!PROGRAMS[p.id])return null;const P=PROGRAMS[p.id],done=p.done||0,week=Math.floor(done/P.per)+1,day=done%P.days.length;return {P,id:p.id,done,week,day,total:P.weeks*P.per,finished:week>P.weeks}}
function progItems(P,dayIdx,week){
  const out=[],used=new Set();
  for(const [id,target,base,reps] of P.days[dayIdx].items){
    let ex=EXI[id], swap=null;
    const bad=e=>concernOf(e.id,store.concerns).some(c=>c.lv==='avoid')||!inGym(e.id);
    if(!ex||bad(ex)||used.has(ex.id)){const alt=candidates(target).find(e=>!used.has(e.id)&&!bad(e));if(alt){swap=id;ex=alt}else if(!ex)continue}
    used.add(ex.id);
    out.push({...planItem(ex,target),reps:[...reps],plan:progSets(P,week,base),swap});
  }
  return out;
}
function showPrograms(){
  const ps=progState();
  view().innerHTML=`${subNav('programs')}<section class="intro"><h1>Программы</h1><p>Готовые планы на 6–8 недель. Дни идут по кругу сами: заверши тренировку — и откроется следующий день. Тренажёры, которых нет в твоём зале или которые не подходят из-за ограничений, заменяются автоматически.</p></section>
  ${ps?progCard(ps):''}
  <a class="gymlink" href="#rx"><span>🩺</span><div><b>От специалиста</b><small>${store.rx?esc(store.rx.n):'программа от врача или реабилитолога по QR-коду'}</small></div><span class="chev">›</span></a>
  <div class="plist">${Object.entries(PROGRAMS).filter(([k])=>k!=='rx').map(([k,P])=>`<a class="pcard${ps&&ps.id===k?' cur':''}" href="#prog-${k}"><div><b>${esc(P.n)}</b><span>${P.weeks} недель · ${P.per} ${plural(P.per,'тренировка','тренировки','тренировок')} в неделю · ${esc(P.lvl)}</span><p>${esc(P.desc)}</p>${P.medical?`<span class="cb care">с ограничениями: поясница</span>`:''}</div><span class="chev">›</span></a>`).join('')}</div>`;
  bindProgCard();
}
function progCard(ps){
  if(ps.finished)return `<section class="pbox prog"><p class="eyebrow">Текущая программа</p><h2>${esc(ps.P.n)}</h2><p>Программа пройдена — ${ps.total} тренировок. Можно начать её заново с бо́льшими весами или выбрать следующую.</p><div class="row2"><button class="btn sm" id="prestart">Начать заново</button><button class="btn sm ghost" id="pstop">Выйти из программы</button></div></section>`;
  const items=progItems(ps.P,ps.day,ps.week), act=activeSession();
  return `<section class="pbox prog"><p class="eyebrow">Текущая программа · неделя ${ps.week} из ${ps.P.weeks}</p><h2>${esc(ps.P.n)}</h2>
  <div class="pprog"><i style="width:${ps.done/ps.total*100}%"></i></div><p class="note">${ps.done} из ${ps.total} тренировок · ${esc(progNote(ps.P,ps.week))}</p>
  <h3 class="dayn">Следующий: ${esc(ps.P.days[ps.day].n)}</h3>
  <div class="plan">${items.map(it=>{const e=EXI[it.id],sg=suggest(it.id);return `<div class="pitem">${icon(e.id)}<div class="rowmain"><b>${esc(e.n)}</b><div class="rowsub"><i class="dotc" style="--c:${MUSCLES[it.target].c}"></i>${MUSCLES[it.target].n} · ${it.plan} × ${it.reps[0]}–${it.reps[1]}</div>${it.swap?`<p class="tip">Замена для «${esc(EXI[it.swap].n)}»${!inGym(it.swap)?' — нет в зале':' — из-за ограничений'}</p>`:!inGym(it.id)?'<p class="tip">Этого тренажёра нет в твоём зале, и похожего тоже — замени свободным весом или пропусти.</p>':''}${sg?`<p class="tip">${esc(sg.tx)}</p>`:''}</div></div>`}).join('')}</div>
  ${act?'<p class="note">Сейчас уже идёт тренировка — заверши её, чтобы начать день программы.</p><a class="btn wide" href="#workout">К текущей тренировке</a>':'<button class="btn wide" id="pday">Начать этот день</button>'}
  <div class="row2"><button class="link" id="pskip">Пропустить день</button><button class="link danger" id="pstop">Выйти из программы</button></div></section>`;
}
function bindProgCard(){
  const ps=progState(); if(!ps)return;
  const b=$('#pday'); if(b)b.addEventListener('click',()=>{audio();const items=progItems(ps.P,ps.day,ps.week);const s={id:'w'+Date.now().toString(36),ts:Date.now(),items,cur:0,done:false,prog:{id:ps.id,day:ps.day,week:ps.week,n:ps.done}};saveSession(s);say(`Начинаем: ${ps.P.days[ps.day].n}. Сначала разминка.`);go('workout')});
  const sk=$('#pskip'); if(sk)sk.addEventListener('click',()=>{store.program={...store.program,done:(store.program.done||0)+1};saveSettings();route()});
  const sp=$('#pstop'); if(sp)sp.addEventListener('click',()=>{if(sp.dataset.armed){store.program=null;saveSettings();route()}else{sp.dataset.armed='1';sp.textContent='Нажми ещё раз, чтобы выйти'}});
  const rs=$('#prestart'); if(rs)rs.addEventListener('click',()=>{store.program={id:ps.id,start:Date.now(),done:0};saveSettings();route()});
}
function showProgram(k){
  const P=PROGRAMS[k], ps=progState(), cur=ps&&ps.id===k;
  view().innerHTML=`${backBtn('programs')}<section class="intro"><p class="eyebrow">${P.weeks} недель · ${P.per} раза в неделю · ${esc(P.lvl)}</p><h1>${esc(P.n)}</h1><p>${esc(P.desc)}</p></section>
  ${P.medical?`<div class="w warn"><span class="wi">${ICON.warn}</span><p>Программа для периода без обострения. Начинай после разрешения врача и прочитай <a href="#health-${P.medical}">раздел о пояснице</a>.</p></div>`:''}
  <section class="txt"><h2 class="sec">Как растёт нагрузка</h2><ol><li>Неделя 1 — на подход меньше, веса лёгкие: учим технику.</li><li>Недели 2–${P.weeks-1} — рабочие: когда все подходы дошли до верхней границы повторов, вес растёт на один шаг. Подсказку даёт приложение.</li><li>Неделя ${P.weeks} — разгрузка: подходов меньше, веса прежние.</li></ol></section>
  ${P.days.map((d,i)=>`<h2 class="sec mt">${esc(d.n)}</h2><div class="list">${d.items.map(([id,m,sets,r])=>{const e=EXI[id];return `<a class="row" href="#ex-${id}">${icon(id)}<div class="rowmain"><div class="rowtop"><b>${esc(e.n)}</b>${!inGym(id)?'<span class="cb care">нет в зале</span>':''}${concernBadge(e)}</div><div class="rowsub"><i class="dotc" style="--c:${MUSCLES[m].c}"></i>${MUSCLES[m].n} · ${sets} × ${r[0]}–${r[1]}</div></div><span class="chev">›</span></a>`}).join('')}</div>`).join('')}
  ${cur?'<a class="btn wide" href="#programs">Это твоя текущая программа</a>':`<button class="btn wide" id="pgo">${ps&&!ps.finished?'Перейти на эту программу':'Начать программу'}</button>`}`;
  const g=$('#pgo'); if(g)g.addEventListener('click',()=>{store.program={id:k,start:Date.now(),done:0};saveSettings();go('programs')});
}
function programAdvance(s){
  if(!s.prog||!store.program||store.program.id!==s.prog.id)return null;
  if((store.program.done||0)!==s.prog.n)return null;
  store.program={...store.program,done:s.prog.n+1};saveSettings();rescheduleReminders();
  const ps=progState(); return ps;
}

// ===================== ПРОГРЕСС =====================
const e1rm=(w,r)=>r<=1?w:w*(1+Math.min(r,12)/30);
function exStats(){
  const by={};
  for(const s of [...store.log].reverse()){for(const it of s.items||[]){if(!it.sets||!it.sets.length)continue;const b=by[it.id]=by[it.id]||{pts:[],bestW:0,bestE:0,bestTs:0,bestSet:null};
    const top=Math.max(...it.sets.map(x=>x.w)), e=Math.max(...it.sets.map(x=>e1rm(x.w,x.r)));
    b.pts.push({ts:s.ts,w:top,e});if(e>b.bestE){b.bestE=e;b.bestTs=s.ts;b.bestSet=it.sets.reduce((a,x)=>e1rm(x.w,x.r)>e1rm(a.w,a.r)?x:a)}b.bestW=Math.max(b.bestW,top)}}
  return by;
}
function lineChart(series,{h=150,unit='кг'}={}){
  // series: [{name,col,pts:[{x:ts,y}]}]
  const all=series.flatMap(s=>s.pts); if(all.length<2)return '<p class="note">Нужно минимум две записи, чтобы построить график.</p>';
  const W=320,H=h,pl=34,pr=8,pt=10,pb=22;
  let x0=Math.min(...all.map(p=>p.x)),x1=Math.max(...all.map(p=>p.x));if(x1===x0)x1=x0+DAY;
  let y0=Math.min(...all.map(p=>p.y)),y1=Math.max(...all.map(p=>p.y));const pad=(y1-y0)*.15||Math.max(1,y1*.05);y0=Math.max(0,y0-pad);y1+=pad;
  const X=x=>pl+(x-x0)/(x1-x0)*(W-pl-pr),Y=y=>pt+(1-(y-y0)/(y1-y0))*(H-pt-pb);
  const ticks=[y0,(y0+y1)/2,y1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s=>s.name).join(', '))}">
  ${ticks.map(t=>`<line x1="${pl}" x2="${W-pr}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="gl"/><text x="${pl-5}" y="${(Y(t)+3.5).toFixed(1)}" text-anchor="end">${kg(Math.round(t*10)/10)}</text>`).join('')}
  <text x="${pl}" y="${H-5}">${fmtDate(x0)}</text><text x="${W-pr}" y="${H-5}" text-anchor="end">${fmtDate(x1)}</text>
  ${series.map(s=>`<polyline points="${s.pts.map(p=>`${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash?'stroke-dasharray="4 4"':''}/>${s.pts.map(p=>`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="${s.col}"><title>${fmtDate(p.x)}: ${kg(Math.round(p.y*10)/10)} ${unit}</title></circle>`).join('')}`).join('')}
  </svg>${series.length>1?`<div class="legend">${series.map(s=>`<span><i style="background:${s.col}"></i>${esc(s.name)}</span>`).join('')}</div>`:''}`;
}
const BODYF=[['kg','Вес','кг'],['waist','Талия','см'],['chest','Грудь','см'],['hips','Бёдра (обхват таза)','см'],['arm','Рука','см'],['thigh','Бедро','см']];
const prg={ex:null,bm:'kg'};
function showProgress(){
  const by=exStats(), ids=Object.keys(by).filter(id=>EXI[id]).sort((a,b)=>by[b].pts.length-by[a].pts.length);
  if(!prg.ex||!by[prg.ex])prg.ex=ids[0]||null;
  const L=store.log.filter(s=>s.done), now=Date.now();
  const wk=[];for(let i=7;i>=0;i--){const a=now-(i+1)*7*DAY,b=now-i*7*DAY;const ss=L.filter(s=>s.ts>=a&&s.ts<b);wk.push({n:ss.length,vol:ss.reduce((x,s)=>x+s.items.reduce((y,it)=>y+it.sets.reduce((z,q)=>z+q.w*q.r,0),0),0)})}
  const mvol=Math.max(1,...wk.map(x=>x.vol)), m4=L.filter(s=>s.ts>now-28*DAY);
  const prs=ids.map(id=>({id,...by[id]})).sort((a,b)=>b.bestTs-a.bestTs).slice(0,8);
  view().innerHTML=`${subNav('progress')}<section class="intro"><h1>Прогресс</h1><p>Рост весов по каждому тренажёру, расчётный максимум, рекорды и замеры тела.</p></section>
  <div class="kpis"><div><b>${m4.length}</b><span>тренировок<br>за 4 недели</span></div><div><b>${m4.reduce((a,s)=>a+s.items.reduce((b,it)=>b+it.sets.length,0),0)}</b><span>подходов<br>за 4 недели</span></div><div><b>${Math.round(m4.reduce((a,s)=>a+s.items.reduce((b,it)=>b+it.sets.reduce((c,q)=>c+q.w*q.r,0),0),0)/1000*10)/10}</b><span>тонн<br>тоннаж</span></div></div>
  <section class="pbox"><h2 class="sec">Тоннаж по неделям</h2><div class="wbars">${wk.map((x,i)=>`<div title="${Math.round(x.vol)} кг"><i style="height:${Math.max(2,x.vol/mvol*100)}%"></i><span>${i===7?'эта':i===6?'пр.':'−'+(7-i)}</span></div>`).join('')}</div><p class="note">Сумма вес × повторы за неделю.</p></section>
  <section class="pbox"><h2 class="sec">Тренажёр</h2>${ids.length?`<select id="pex" class="sel">${ids.map(id=>`<option value="${id}" ${id===prg.ex?'selected':''}>${esc(EXI[id].n)} · ${by[id].pts.length}</option>`).join('')}</select><div id="exchart"></div>`:'<p class="note">Запиши первые тренировки — здесь появятся графики по каждому тренажёру.</p>'}</section>
  ${prs.length?`<section class="pbox"><h2 class="sec">Рекорды</h2><div class="hrows">${prs.map(p=>`<div class="hrow"><a href="#ex-${p.id}">${esc(EXI[p.id].n)}</a><b>${kg(p.bestSet.w)}×${p.bestSet.r} · ~${kg(Math.round(p.bestE))} кг 1ПМ</b><button class="ib sm" data-prs="${p.id}" aria-label="Поделиться рекордом">↗</button></div>`).join('')}</div><p class="note">1ПМ — расчётный разовый максимум по формуле Эпли: вес × (1 + повторы/30). Это ориентир, а не повод проверять максимум на тренажёре.</p></section>`:''}
  <section class="pbox"><h2 class="sec">Калькулятор 1ПМ</h2><div class="setin"><div class="stepper"><span>Вес, кг</span><div><input id="cw" inputmode="decimal" value="60" aria-label="Вес"></div></div><div class="stepper"><span>Повторы</span><div><input id="cr" inputmode="numeric" value="8" aria-label="Повторы"></div></div></div><div id="cres"></div></section>
  <section class="pbox"><h2 class="sec">Замеры тела</h2>
    <div class="bform">${BODYF.map(([k,n,u])=>`<label><span>${n}, ${u}</span><input data-b="${k}" inputmode="decimal" placeholder="${k==='kg'?kg(store.prof.kg):'—'}"></label>`).join('')}</div>
    <button class="btn wide" id="bsave">Сохранить замер</button>
    <div class="seg sm" id="bmet">${BODYF.map(([k,n])=>`<button data-k="${k}" class="${prg.bm===k?'on':''}">${n.split(' ')[0]}</button>`).join('')}</div>
    <div id="bchart"></div><div id="blist"></div></section>`;
  const drawEx=()=>{const b=by[prg.ex],el=$('#exchart');if(!el||!b)return;el.innerHTML=lineChart([{name:'Расчётный 1ПМ',col:'#ff7a2f',pts:b.pts.map(p=>({x:p.ts,y:p.e}))},{name:'Рабочий вес',col:'#5b8cff',dash:true,pts:b.pts.map(p=>({x:p.ts,y:p.w}))}])+`<p class="note">Лучший результат: ${kg(b.bestSet.w)} кг × ${b.bestSet.r} (${fmtDate(b.bestTs)}), расчётный максимум ~${kg(Math.round(b.bestE))} кг.</p>`};
  view().addEventListener('click',ev=>{const b=ev.target.closest('[data-prs]');if(!b)return;const id=b.dataset.prs,s0=by[id];sharePr({id,target:topMus(EXI[id]),set:s0.bestSet,e:s0.bestE,prev:0},s0.bestTs)});
  const pe=$('#pex'); if(pe)pe.addEventListener('change',e=>{prg.ex=e.target.value;drawEx()}); drawEx();
  const calc=()=>{const w=parseFloat(String($('#cw').value).replace(',','.')),r=parseInt($('#cr').value,10);const el=$('#cres');if(!(w>0)||!(r>0)){el.innerHTML='';return}const m=e1rm(w,r);
    el.innerHTML=`<p class="bigres">~${kg(Math.round(m))} кг<span>расчётный разовый максимум${r>10?' · при больших повторах оценка менее точна':''}</span></p><div class="ptab">${[[95,2],[90,4],[85,6],[80,8],[75,10],[70,12],[65,15],[60,18]].map(([p,n])=>`<span><b>${p}%</b>${kg(Math.round(m*p/100*2)/2)} кг<em>~${n} повт.</em></span>`).join('')}</div>`};
  $('#cw').addEventListener('input',calc);$('#cr').addEventListener('input',calc);calc();
  const drawBody=()=>{const k=prg.bm,f=BODYF.find(x=>x[0]===k),pts=store.body.filter(x=>x[k]>0).map(x=>({x:x.ts,y:x[k]})).sort((a,b)=>a.x-b.x);
    $('#bchart').innerHTML=pts.length?lineChart([{name:f[1],col:'#3fd99a',pts}],{h:130,unit:f[2]}):'<p class="note">Пока нет замеров.</p>';
    $('#blist').innerHTML=store.body.length?`<div class="hrows">${store.body.slice(0,6).map((x,i)=>`<div class="hrow"><span>${fmtDate(x.ts)}</span><b>${BODYF.filter(([k])=>x[k]>0).map(([k,n,u])=>`${n.split(' ')[0].toLowerCase()} ${kg(x[k])}`).join(' · ')}</b><button class="ib" data-bd="${i}" aria-label="Удалить замер">✕</button></div>`).join('')}</div>`:''};
  $('#bmet').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;prg.bm=b.dataset.k;$('#bmet').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));drawBody()});
  $('#blist').addEventListener('click',e=>{const b=e.target.closest('[data-bd]');if(!b)return;store.body.splice(+b.dataset.bd,1);saveSettings();drawBody()});
  $('#bsave').addEventListener('click',()=>{const rec={ts:Date.now()};let n=0;view().querySelectorAll('[data-b]').forEach(i=>{const x=parseFloat(String(i.value).replace(',','.'));if(x>0&&x<400){rec[i.dataset.b]=Math.round(x*10)/10;n++}});
    if(!n){toast('Заполни хотя бы одно поле');return}
    store.body=[rec,...store.body].sort((a,b)=>b.ts-a.ts).slice(0,300);
    if(rec.kg){store.prof={...store.prof,kg:Math.round(rec.kg)};setBody(store.prof);healthWriteWeight(rec.kg)}
    saveSettings();view().querySelectorAll('[data-b]').forEach(i=>i.value='');toast('Замер сохранён'+(rec.kg?' · вес в профиле обновлён':''));drawBody()});
  drawBody();
}

// ===================== ГОЛОС =====================
const V={tts:null,dict:null,web:false,listening:false,onFinal:null,inited:false};
async function initVoice(){
  if(V.inited)return;V.inited=true;
  V.web=typeof window.speechSynthesis!=='undefined'&&typeof SpeechSynthesisUtterance!=='undefined';
  const C=window.claude; if(!C||!C.use)return;
  try{V.tts=await C.use('tts')}catch(e){V.tts=null}
  try{V.dict=await C.use('dictation')}catch(e){V.dict=null}
  if(V.dict){
    V.dict.onPartial(({text})=>{const el=$('#dictx');if(el)el.textContent=text||'Слушаю…'});
    V.dict.onFinal(({text})=>{if(V.onFinal&&text)V.onFinal(text)});
    V.dict.onState(({state})=>{V.listening=state==='listening'||state==='starting';const b=$('#mic');if(b){b.classList.toggle('on',V.listening);b.setAttribute('aria-pressed',V.listening)}const el=$('#dictx');if(el&&!V.listening)el.textContent=''});
  }
  if(location.hash.slice(1)==='workout'&&activeSession())route();
}
const voiceAvail=()=>!!(V.tts||V.web);
const NUMW=['ноль','раз','два','три','четыре','пять','шесть','семь','восемь','девять','десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать','двадцать'];
function webSay(text){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='ru-RU';u.rate=store.voice.rate||1;const vs=speechSynthesis.getVoices().filter(x=>/^ru/i.test(x.lang));if(vs[0])u.voice=vs[0];speechSynthesis.speak(u)}catch(e){}}
function say(text,{force=false,fast=false}={}){
  if(!force&&!store.voice.on)return;
  if(fast&&V.web){webSay(text);return}
  if(V.tts){V.tts.speak(text,{language:'ru',rate:store.voice.rate||1}).catch(e=>{const c=e&&e.code;if(c==='not_granted'){V.tts=null;if(!V.web){store.voice={...store.voice,on:false};saveSettings();toast('Голос выключен в разрешениях страницы')}}});return}
  if(V.web)webSay(text);
}
function voiceRow(){if(!voiceAvail())return '';const v=store.voice;return `<div class="vrow"><button class="vbtn${v.on?' on':''}" id="vtog" aria-pressed="${v.on}">${v.on?'🔊 Голос включён':'🔈 Голосовой тренер'}</button>${v.on?`<button class="vbtn sm${v.count?' on':''}" id="vcnt" aria-pressed="${v.count}">счёт повторов</button>`:''}</div>`}
function bindVoiceRow(after){const t=$('#vtog');if(t)t.addEventListener('click',()=>{store.voice={...store.voice,on:!store.voice.on};saveSettings();if(store.voice.on)say('Голосовой тренер включён. Буду подсказывать подходы и отдых.');else{try{V.tts&&V.tts.stop();V.web&&speechSynthesis.cancel()}catch(e){}}after&&after()});
  const c=$('#vcnt');if(c)c.addEventListener('click',()=>{store.voice={...store.voice,count:!store.voice.count};saveSettings();after&&after()})}
// «сорок два с половиной кило на десять раз» → {w:42.5, r:10}
const NUMS={ноль:0,один:1,одна:1,одну:1,раз:1,два:2,две:2,три:3,четыре:4,пять:5,шесть:6,семь:7,восемь:8,девять:9,десять:10,одиннадцать:11,двенадцать:12,тринадцать:13,четырнадцать:14,пятнадцать:15,шестнадцать:16,семнадцать:17,восемнадцать:18,девятнадцать:19,двадцать:20,тридцать:30,сорок:40,пятьдесят:50,шестьдесят:60,семьдесят:70,восемьдесят:80,девяносто:90,сто:100,двести:200,триста:300,четыреста:400,пятьсот:500,полтора:1.5,полторы:1.5};
function parseSet(text){
  const t=String(text).toLowerCase().replace(/ё/g,'е').replace(/(\d),(\d)/g,'$1.$2').replace(/[^\p{L}\d.\s]/gu,' ');
  const tok=t.split(/\s+/).filter(Boolean), nums=[];
  let cur=null,last=-1;
  const push=()=>{if(cur!=null){nums.push({v:cur,i:last});cur=null}};
  for(let i=0;i<tok.length;i++){const w=tok[i];
    if(/^\d+(\.\d+)?$/.test(w)){push();cur=parseFloat(w);last=i;continue}
    if(w==='половиной'||w==='половина'){if(cur!=null){cur+=.5;last=i}else if(nums.length&&nums[nums.length-1].i>=i-2)nums[nums.length-1].v+=.5;continue}
    if(w==='с'||w==='и')continue;
    const isRaz=w==='раз'&&cur!=null; // «десять раз» — это единица измерения
    if(NUMS[w]!=null&&!isRaz){const n=NUMS[w];if(cur!=null&&last===i-1&&n<cur&&String(Math.round(cur)).endsWith('0'.repeat(String(Math.round(n)).length)))cur+=n;else{push();cur=n}last=i;continue}
    push();nums.push({unit:w,i})}
  push();
  let w=null,r=null;const vals=nums.filter(x=>x.v!=null);
  for(let k=0;k<nums.length;k++){const x=nums[k];if(x.v==null)continue;const nx=nums.find(y=>y.unit&&y.i>x.i&&y.i<=x.i+2);if(!nx)continue;
    if(/^(кг|кило|килограмм|килограммов|килограмма|килограм)/.test(nx.unit))w=x.v;else if(/^(раз|повтор|повторений|повторов|повтора|раза)/.test(nx.unit))r=Math.round(x.v)}
  const rest=vals.filter(x=>x.v!==w&&x.v!==r);
  if(w==null&&rest.length)w=rest.shift().v;
  if(r==null&&rest.length)r=Math.round(rest.shift().v);
  if(w==null&&r==null&&vals.length===1)w=vals[0].v;
  const log=/(запиш|записать|готово|сохрани|выполнен)/.test(t);
  return {w,r,log};
}
function micHtml(){return V.dict&&!V.dictDenied?`<div class="microw"><button class="mic${V.listening?' on':''}" id="mic" aria-pressed="${V.listening}" aria-label="Сказать вес и повторы">🎤</button><span class="dictx" id="dictx"></span><span class="hint">скажи: «сорок кило десять раз, запиши»</span></div>`:''}
function bindMic(apply){
  const b=$('#mic'); if(!b)return;
  V.onFinal=text=>{const p=parseSet(text);if(p.w==null&&p.r==null){toast(`Не понял: «${text}»`);return}apply(p)};
  b.addEventListener('click',()=>{
    if(V.listening){V.dict.stop().catch(()=>{});return}
    V.dict.start().catch(e=>{const c=e&&e.code;if(c==='not_granted'){V.dictDenied=true;const r=b.closest('.microw');r&&r.remove();toast('Микрофон не разрешён — вводи вручную')}else if(c==='busy')toast('Сначала дождись, пока договорит голос');});
  });
}

// ===================== РАЗМИНКА =====================
function renderWarm(s){
  const ms=[...new Set(s.items.map(x=>x.target))], list=warmupFor(ms);
  s.wchk=s.wchk||[];
  view().innerHTML=`<section class="wact"><p class="eyebrow">Перед тренировкой · 5–10 минут</p><h1>Разминка</h1>
  <p class="note">Под сегодняшние мышцы: ${ms.map(m=>MUSCLES[m].n.toLowerCase()).join(', ')}. Отмечай выполненное.</p>
  ${voiceRow()}
  <div class="chk" id="wchk">${list.map((x,i)=>`<button class="ck${s.wchk.includes(i)?' on':''}" data-i="${i}" aria-pressed="${s.wchk.includes(i)}"><i aria-hidden="true"></i><span>${esc(x)}</span></button>`).join('')}</div>
  <div class="w ok"><span class="wi">${ICON.ok}</span><p>${esc(WARM_SETS)}</p></div>
  <button class="btn wide" id="wgo">Разминка сделана — к первому упражнению</button>
  <button class="link" id="wskip">Пропустить разминку</button></section>`;
  $('#wchk').addEventListener('click',e=>{const b=e.target.closest('.ck');if(!b)return;const i=+b.dataset.i,on=!s.wchk.includes(i);s.wchk=on?[...s.wchk,i]:s.wchk.filter(x=>x!==i);b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);if(on&&store.voice.on){const nx=list.find((_,j)=>!s.wchk.includes(j));if(nx)say(nx)}});
  const go1=w=>{s.warm=w;saveSession(s);const it=s.items[0],e=EXI[it.id];say(`Первое упражнение: ${e.n}. ${it.reps[0]}–${it.reps[1]} повторов.`);renderActive(s);window.scrollTo(0,0)};
  $('#wgo').addEventListener('click',()=>go1('done'));$('#wskip').addEventListener('click',()=>go1('skip'));
  bindVoiceRow(()=>renderWarm(s));
  if(store.voice.on&&!s.wsaid){s.wsaid=1;say('Разминка. '+list[0])}
}
function cooldownHtml(s){const ms=[...new Set(s.items.map(x=>x.target))],list=stretchFor(ms);if(!list.length)return '';
  return `<section class="pbox"><h2 class="sec">Заминка · 5 минут</h2><p class="note">3–5 минут спокойной ходьбы, потом растяжка тех мышц, что работали. Тянуть до лёгкого натяжения, без боли, дышать ровно.</p><div class="chk" id="cchk">${list.map(x=>`<button class="ck"><i aria-hidden="true"></i><span>${esc(x)}</span></button>`).join('')}</div></section>`}

// ===================== ТРЕНЕР (чат с Claude) =====================
const chat={msgs:[],busy:false,ac:null,err:'',prefill:''};
try{const c=JSON.parse(localStorage.getItem('rychag.chat')||'null');if(Array.isArray(c))chat.msgs=c.slice(-30)}catch(e){}
function saveChat(){try{localStorage.setItem('rychag.chat',JSON.stringify(chat.msgs.slice(-30)))}catch(e){}}
function coachContext(){
  const p=store.prof, {sets}=weekLoad(7), ps=progState();
  const sess=store.log.filter(s=>s.done).slice(0,6).map(s=>`${fmtDate(s.ts)}: ${s.items.map(it=>`${EXI[it.id]?EXI[it.id].n:it.id} ${it.sets.map(x=>`${kg(x.w)}×${x.r}`).join(',')}`).join('; ')}`);
  const load=Object.entries(sets).sort((a,b)=>b[1]-a[1]).map(([m,n])=>`${MUSCLES[m].n} ${kg(n)}`).join(', ');
  const ex=chat.exId&&EXI[chat.exId];
  return [`Пользователь: ${p.sex==='f'?'женщина':'мужчина'}, рост ${p.h} см, вес ${p.kg} кг${p.femur>.3?', длинные бёдра':p.femur<-.3?', короткие бёдра':''}.`,
    `Что беспокоит: ${store.concerns.length?store.concerns.map(k=>CONCERNS[k].n).join(', '):'ничего не отмечено'}.`,
    `Тренажёры в зале: ${gymSet()?store.gym.map(id=>EXI[id]&&EXI[id].n).filter(Boolean).join(', '):'не отмечены — считай, что есть все из списка приложения'}.`,
    `Программа: ${ps?`${ps.P.n}, неделя ${ps.week} из ${ps.P.weeks}, выполнено ${ps.done} тренировок`:'не выбрана'}.`,
    `Подходы за 7 дней по мышцам: ${load||'нет данных'}.`,
    `Последние тренировки:\n${sess.join('\n')||'журнал пуст'}`,
    ex?`Сейчас открыт тренажёр: ${ex.n}.`:''].filter(Boolean).join('\n');
}
const COACH_SYS=`Ты — тренер в приложении «Рычаг» (гид по тренажёрам с биомеханическими 2D-моделями). Отвечай по-русски, дружелюбно и по делу, обычно 80–200 слов. Давай конкретику: тренажёр, настройка, подходы × повторы, темп, на что обратить внимание. Предлагай тренажёры из списка зала пользователя и учитывай, что его беспокоит. Названия тренажёров приложения: ${EX.map(e=>e.n).join(', ')}.
Медицинские вопросы: давай общие принципы безопасной тренировки и признаки, при которых нужно к врачу; не ставь диагнозы, не назначай лекарства и дозировки. При острой боли, травме, боли в груди, онемении — сначала к врачу.
Форматирование: короткие абзацы, списки строками с «- », важное **жирным**. Без таблиц и заголовков.`;
function mdLite(t){return esc(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').split(/\n{2,}/).map(par=>{const lines=par.split('\n');if(lines.every(l=>/^\s*([-•*]|\d+[.)])\s+/.test(l)))return `<ul>${lines.map(l=>`<li>${l.replace(/^\s*([-•*]|\d+[.)])\s+/,'')}</li>`).join('')}</ul>`;return `<p>${lines.map(l=>/^\s*[-•*]\s+/.test(l)?'• '+l.replace(/^\s*[-•*]\s+/,''):l).join('<br>')}</p>`}).join('')}
const QUICK=['Составь тренировку на сегодня с учётом моей недели','Какие мышцы я недогружаю?','Почему мой вес в упражнениях не растёт?','Чем заменить присед, если болит спина?','Как настроить жим ногами под ягодицы?'];
function showCoachTab(){
  setNav('coach');
  view().innerHTML=`<section class="intro"><h1>Спросить тренера</h1><p>Отвечает Claude и видит твой профиль, ограничения, зал, программу и последние тренировки. Это ИИ, а не врач: при боли и травмах — к специалисту.</p></section>
  <div class="chat" id="chat"></div>
  <div class="quick" id="quick">${QUICK.map(q=>`<button class="pbtn">${esc(q)}</button>`).join('')}</div>
  <form class="chatin" id="chatf"><textarea id="chatq" rows="2" placeholder="Спроси про технику, план, замену тренажёра…" aria-label="Вопрос тренеру">${esc(chat.prefill)}</textarea><button class="btn" id="chats" type="submit">Спросить</button></form>
  ${chat.msgs.length?'<button class="link" id="chatclr">Очистить переписку</button>':''}`;
  chat.prefill='';
  drawChat();
  $('#chatf').addEventListener('submit',e=>{e.preventDefault();if(chat.busy){chat.ac&&chat.ac.abort();return}const q=$('#chatq').value.trim();if(q)askCoach(q)});
  $('#chatq').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chatf').requestSubmit()}});
  $('#quick').addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!chat.busy)askCoach(b.textContent)});
  const c=$('#chatclr');if(c)c.addEventListener('click',()=>{chat.msgs=[];saveChat();showCoachTab()});
}
function drawChat(){
  const el=$('#chat');if(!el)return;
  el.innerHTML=chat.msgs.length?chat.msgs.map((m,i)=>`<div class="msg ${m.role==='user'?'me':'ai'}">${m.role==='user'?esc(m.content).replace(/\n/g,'<br>'):mdLite(m.content)||'<span class="typing">Думаю…</span>'}${m.role!=='user'&&m.content&&voiceAvail()&&!(chat.busy&&i===chat.msgs.length-1)?`<button class="ib sm" data-say="${i}" aria-label="Прочитать вслух">🔊</button>`:''}</div>`).join(''):'<p class="note">Задай вопрос или выбери подсказку ниже.</p>';
  if(chat.err)el.insertAdjacentHTML('beforeend',`<div class="w warn"><span class="wi">${ICON.warn}</span><p>${esc(chat.err)}</p></div>`);
  const s=$('#chats');if(s)s.textContent=chat.busy?'Стоп':'Спросить';
  const q=$('#quick');if(q)q.hidden=chat.busy||chat.msgs.length>2;
  el.onclick=e=>{const b=e.target.closest('[data-say]');if(!b)return;say(chat.msgs[+b.dataset.say].content.replace(/\*\*/g,'').slice(0,1900),{force:true})};
}
async function askCoach(q){
  chat.err='';
  const sample=await getSample();
  if(!sample){chat.err=IS_APP?'Тренер не подключён: в настройках сборки не указан адрес сервера (см. инструкцию).':'Тренер недоступен в этом просмотре: открой приложение в claude.ai, войдя в аккаунт.';drawChat();return}
  chat.msgs.push({role:'user',content:q});const ans={role:'assistant',content:''};chat.msgs.push(ans);chat.busy=true;
  $('#chatq').value='';drawChat();window.scrollTo(0,document.body.scrollHeight);
  let hist=chat.msgs.slice(0,-1).slice(-12); while(hist.length&&hist[0].role!=='user')hist.shift();
  const msgs=hist.map((m,i)=>({role:m.role,content:i===0?`${COACH_SYS}\n\nКонтекст пользователя (из приложения):\n${coachContext()}\n\nВопрос: ${m.content}`:m.content}));
  chat.ac=new AbortController();let t=0;
  try{
    const r=await sample(msgs,{cache:false,signal:chat.ac.signal,onText:({text})=>{ans.content=text;const n=performance.now();if(n-t>80){t=n;drawChat()}}});
    ans.content=r.text||ans.content;
  }catch(e){
    const c=e&&e.code; if(e&&e.text)ans.content=e.text;
    if(c==='aborted'||e.name==='AbortError'){if(!ans.content)ans.content='(остановлено)'}
    else{chat.err=c==='no_key'?'Добавь ключ Claude API: Профиль → «Тренер и фото».':c==='bad_key'?'Ключ Claude API не подошёл — проверь его в Профиле.':c==='network'?'Нет интернета — тренеру нужна связь.':c==='not_granted'?'Доступ к ответам Claude не разрешён для этой страницы.':c==='rate_limited'?'Слишком много вопросов подряд — подожди минуту.':'Не получилось получить ответ. Попробуй ещё раз.';if(!ans.content)chat.msgs.pop()}
  }
  chat.busy=false;chat.ac=null;saveChat();drawChat();
}

// ===================== ЗДОРОВЬЕ =====================
function showHealth(){
  view().innerHTML=`${backBtn('profile')}<section class="intro"><h1>Тренировки и здоровье</h1><p>Что можно, что нельзя и когда к врачу — при частых проблемах и состояниях. Это общие рекомендации по международным руководствам, они не заменяют осмотр врача.</p></section>
  <div class="plist">${Object.entries(HEALTH).map(([k,h])=>`<a class="pcard" href="#health-${k}"><span class="hico" aria-hidden="true">${h.ico}</span><div><b>${esc(h.n)}</b><p>${esc(h.lead.split('. ')[0])}.</p>${h.concern&&store.concerns.includes(h.concern)?'<span class="cb care">фильтр включён</span>':''}</div><span class="chev">›</span></a>`).join('')}</div>
  ${MEL_URL?`<a class="src" href="${MEL_URL}" target="_blank" rel="noopener"><b>«Медицина — это легко»</b><span>Подробно о заболеваниях и лечении</span></a>`:''}`;
}
function showHealthTopic(k){
  const h=HEALTH[k], on=h.concern&&store.concerns.includes(h.concern);
  const li=a=>`<ul>${a.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  view().innerHTML=`${backBtn('health')}<section class="intro"><p class="eyebrow">Тренировки и здоровье</p><h1>${h.ico} ${esc(h.n)}</h1><p>${esc(h.lead)}</p></section>
  <div class="w bad"><span class="wi">${SKULL}</span><div><p><b>Когда сразу к врачу</b></p>${li(h.red)}</div></div>
  <section class="hsec hs-ok"><h2 class="sec">Можно и полезно</h2>${li(h.ok)}</section>
  <section class="hsec hs-care"><h2 class="sec">Осторожно</h2>${li(h.care)}</section>
  <section class="hsec hs-no"><h2 class="sec">Лучше не делать</h2>${li(h.no)}</section>
  <section class="hsec"><h2 class="sec">Правила</h2>${li(h.rules)}</section>
  ${h.concern?`<section class="pbox"><h2 class="sec">В приложении</h2><p class="note">${on?'Фильтр включён: опасные тренажёры помечены «замени», план и программы подбирают замены.':'Включи фильтр — приложение пометит неподходящие тренажёры и будет заменять их в плане.'}</p><button class="btn sm${on?' ghost':''}" id="hconc">${on?'Выключить фильтр':'Включить фильтр «'+CONCERNS[h.concern].n+'»'}</button>${h.prog?` <a class="btn sm ghost" href="#prog-${h.prog}">Программа «${esc(PROGRAMS[h.prog].short)}»</a>`:''}</section>`:''}
  <section class="txt"><h2 class="sec">Источники</h2><div class="srcs">${h.src.map(([t,u])=>`<a class="src" href="${u}" target="_blank" rel="noopener"><b>${esc(t)}</b><small>${u.includes('pubmed')?'PubMed ↗':'↗'}</small></a>`).join('')}</div></section>
  <button class="btn ghost wide" id="hask">Спросить тренера про это</button>
  <p class="note">Не заменяет консультацию врача. Если есть сомнения — покажи этот список своему врачу или реабилитологу.</p>`;
  const b=$('#hconc');if(b)b.addEventListener('click',()=>{const c=h.concern;store.concerns=store.concerns.includes(c)?store.concerns.filter(x=>x!==c):[...store.concerns,c];saveSettings();renderTopConcerns();showHealthTopic(k)});
  $('#hask').addEventListener('click',()=>{chat.prefill=`${h.n}: как мне тренироваться безопасно?`;go('coach')});
}
