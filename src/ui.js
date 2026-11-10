// ===================== UI =====================
const $=s=>document.querySelector(s);
const IS_APP=!!window.RYCHAG_APP, HERE=IS_APP?'на этом телефоне':'в этом браузере';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=x=>Math.round(x*100)+'%';
const EXI=Object.fromEntries(EX.map(e=>[e.id,e]));
const st={ex:null,target:null,p:{},t:0,playing:true,tempo:[2,0,2],reps:0,clock:0,last:0,sw:null,bounds:null,pending:null,cat:'all',q:'',drag:null,raf:0,dirty:true,cv:null,ctx:null,layer:null,W:0,H:0,best:{},fs:false};
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const isFav=id=>store.favs.includes(id);
const fmtDate=ts=>new Date(ts).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const kg=x=>(Math.round(x*10)/10).toString().replace('.',',');

const SKULL='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2C7.6 2 4 5.3 4 9.6c0 2.4 1.1 4.4 2.8 5.7V18c0 .6.4 1 1 1h1.4v1.3c0 .4.3.7.7.7h.6c.4 0 .7-.3.7-.7V19h1.6v1.3c0 .4.3.7.7.7h.6c.4 0 .7-.3.7-.7V19h1.4c.6 0 1-.4 1-1v-2.7c1.7-1.3 2.8-3.3 2.8-5.7C20 5.3 16.4 2 12 2zm-3.2 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6.4 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM12 13.2l1.1 2.3h-2.2l1.1-2.3z"/></svg>';
const ICON={ok:'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.2 4.2L19 7"/></svg>',
 warn:'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3 2 21h20L12 3zm-1 6h2v6h-2V9zm0 8h2v2h-2v-2z"/></svg>', bad:SKULL,
 star:on=>`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="${on?'currentColor':'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
 full:'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
 cam:'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'};

// ---------- Звук и вибрация ----------
let AC=null;
function audio(){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume()}catch(e){AC=null}return AC}
function beep(f=880,d=.12,vol=.25){const a=audio();if(!a)return;try{const o=a.createOscillator(),g=a.createGain();o.frequency.value=f;o.type='sine';g.gain.setValueAtTime(vol,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+d);o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+d+.02)}catch(e){}}
function buzz(p){try{navigator.vibrate&&navigator.vibrate(p)}catch(e){}}
let wakeLock=null;
async function keepAwake(on){try{if(on&&!wakeLock&&navigator.wakeLock){wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>wakeLock=null)}else if(!on&&wakeLock){await wakeLock.release();wakeLock=null}}catch(e){wakeLock=null}}

// ---------- Карта тела ----------
const MAP={
 front:[['frontdelt',[[36,52,7,8,0],[84,52,7,8,0]]],['chest',[[49,63,11,8,0],[71,63,11,8,0]]],['biceps',[[30,80,5,11,12],[90,80,5,11,-12]]],['forearms',[[25,106,4.5,13,10],[95,106,4.5,13,-10]]],['abs',[[60,93,8,18,0]]],['obliques',[[46,98,4.5,12,-6],[74,98,4.5,12,6]]],['quads',[[49,153,8.5,24,3],[71,153,8.5,24,-3]]],['adductors',[[56.5,139,3.3,13,-6],[63.5,139,3.3,13,6]]],['calves',[[48,207,4.5,13,0],[72,207,4.5,13,0]]]],
 back:[['traps',[[60,42,15,6,0]]],['reardelt',[[37,52,6,7,0],[83,52,6,7,0]]],['middelt',[[29.5,55,4,8,0],[90.5,55,4,8,0]]],['upperback',[[60,60,11,9,0]]],['lats',[[47,81,8,15,8],[73,81,8,15,-8]]],['triceps',[[30,79,5,12,10],[90,79,5,12,-10]]],['forearms',[[25,106,4.5,13,10],[95,106,4.5,13,-10]]],['erectors',[[55.5,100,3.5,13,0],[64.5,100,3.5,13,0]]],['gmed',[[44,116,5,5,0],[76,116,5,5,0]]],['glutes',[[51,127,9.5,10,0],[69,127,9.5,10,0]]],['hams',[[50,163,8,22,2],[70,163,8,22,-2]]],['calves',[[49,201,5.5,13,0],[71,201,5.5,13,0]]],['soleus',[[49,222,4.5,7,0],[71,222,4.5,7,0]]]]
};
function silhouette(){return `<g class="sil"><circle cx="60" cy="18" r="11"/><rect x="55" y="27" width="10" height="10" rx="3"/><rect x="37" y="38" width="46" height="84" rx="14"/><rect x="40" y="110" width="40" height="28" rx="10"/>
<rect x="24" y="43" width="12" height="44" rx="6" transform="rotate(8 30 45)"/><rect x="84" y="43" width="12" height="44" rx="6" transform="rotate(-8 90 45)"/>
<rect x="19" y="86" width="11" height="40" rx="5" transform="rotate(8 25 88)"/><rect x="90" y="86" width="11" height="40" rx="5" transform="rotate(-8 95 88)"/>
<rect x="40" y="128" width="19" height="62" rx="9"/><rect x="61" y="128" width="19" height="62" rx="9"/><rect x="42" y="186" width="15" height="54" rx="7"/><rect x="63" y="186" width="15" height="54" rx="7"/></g>`}
function bodyMap(hi,clickable){
  const fig=(side,label)=>{
    const els=MAP[side].map(([id,list])=>{
      const w=hi?(hi[id]||0):2, op=hi?[.07,.38,.62,.95][w]:.6, c=w||!hi?MUSCLES[id].c:'#8c92a8';
      const shapes=list.map(([x,y,rx,ry,r])=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${x} ${y})"/>`).join('');
      const attrs=clickable?` class="mz" role="button" tabindex="0" data-m="${id}" aria-label="${MUSCLES[id].n}"`:' class="mz static"';
      return `<g${attrs} style="--c:${c};--o:${op}">${shapes}<title>${MUSCLES[id].n}</title></g>`;
    }).join('');
    return `<figure class="fig"><svg viewBox="0 0 120 248" role="img" aria-label="Мышцы — ${label}">${silhouette()}${els}</svg><figcaption>${label}</figcaption></figure>`;
  };
  return `<div class="bodymap">${fig('front','спереди')}${fig('back','сзади')}</div>`;
}

// ---------- Маршрутизация ----------
const TABS=['muscles','machines','workout','coach','profile'];
function go(h){location.hash=h}
function route(){
  stopAnim();
  let h=location.hash.slice(1)||store.tab||'muscles';
  if(h==='how')h='profile';
  if(!store.prof.set&&!h.startsWith('ex-')){setNav(null);showOnboarding();window.scrollTo(0,0);return}
  if(h.startsWith('ex-')&&EXI[h.slice(3)])showEx(EXI[h.slice(3)]);
  else if(h.startsWith('m-')&&MUSCLES[h.slice(2)])showMuscle(h.slice(2));
  else if(plusRoute(h)){}
  else{const t=TABS.includes(h)?h:'muscles';setTab(t);showTab(t)}
  renderTopConcerns();
  window.scrollTo(0,0);
}
function setNav(tab){document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('on',a.dataset.tab===tab))}
const view=()=>$('#view');
function backBtn(fallback){return `<button class="back" onclick="history.length>1?history.back():go('${fallback}')">‹ Назад</button>`}
function renderTopConcerns(){const el=$('#topc');if(!el)return;el.innerHTML=store.concerns.length?`<a href="#profile" class="tconc" title="Что беспокоит">${ICON.warn}${store.concerns.map(k=>CONCERNS[k].short).join(', ')}</a>`:''}

// ---------- Строка тренажёра ----------
function concernBadge(e){const c=concernOf(e.id,store.concerns);if(!c.length)return '';const bad=c.find(x=>x.lv==='avoid');const x=bad||c[0];return `<span class="cb ${x.lv}">${x.lv==='avoid'?'замени':'осторожно'}: ${CONCERNS[x.k].short}</span>`}
function exRow(e,m){
  const mus=Object.entries(e.mus).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id,w])=>`<i style="--c:${MUSCLES[id].c};opacity:${w===3?1:.55}" title="${MUSCLES[id].n}"></i>`).join('');
  const role=m?`<span class="role r${e.mus[m]}">${e.mus[m]===3?'основная':e.mus[m]===2?'сильно участвует':'помогает'}</span>`:'';
  const tip=m&&e.focus&&e.focus[m]?`<p class="tip">${esc(e.focus[m])}</p>`:'';
  return `<a class="row" href="#ex-${e.id}"${m?` data-t="${m}"`:''}>${icon(e.id)}<div class="rowmain"><div class="rowtop"><b>${esc(e.n)}</b>${isFav(e.id)?'<span class="favdot" title="В избранном">★</span>':''}${e.sim?'<span class="simtag">модель</span>':''}${gymSet()&&!inGym(e.id)?'<span class="cb nog">нет в зале</span>':''}${concernBadge(e)}</div><div class="rowsub"><span class="dots">${mus}</span>${esc(e.eq)}${role}</div>${tip}</div><span class="chev" aria-hidden="true">›</span></a>`;
}

// ---------- Вкладки ----------
function showTab(tab){
  setNav(tab);
  if(tab==='muscles')showMusclesTab();
  if(tab==='machines')showMachinesTab();
  if(tab==='workout')showWorkoutTab();
  if(tab==='profile')showProfileTab();
  if(tab==='coach')showCoachTab();
}
function showMusclesTab(){
  const groups={};for(const id in MUSCLES)(groups[MUSCLES[id].g]=groups[MUSCLES[id].g]||[]).push(id);
  const count=id=>EX.filter(e=>(e.mus[id]||0)>=2).length;
  const favs=store.favs.map(id=>EXI[id]).filter(Boolean);
  view().innerHTML=`<section class="intro"><h1>Что сегодня качаешь?</h1><p>Нажми на мышцу — покажу тренажёры, которые её нагружают, и как настроить их именно под неё.${HAS3D?' Фигуру можно вращать пальцем.':''}</p></section>
  ${HAS3D?`<div class="seg sm viewsw" id="hview"><button data-v="2d" class="${ATL.view!=='3d'?'on':''}">2D — мышцы</button><button data-v="3d" class="${ATL.view==='3d'?'on':''}">3D — человек</button></div>`:''}
  <div class="seg sm viewsw" id="mview"><button data-v="pick" class="${st.mview!=='load'?'on':''}">Выбрать мышцу</button><button data-v="load" class="${st.mview==='load'?'on':''}">Нагрузка за неделю</button></div>
  <div id="hmap">${st.mview==='load'?loadViewHtml():bodyMap(null,true)}</div>
  <div class="groups">${Object.entries(groups).map(([g,ids])=>`<div class="grp"><h3>${g}</h3><div class="chips">${ids.map(id=>`<a class="mchip" href="#m-${id}" style="--c:${MUSCLES[id].c}"><i></i>${MUSCLES[id].n}<span>${count(id)}</span></a>`).join('')}</div></div>`).join('')}</div>
  ${favs.length?`<h2 class="sec mt">Избранное</h2><div class="list">${favs.map(e=>exRow(e)).join('')}</div>`:''}`;
  view().querySelectorAll('.mz').forEach(el=>{const f=()=>go('m-'+el.dataset.m);el.addEventListener('click',f);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f()}})});
  $('#mview').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;st.mview=b.dataset.v;showMusclesTab()});
  const bindMap=()=>view().querySelectorAll('.mz').forEach(el=>{const f=()=>go('m-'+el.dataset.m);el.addEventListener('click',f);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f()}})});
  if(HAS3D){
    if(ATL.view==='3d')initHomeAtlas();
    $('#hview').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.classList.contains('on'))return;ATL.view=b.dataset.v;saveAtl();$('#hview').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
      disposeAtlases();$('#hmap').innerHTML=ATL.view==='3d'?homeAtlasHtml():bodyMap(null,true);if(ATL.view==='3d')initHomeAtlas();else bindMap()});
  }
}
const home3={viewer:null,fig:null,raf:0,hover:null,ro:null};
function initHome3D(){
  const host=$('#map3'); if(!host)return;
  let viewer;
  try{viewer=makeViewer(host,{yaw:.35,pitch:.06,dist:4.4,
    pick:e=>{const o=viewer.pickAt(e,home3.fig.pickables);if(o){const id=o.userData.id;home3.hover=id;showLabel(id,true);setTimeout(()=>go('m-'+id),260)}},
    hover:e=>{if(e.pointerType!=='mouse')return;const o=viewer.pickAt(e,home3.fig.pickables);const id=o?o.userData.id:null;if(id!==home3.hover){home3.hover=id;showLabel(id);viewer.renderer.domElement.style.cursor=id?'pointer':'grab'}}})}catch(err){host.outerHTML=bodyMap(null,true);return}
  home3.viewer=viewer; home3.fig=makeFigure(viewer.scene,store.prof);
  const pose=standPose(store.prof); viewer.S.target=V3(0,pose.N.y*.53,0); viewer.S.dist=pose.N.y*2.75; viewer.S.minD=1.4; viewer.S.maxD=7;
  home3.fig.update(pose);
  home3.ro=new ResizeObserver(()=>viewer.resize()); home3.ro.observe(host);
  const vb=$('#vbtns')||$('#vbtns2'); if(vb&&!vb.children.length)vb.innerHTML='<button data-v="0">Спереди</button><button data-v="1.5708">Сбоку</button><button data-v="3.1416">Сзади</button><button data-v="auto">Вращать</button>';
  vb.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.v==='auto'){viewer.S.auto=!viewer.S.auto;b.classList.toggle('on',viewer.S.auto);return}viewer.S.auto=false;vb.querySelector('[data-v="auto"]').classList.remove('on');const tgt=+b.dataset.v;const y0=viewer.S.yaw;const d=((tgt-y0)%(2*Math.PI)+3*Math.PI)%(2*Math.PI)-Math.PI;const t0=performance.now();const an=n=>{const k=ease(clamp((n-t0)/500,0,1));viewer.S.yaw=y0+d*k;if(k<1)requestAnimationFrame(an)};requestAnimationFrame(an)});
  const loop3=()=>{if(!home3.viewer)return;const hv=home3.hover;home3.fig.setGlow(id=>id===hv?{e:1.9,dim:false,h:.5}:{e:hv?.3:.5,dim:false,h:hv?.02:.06});viewer.render();home3.raf=requestAnimationFrame(loop3)};
  loop3();
}
function showLabel(id,tap){const l=$('#mlabel');if(!l)return;if(!id){l.classList.remove('on');return}l.innerHTML=`<i style="background:${MUSCLES[id].c}"></i>${MUSCLES[id].n}${tap?' →':''}`;l.classList.add('on')}

// ---------- Знакомство ----------
function profileFields(){
  const p=store.prof, f=p.sex==='f';
  return `<div class="param"><div class="plabel"><span>Пол</span></div><div class="seg" id="psex"><button data-v="m" class="${!f?'on':''}">Мужской</button><button data-v="f" class="${f?'on':''}">Женский</button></div></div>
    <div class="param"><label class="plabel" for="ph1"><span>Рост</span><output id="oh">${p.h} см</output></label><input type="range" id="ph1" min="145" max="210" step="1" value="${p.h}"></div>
    <div class="param"><label class="plabel" for="pk1"><span>Вес</span><output id="ok">${p.kg} кг</output></label><input type="range" id="pk1" min="40" max="160" step="1" value="${p.kg}"></div>
    <div class="param"><label class="plabel" for="pf1"><span>Длина бедра относительно голени</span><output id="of">${femurTxt(p.femur||0)}</output></label><input type="range" id="pf1" min="-1" max="1" step=".1" value="${p.femur||0}"></div>`;
}
function bindProfileFields(onChange){
  const upd=patch=>{store.prof={...store.prof,...patch};setBody(store.prof);saveSettings();onChange&&onChange()};
  $('#psex').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const sex=b.dataset.v;$('#psex').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
    const patch={sex};if(!store.prof.set||store.prof.auto){patch.h=sex==='f'?165:178;patch.kg=sex==='f'?62:78;$('#ph1').value=patch.h;$('#oh').textContent=patch.h+' см';$('#pk1').value=patch.kg;$('#ok').textContent=patch.kg+' кг'}upd(patch)});
  $('#ph1').addEventListener('input',e=>{$('#oh').textContent=e.target.value+' см';upd({h:+e.target.value,auto:false})});
  $('#pk1').addEventListener('input',e=>{$('#ok').textContent=e.target.value+' кг';upd({kg:+e.target.value,auto:false})});
  $('#pf1').addEventListener('input',e=>{$('#of').textContent=femurTxt(+e.target.value);upd({femur:+e.target.value})});
}
function showOnboarding(){
  if(!store.prof.sex)store.prof={...store.prof,sex:'m',h:store.prof.h||178,kg:store.prof.kg||78,auto:true};
  view().innerHTML=`<section class="onb"><div class="onbhead"><svg width="44" height="44" viewBox="0 0 26 26" aria-hidden="true"><line x1="3" y1="19" x2="23" y2="9" stroke="#eef0f6" stroke-width="2.4" stroke-linecap="round"/><path d="M10 21l3-6 3 6z" fill="#ff7a2f"/><circle cx="23" cy="9" r="2.6" fill="#ff47b5"/></svg>
    <h1>Расскажи о себе</h1><p>Пол, рост и вес задают фигуру и рычаги в моделях — так техника подстроится под твоё тело. Изменить можно в профиле.</p></div>
    ${HAS3D?'<div class="onb3 amini" id="onb3"></div>':''}
    <section class="pbox">${profileFields()}</section>
    <button class="btn wide" id="onbgo">Готово</button><button class="link" id="onbskip">Пропустить</button></section>`;
  let A=null;
  let lastSex=store.prof.sex,tm=0;
  const rebuild=()=>{if(!A||!A.anat)return;clearTimeout(tm);tm=setTimeout(()=>{A.rebuild()},lastSex!==store.prof.sex?0:250);lastSex=store.prof.sex};
  if(HAS3D)A=mountAtlas($('#onb3'),{mini:true});
  bindProfileFields(rebuild);
  const done=()=>{store.prof={...store.prof,set:true};saveSettings();route()};
  $('#onbgo').addEventListener('click',done);$('#onbskip').addEventListener('click',done);
}
function showMachinesTab(){
  const nSim=EX.filter(e=>e.sim).length;
  view().innerHTML=`<section class="intro"><h1>Тренажёры</h1><p>${EX.length} тренажёров и станций зала, у ${nSim} есть интерактивная модель <b class="simtag">модель</b>.</p></section>
  <a class="gymlink" href="#gym"><span>🏠</span><div><b>Мой зал</b><small>${gymSet()?`отмечено ${store.gym.length} — план собирается из них`:'отметь тренажёры своего зала'}</small></div><span class="chev">›</span></a>
  <div id="photo"></div>
  <label class="search"><span class="sr">Поиск</span><input id="q" type="search" placeholder="Найти: жим, тяга, ягодицы…" value="${esc(st.q)}" autocomplete="off"></label>
  <div class="cats" id="cats">${[['all','Все'],...(gymSet()?[['gym','Мой зал']]:[]),['fav','★ Избранное'],...Object.entries(CATS)].map(([k,n])=>`<button class="cat${st.cat===k?' on':''}" data-c="${k}">${n}</button>`).join('')}</div>
  <div id="list" class="list"></div>`;
  const draw=()=>{
    const q=st.q.trim().toLowerCase();
    const items=EX.filter(e=>(st.cat==='all'||(st.cat==='fav'?isFav(e.id):st.cat==='gym'?inGym(e.id):e.cat===st.cat))&&(!q||(e.n+' '+e.aka+' '+Object.keys(e.mus).map(m=>MUSCLES[m].n).join(' ')).toLowerCase().includes(q)));
    $('#list').innerHTML=items.length?items.map(e=>exRow(e)).join(''):`<p class="empty">${st.cat==='fav'?'Пока пусто. Отметь тренажёр звёздочкой на его странице.':'Ничего не нашлось. Попробуй другое слово.'}</p>`;
  };
  $('#q').addEventListener('input',e=>{st.q=e.target.value;draw()});
  $('#cats').addEventListener('click',e=>{const b=e.target.closest('.cat');if(!b)return;st.cat=b.dataset.c;document.querySelectorAll('.cat').forEach(x=>x.classList.toggle('on',x===b));draw()});
  draw(); initPhoto();
}

// ---------- Узнать тренажёр по фото ----------
let sampleFn=null, samplePromise=null;
function getSample(){if(!samplePromise){const C=window.claude;samplePromise=C&&C.use?C.use('sample').then(s=>{sampleFn=s;return s}).catch(()=>null):Promise.resolve(null)}return samplePromise}
async function initPhoto(){
  const s=await getSample(); const box=$('#photo'); if(!s||!box)return;
  const lim=await s.limits().catch(()=>null); if(!lim||!lim.images||!$('#photo'))return;
  box.innerHTML=`<label class="photobtn">${ICON.cam}<span><b>Узнать тренажёр по фото</b><small>Сфотографируй тренажёр в зале — скажу, что это и как его настроить</small></span><input id="ph" type="file" accept="${lim.images.mediaTypes.join(',')}" capture="environment" class="sr"></label><div id="phres"></div>`;
  $('#ph').addEventListener('change',async e=>{
    const f=e.target.files&&e.target.files[0]; if(!f)return; e.target.value='';
    const out=$('#phres'); out.innerHTML='<p class="thinking">Смотрю на фото…</p>';
    const list=EX.map(x=>`${x.id} — ${x.n} (${x.aka})`).join('\n');
    try{
      const r=await s.json(`На фото — тренажёр или станция в спортзале. Определи, какой это тренажёр из списка ниже.\n\nСписок (id — название — другие названия):\n${list}\n\nОтветь только JSON вида {"id":"<id из списка или null>","confidence":0.0-1.0,"alt":["<id>","<id>"],"note":"одно короткое предложение по-русски: что видно на фото"}. Если на фото нет тренажёра — id null.`,{images:[f]});
      const m=r&&EXI[String(r.id)];
      const alts=(Array.isArray(r&&r.alt)?r.alt:[]).map(String).filter(id=>EXI[id]&&(!m||id!==m.id)).slice(0,2);
      out.innerHTML=m?`<div class="phcard"><p class="eyebrow">Похоже на это${r.confidence!=null?` · уверенность ${Math.round(Number(r.confidence)*100)}%`:''}</p><div class="list">${exRow(m)}</div>${r.note?`<p class="note">${esc(r.note)}</p>`:''}${alts.length?`<p class="note">Или, возможно:</p><div class="list">${alts.map(id=>exRow(EXI[id])).join('')}</div>`:''}</div>`
        :`<p class="note">Не узнал тренажёр на этом фото${r&&r.note?': '+esc(r.note):''}. Попробуй снять его целиком, сбоку.</p>`;
    }catch(err){
      const c=err&&err.code;
      out.innerHTML=`<p class="note">${c==='not_granted'||c==='sampling_disabled'?'Распознавание по фото не разрешено для этой страницы.':c==='rate_limited'?'Слишком много запросов — попробуй через минуту.':c==='image_rejected'?'Это фото не подошло — попробуй другое (JPEG или PNG).':'Не получилось распознать. Попробуй ещё раз.'}</p>`;
      if(c==='not_granted'||c==='sampling_disabled')$('#photo .photobtn')&&($('#photo .photobtn').hidden=true);
    }
  });
}

// ---------- Мышца ----------
function showMuscle(id){
  setNav('muscles');
  const M=MUSCLES[id];
  const list=EX.filter(e=>e.mus[id]).sort((a,b)=>(b.mus[id]-a.mus[id])||((concernOf(a.id,store.concerns).some(c=>c.lv==='avoid')?1:0)-(concernOf(b.id,store.concerns).some(c=>c.lv==='avoid')?1:0))||((b.sim?1:0)-(a.sim?1:0)));
  view().innerHTML=`${backBtn('muscles')}
  <section class="mhead" style="--c:${M.c}"><div><p class="eyebrow">${M.g}</p><h1>${M.n}</h1><p>${M.f}</p><a class="btn sm" href="#workout" id="trainM">Тренировка на эту мышцу</a></div>${bodyMap({[id]:3},false)}</section>
  <h2 class="sec">Тренажёры · ${list.length}</h2><div class="list">${list.map(e=>exRow(e,id)).join('')}</div>`;
  view().querySelectorAll('.row').forEach(a=>a.addEventListener('click',()=>{st.pending=a.dataset.t||null}));
  $('#trainM').addEventListener('click',()=>{plan.muscles=[id];plan.items=null});

}

// ---------- Экран тренажёра ----------
function showEx(ex){
  setNav(null);
  st.ex=ex;
  const order=Object.entries(ex.mus).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  st.target=st.pending&&ex.mus[st.pending]?st.pending:order[0];
  const fromMuscle=!!st.pending; st.pending=null;
  const sec=(t,arr,cls='')=>arr&&arr.length?`<section class="txt ${cls}"><h2 class="sec">${t}</h2><ol>${arr.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></section>`:'';
  const conc=concernOf(ex.id,store.concerns);
  const concHtml=conc.map(c=>`<div class="w ${c.lv==='avoid'?'bad':'warn'}"><span class="wi">${c.lv==='avoid'?SKULL:ICON.warn}</span><div><p><b>${c.lv==='avoid'?'Лучше заменить':'Можно с условиями'} (${c.n.toLowerCase()}):</b> ${esc(c.tx)}</p>${c.lv==='avoid'?`<p class="alts">Замены: ${CONCERNS[c.k].alt.filter(a=>EXI[a]&&a!==ex.id).slice(0,4).map(a=>`<a href="#ex-${a}">${esc(EXI[a].n)}</a>`).join(' · ')}</p>`:''}</div></div>`).join('');
  const srcs=sourcesFor(ex.id);
  const inWorkout=activeSession();
  view().innerHTML=`${backBtn('machines')}
  <header class="exhead">${icon(ex.id,'ico big')}<div class="exht"><p class="eyebrow">${CATS[ex.cat]} · ${esc(ex.eq)}</p><h1>${esc(ex.n)}</h1><p class="aka">${esc(ex.aka)}</p></div>
    <button class="favbtn${isFav(ex.id)?' on':''}" id="fav" aria-pressed="${isFav(ex.id)}" aria-label="В избранное">${ICON.star(isFav(ex.id))}</button></header>
  <div class="exacts">${gymToggleHtml(ex)}<button class="gymask" id="askex">Спросить тренера</button></div>
  ${concHtml?`<div class="conc">${concHtml}</div>`:''}
  <div class="target"><span class="tlabel">Что качаешь?</span><div class="chips" id="tchips">${order.map(m=>`<button class="tchip" data-m="${m}" style="--c:${MUSCLES[m].c}"><i></i>${MUSCLES[m].n}</button>`).join('')}</div></div>
  <div class="exgrid">
    <div class="col-a">${ex.sim?simShell(ex):`<section class="nosim">${bodyMap(ex.mus,false)}<p class="lvl"><span class="l3">основная</span><span class="l2">вспомогательная</span><span class="l1">стабилизатор</span></p><p class="note">Для этого тренажёра пока нет интерактивной модели — ниже настройка, техника и как сместить акцент.</p></section>`}</div>
    <div class="col-b">
      <div id="focusbox"></div>
      ${ex.sim?'<section class="readout"><h2 class="sec">Расчёт моментов за повтор</h2><p class="note sm">Доли — расчёт по рычагам в суставах, а не измеренная активация мышц.</p><div id="bars"></div><div id="prof"></div><div id="warns"></div></section>':''}
      ${ex.sim?'<section class="pbox"><h2 class="sec">Настройка в модели</h2><div id="params"></div></section>':''}
      ${historyBlock(ex)}
      ${inWorkout?`<button class="btn ghost" id="addw">Добавить в текущую тренировку</button>`:''}
    </div>
  </div>
  <div class="texts">${sec('Настройка тренажёра',ex.setup)}${sec('Выполнение',ex.steps)}${sec('Частые ошибки',ex.err,'err')}
  ${ex.focus?`<section class="txt"><h2 class="sec">Как сместить акцент</h2><div class="focus">${Object.entries(ex.focus).map(([m,t])=>`<div class="fitem" data-m="${m}" style="--c:${MUSCLES[m].c}"><b>${MUSCLES[m].n}</b><p>${esc(t)}</p></div>`).join('')}</div></section>`:''}
  ${srcs.length?`<section class="txt"><h2 class="sec">Что говорят исследования</h2><div class="srcs">${srcs.map(s=>`<a class="src" href="${s.u}" target="_blank" rel="noopener"><b>${esc(s.t)}</b><span>${esc(s.tx)}</span><small>${esc(s.j)} · PubMed ↗</small></a>`).join('')}</div></section>`:''}</div>`;
  $('#tchips').addEventListener('click',e=>{const b=e.target.closest('.tchip');if(!b)return;setTarget(b.dataset.m,true)});
  $('#fav').addEventListener('click',()=>{const on=!isFav(ex.id);store.favs=on?[...store.favs,ex.id]:store.favs.filter(x=>x!==ex.id);saveSettings();const b=$('#fav');b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);b.innerHTML=ICON.star(on)});
  const aw=$('#addw'); if(aw)aw.addEventListener('click',()=>{const s=activeSession();if(!s)return;if(!s.items.some(i=>i.id===ex.id))s.items.push(planItem(ex,st.target));s.cur=s.items.findIndex(i=>i.id===ex.id);saveSession(s);go('workout')});
  bindGymToggle(ex); $('#askex').addEventListener('click',()=>{chat.exId=ex.id;chat.prefill=`${ex.n}: `;go('coach')});
  if(ex.sim)initSim(ex,fromMuscle);
  setTarget(st.target,false);
}
function setTarget(m,user){
  st.target=m;
  document.querySelectorAll('.tchip').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  document.querySelectorAll('.fitem').forEach(f=>f.classList.toggle('on',f.dataset.m===m));
  const ex=st.ex, M=MUSCLES[m], tip=ex.focus&&ex.focus[m];
  $('#focusbox').innerHTML=`<section class="fcall" style="--c:${M.c}"><p class="eyebrow">Цель: ${M.n}</p>${tip?`<p>${esc(tip)}</p>`:`<p>Эта мышца здесь помогает, но не ведёт. Для неё лучше подойдут тренажёры из <a href="#m-${m}">списка «${M.n}»</a>.</p>`}<div id="status"></div></section>`;
  if(ex.sim){
    if(user){const pr=simPresets(ex)[m]; if(pr)applyPreset(pr,true)}
    recompute();
  }
}

// ---------- История на экране тренажёра ----------
function exHistory(id){const out=[];for(const s of store.log){const it=s.items&&s.items.find(i=>i.id===id);if(it&&it.sets&&it.sets.length)out.push({ts:s.ts,sets:it.sets,reps:it.reps})}return out}
function historyBlock(ex){
  const h=exHistory(ex.id); if(!h.length)return '';
  const pts=h.slice(0,10).reverse().map(x=>Math.max(...x.sets.map(s=>s.w)));
  const mx=Math.max(...pts),mn=Math.min(...pts),rng=mx-mn||1;
  const sp=pts.length>1?`<svg viewBox="0 0 120 34" class="spark" aria-hidden="true"><polyline points="${pts.map((y,i)=>`${(i/(pts.length-1)*116+2).toFixed(1)},${(30-(y-mn)/rng*26).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--force)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`:'';
  const sug=suggest(ex.id);
  return `<section class="pbox hist"><h2 class="sec">Твоя история</h2>${sp}<div class="hrows">${h.slice(0,5).map(x=>`<div class="hrow"><span>${fmtDate(x.ts)}</span><b>${x.sets.map(s=>`${kg(s.w)}×${s.r}`).join(', ')}</b></div>`).join('')}</div>${sug?`<p class="sug">${esc(sug.tx)}</p>`:''}</section>`;
}

// ---------- Модель: оболочка ----------
const isDefBody=()=>Math.abs(store.prof.h-178)<1&&Math.abs(store.prof.femur||0)<.05;
const femurTxt=f=>f>.3?'длинные бёдра':f<-.3?'короткие бёдра':'средние бёдра';
function simShell(ex){
  const L=simLabels(ex), fr=SIMS[ex.sim].frontal, kind=ex.cfg&&ex.cfg.kind;
  const tag=fr?(kind==='bench'?'вид со стороны ног':(kind==='machine'||kind==='pecdeck'||kind==='crossover')?'вид сверху':'вид спереди'):'вид сбоку';
  return `<section class="sim" id="simbox"><div class="stage" id="stage"><canvas id="cv" aria-label="Биомеханическая модель: ${esc(ex.n)}"></canvas>
  <span class="stag">${tag} · 2D-модель${fr?'':` · <a href="#profile">${store.prof.h} см, ${femurTxt(store.prof.femur||0)}</a>`}${!fr&&!isDefBody()?' · пунктир — средние пропорции':''}</span>
  ${HAS3D?'<div class="s3d" id="s3d" hidden></div>':''}
  <div class="coach" id="coach"></div><button class="fsbtn" id="fsb" aria-label="Во весь экран">${ICON.full}</button>${HAS3D?'<button class="modebtn" id="m3d" aria-pressed="false">3D</button>':''}</div>
  <div class="nowbar" id="nowbar" aria-live="off"></div>
  ${(()=>{let seen=false;try{seen=localStorage.getItem('rychag.limbhint')==='1'}catch(e){}return seen?'':'<p class="limbhint" id="limbhint">☝ Возьми пальцем белое кольцо на кисти или стопе и подними или опусти — модель пройдёт движение, а указатель покажет, какая мышца работает в этой точке. Оранжевые кружки меняют настройку тренажёра.</p>'})()}
  <div class="transport"><button class="play" id="play" aria-label="Пауза">❚❚</button>
    <div class="scrub"><input id="scrub" type="range" min="0" max="1" step="0.001" value="0" aria-label="Фаза движения"><div class="ends"><span>${esc(L.lo)}</span><span>${esc(L.hi)}</span></div></div></div>
  <div class="tempo" id="tempo"><span>Темп</span>${[[2,0,2],[3,1,1],[4,1,2]].map(x=>`<button data-t="${x.join('')}" class="${x.join('')===st.tempo.join('')?'on':''}">${x.join('-')}</button>`).join('')}<span class="hint">опускание · пауза · подъём, с</span></div></section>`;
}
function computeBounds(ex,pr){
  const sets=[{...st.p},...Object.values(pr).map(x=>({...st.p,...x}))];
  const B={x0:1e9,x1:-1e9,y0:1e9,y1:-1e9}; const inc=(p,r=0)=>{if(!p||typeof p.x!=='number')return;B.x0=Math.min(B.x0,p.x-r);B.x1=Math.max(B.x1,p.x+r);B.y0=Math.min(B.y0,p.y-r);B.y1=Math.max(B.y1,p.y+r)};
  const scan=()=>{for(const ps of sets)for(const t of [0,.25,.5,.75,1]){const {P}=runSim(ex,ps,t);Object.values(P.J).forEach(p=>inc(p,.11));P.props.forEach(o=>{if(o.t==='vline'||o.t==='cable')return;inc(o.a);inc(o.b);inc(o.p,o.r||0)});P.forces.forEach(f=>inc(add(f.p,mul(f.d,.32))))}};
  scan(); if(!SIMS[ex.sim].frontal&&!isDefBody())withBody(BODY_DEF,scan);
  if(!SIMS[ex.sim].frontal)B.y0=Math.min(B.y0,-.06);
  const m=.08; return {x0:B.x0-m,x1:B.x1+m,y0:B.y0-m,y1:B.y1+m};
}
function initSim(ex,fromMuscle){
  st.p={}; simParams(ex).forEach(x=>st.p[x.id]=x.def);
  const pr=simPresets(ex);
  if(fromMuscle&&pr[st.target])Object.assign(st.p,pr[st.target]);
  st.best={}; for(const m in pr){const sw=sweep(ex,{...st.p,...pr[m]},m);st.best[m]=sw.share[m]||0}
  st.t=0; st.clock=0; st.reps=0; st.playing=!reduceMotion(); st.fs=false;
  st.bounds=computeBounds(ex,pr);
  buildParams(ex);
  st.cv=$('#cv'); st.ctx=st.cv.getContext('2d'); st.layer=document.createElement('canvas');
  const ro=new ResizeObserver(()=>{sizeCanvas();st.dirty=true});ro.observe($('#stage')); st.ro=ro;
  sizeCanvas();
  $('#play').addEventListener('click',()=>{st.playing=!st.playing;syncPlay()});
  $('#scrub').addEventListener('input',e=>{st.playing=false;st.t=+e.target.value;syncPlay();st.dirty=true;drawStatusLive()});
  $('#tempo').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;st.tempo=b.dataset.t.split('').map(Number);document.querySelectorAll('#tempo button').forEach(x=>x.classList.toggle('on',x===b));st.clock=0});
  $('#fsb').addEventListener('click',toggleFs);
  if(HAS3D){$('#m3d').addEventListener('click',()=>set3D(!st.v3on));let pref=true;try{pref=localStorage.getItem('rychag.3d')!=='0'}catch(e){}set3D(pref)}
  buildTracks(ex); bindDrag(ex);
  syncPlay(); recompute();
  st.last=performance.now(); st.raf=requestAnimationFrame(loop);
}
function set3D(on){
  const host=$('#s3d'); if(!host)return;
  if(on&&!st.v3){
    try{
      const viewer=makeViewer(host,{yaw:0,pitch:.1,wheel:true});
      const fig=makeFigure(viewer.scene,store.prof), props=makeProps3D(viewer.scene);
      st.v3={viewer,fig,props};
      // кадр по позам: центр и размер
      const ex=st.ex, pts=[];
      for(const t of [0,.5,1]){const {P}=runSim(ex,st.p,t);const J3=pose3DFrom(P,ex,fig.dims);pts.push(J3.P,J3.N);for(const s of [1,-1])pts.push(...Object.values(J3.side[s]));P.props.forEach(o=>{if(o.a)pts.push(J3.map(o.a),J3.map(o.b));if(o.p)pts.push(J3.map(o.p))})}
      const bb=new THREE.Box3().setFromPoints(pts), c=bb.getCenter(V3(0,0,0)), sz=bb.getSize(V3(0,0,0));
      viewer.S.target=c; viewer.resize();{const vf=viewer.cam.fov*D2R/2,asp=viewer.cam.aspect||1,hf=Math.atan(Math.tan(vf)*asp);viewer.S.dist=Math.max(sz.y/(2*Math.tan(vf)),Math.max(sz.x,sz.z)*.9/(2*Math.tan(hf)))*1.12+.35} viewer.S.minD=.8; viewer.S.maxD=9;
      const kind=SIMS[ex.sim].frontal?(runSim(ex,st.p,0).P.kind):'side';
      viewer.S.yaw=kind==='side'?.55:kind==='bench'?.35:kind==='machine'||kind==='fly'?.4:.45;
      viewer.S.pitch=kind==='machine'||kind==='fly'?.75:kind==='bench'?.45:.12;
      viewer.grid.position.y=0;
      const V=st.v3; loadAnatomy().then(d=>{if(!d||st.v3!==V)return;try{V.anat=makeAnatomy(viewer.scene,store.prof);V.fig.grp.visible=false}catch(e){console.warn(e)}});
    }catch(err){st.v3=null;on=false}
  }
  st.v3on=!!(on&&st.v3);
  host.hidden=!st.v3on; st.cv.style.visibility=st.v3on?'hidden':'visible';
  const b=$('#m3d'); if(b){b.textContent=st.v3on?'2D':'3D';b.setAttribute('aria-pressed',st.v3on);b.setAttribute('aria-label',st.v3on?'Показать 2D-схему с рычагами':'Показать 3D-модель')}
  const tg=$('#stage .stag'); if(tg)tg.classList.toggle('dim',st.v3on);
  try{localStorage.setItem('rychag.3d',st.v3on?'1':'0')}catch(e){}
  sizeCanvas(); st.dirty=true;
}
function render3D(){
  const V=st.v3; if(!V)return;
  const ex=st.ex, {P,R}=runSim(ex,st.p,st.t), gm=st.sw?st.sw.gmax||1:1;
  let J3;
  if(V.anat){const k=V.anat.dims.k;J3=pose3DFrom(P,ex,{hw:V.anat.dims.hw*k,sw:V.anat.dims.sw*k});V.anat.pose(J3,{armRef:J3.armRef});
    if(!V.styled){V.anat.style({skin:true});V.styled=true}}
  else{J3=pose3DFrom(P,ex,V.fig.dims);
  V.fig.update(J3,id=>{if(id in R.loads){const k=clamp(Math.max(0,R.loads[id])/gm,0,1);return {e:.25+1.7*Math.pow(k,.8),dim:false,h:.03+.55*k}}return {e:.06,dim:true,h:0}})}
  V.props.update(P,J3,R,!V.anat);
  V.viewer.render();
}
function toggleFs(){
  st.fs=!st.fs; const box=$('#simbox'); if(!box)return;
  box.classList.toggle('fs',st.fs); document.body.classList.toggle('noscroll',st.fs);
  $('#fsb').setAttribute('aria-label',st.fs?'Свернуть':'Во весь экран');
  sizeCanvas(); st.dirty=true;
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&st.fs)toggleFs()});
function syncPlay(){const b=$('#play');if(!b)return;b.textContent=st.playing?'❚❚':'▶';b.setAttribute('aria-label',st.playing?'Пауза':'Воспроизвести')}
function stopAnim(){cancelAnimationFrame(st.raf);cancelAnimationFrame(home3.raf);if(st.ro){st.ro.disconnect();st.ro=null}st.cv=null;document.body.classList.remove('noscroll');
  if(st.v3){st.v3.fig.dispose();st.v3.anat&&st.v3.anat.dispose();st.v3.props.dispose();st.v3.viewer.dispose();st.v3=null}
  if(home3.viewer){home3.ro&&home3.ro.disconnect();home3.viewer.dispose();home3.viewer=null}
  if(typeof disposeAtlases==='function')disposeAtlases()}
function sizeCanvas(){
  const cv=st.cv;if(!cv)return; const w=cv.parentElement.clientWidth, b=st.bounds;
  const asp=(b.y1-b.y0)/(b.x1-b.x0);
  let h=st.fs?Math.max(240,window.innerHeight-170):Math.round(clamp(w*asp,240,Math.min(520,window.innerHeight*.62)));
  if(st.v3on&&!st.fs)h=Math.max(h,Math.min(420,Math.round(window.innerHeight*.5)));
  const dpr=Math.min(2.5,window.devicePixelRatio||1);
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+'px';
  st.layer.width=cv.width;st.layer.height=cv.height; st.W=w;st.H=h;st.dpr=dpr;
  const s=Math.min(w/(b.x1-b.x0),h/(b.y1-b.y0)); st.s=s; st.ox=(w-(b.x1-b.x0)*s)/2; st.oy=(h-(b.y1-b.y0)*s)/2;
  const h3=$('#s3d'); if(h3){h3.style.height=h+'px'; if(st.v3)st.v3.viewer.resize()}
}
window.addEventListener('resize',()=>{if(st.cv){sizeCanvas();st.dirty=true}});
const toS=p=>v(st.ox+(p.x-st.bounds.x0)*st.s, st.oy+(st.bounds.y1-p.y)*st.s);
const toW=(x,y)=>v((x-st.ox)/st.s+st.bounds.x0, st.bounds.y1-(y-st.oy)/st.s);

function buildParams(ex){
  const ps=simParams(ex), pr=simPresets(ex);
  $('#params').innerHTML=ps.map(x=>x.type==='choice'
    ?`<div class="param"><div class="plabel"><span>${x.label}</span></div><div class="seg" data-id="${x.id}">${x.options.map(([k,n])=>`<button data-v="${k}" class="${st.p[x.id]===k?'on':''}">${n}</button>`).join('')}</div></div>`
    :`<div class="param"><label class="plabel" for="p-${x.id}"><span>${x.label}</span><output id="o-${x.id}">${x.fmt(st.p[x.id])}</output></label><input type="range" id="p-${x.id}" min="${x.min}" max="${x.max}" step="${x.step}" value="${st.p[x.id]}"></div>`).join('')
    +`<div class="presets"><span>Готовые настройки:</span>${Object.keys(pr).map(m=>`<button class="pbtn" data-m="${m}" style="--c:${MUSCLES[m].c}">${MUSCLES[m].n}</button>`).join('')}<button class="pbtn reset" data-m="">Сброс</button></div>`;
  ps.forEach(x=>{
    if(x.type==='choice'){$(`.seg[data-id="${x.id}"]`).addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;st.p[x.id]=b.dataset.v;e.currentTarget.querySelectorAll('button').forEach(y=>y.classList.toggle('on',y===b));recompute()})}
    else $('#p-'+x.id).addEventListener('input',e=>{st.p[x.id]=+e.target.value;$('#o-'+x.id).textContent=x.fmt(st.p[x.id]);recompute()});
  });
  $('#params').querySelector('.presets').addEventListener('click',e=>{const b=e.target.closest('.pbtn');if(!b)return;
    if(!b.dataset.m){const d={};simParams(ex).forEach(x=>d[x.id]=x.def);applyPreset(d,true)}else{if(st.target!==b.dataset.m)setTarget(b.dataset.m,false);applyPreset(pr[b.dataset.m],true)}});
}
function applyPreset(pr,animate){
  const ex=st.ex, from={...st.p}, ps=simParams(ex);
  const done=()=>{ps.forEach(x=>{if(x.type==='choice'){const seg=$(`.seg[data-id="${x.id}"]`);seg&&seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===st.p[x.id]))}else{const i=$('#p-'+x.id);if(i){i.value=st.p[x.id];$('#o-'+x.id).textContent=x.fmt(st.p[x.id])}}});recompute()};
  ps.forEach(x=>{if(x.type==='choice'&&pr[x.id]!=null)st.p[x.id]=pr[x.id]});
  if(!animate||reduceMotion()){ps.forEach(x=>{if(pr[x.id]!=null)st.p[x.id]=pr[x.id]});done();return}
  const t0=performance.now();
  const step=now=>{const k=ease(clamp((now-t0)/450,0,1));ps.forEach(x=>{if(x.type!=='choice'&&pr[x.id]!=null)st.p[x.id]=lerp(from[x.id],pr[x.id],k)});st.dirty=true;
    if(k<1)requestAnimationFrame(step);else{ps.forEach(x=>{if(pr[x.id]!=null)st.p[x.id]=pr[x.id]});done()}};
  requestAnimationFrame(step); done();
}
function recompute(){
  const ex=st.ex; if(!ex||!ex.sim||!$('#bars'))return;
  st.sw=sweep(ex,st.p,st.target); st.dirty=true; if(!st.drag||!st.drag.limb)buildTracksSoon(ex);
  const sh=Object.entries(st.sw.share).filter(([,x])=>x>.005).sort((a,b)=>b[1]-a[1]);
  $('#bars').innerHTML=sh.map(([m,x])=>`<div class="bar${m===st.target?' tg':''}" style="--c:${MUSCLES[m].c}"><span class="bn">${MUSCLES[m].n}</span><span class="bt"><i style="width:${(x*100).toFixed(1)}%"></i></span><span class="bv">${pct(x)}</span></div>`).join('');
  $('#warns').innerHTML=st.sw.warns.map(w=>`<div class="w ${w.lv}"><span class="wi">${ICON[w.lv]}</span><p>${esc(w.tx)}</p></div>`).join('');
  drawStatus(); drawProfile();
}
let trkT=0; function buildTracksSoon(ex){clearTimeout(trkT);trkT=setTimeout(()=>{if(st.ex===ex&&st.cv){buildTracks(ex);st.dirty=true}},60)}
function drawStatus(){
  const el=$('#status'); if(!el||!st.sw)return;
  const m=st.target, M=MUSCLES[m], sh=st.sw.share;
  if(!(m in sh)){el.innerHTML=`<p class="stline mute">В двумерной модели эта мышца не видна — она работает в другой плоскости. Ориентируйся на советы выше.</p>`;return}
  const cur=sh[m]||0, best=st.best[m];
  const lead=Object.entries(sh).sort((a,b)=>b[1]-a[1])[0][0];
  let verdict='';
  if(best!=null){
    if(cur>=best*.92)verdict=`<span class="ok">${ICON.ok} настройка подходит для цели</span>`;
    else verdict=`<span class="warn">Можно до ~${pct(best)}</span><button class="pbtn sm" id="fix" style="--c:${M.c}">Настроить под цель</button>`;
  }
  el.innerHTML=`<div class="stline"><b class="big" style="color:${M.c}">${pct(cur)}</b><span>нагрузки за повтор приходится на цель${lead!==m?` · сейчас ведёт <b style="color:${MUSCLES[lead].c}">${MUSCLES[lead].n.toLowerCase()}</b>`:''}</span></div><div class="stline">${verdict}</div>`;
  const fx=$('#fix'); if(fx)fx.addEventListener('click',()=>applyPreset(simPresets(st.ex)[m],true));
}
function drawProfile(){
  const el=$('#prof'); if(!el||!st.sw)return;
  const m=st.target, inSim=m in st.sw.share, arr=inSim?st.sw.prof:st.sw.sum, mx=Math.max(...arr)||1, n=arr.length-1, L=simLabels(st.ex);
  const c=inSim?MUSCLES[m].c:'#8c92a8';
  const pts=arr.map((y,i)=>`${(i/n*300).toFixed(1)},${(64-y/mx*56).toFixed(1)}`);
  const pk=arr.indexOf(mx)/n, flat=Math.min(...arr)/mx>.85;
  const where=flat?'нагрузка ровная по всей амплитуде':pk<.3?'в начале — в растянутом положении':pk>.7?'в конце — в сокращённом положении':'в середине амплитуды';
  el.innerHTML=`<div class="prof"><div class="ph"><span>Где тяжелее всего${inSim?': '+MUSCLES[m].n.toLowerCase():''}</span><b>${where}</b></div>
  <svg viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="64" x2="300" y2="64" class="ax"/><polygon points="0,64 ${pts.join(' ')} 300,64" fill="${c}" opacity=".16"/><polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/><line id="pmark" x1="0" y1="2" x2="0" y2="66" class="mk"/></svg>
  <div class="ends"><span>${esc(L.lo)}</span><span>${esc(L.hi)}</span></div></div>`;
  drawStatusLive();
}
function drawStatusLive(){const mk=$('#pmark');if(mk){mk.setAttribute('x1',st.t*300);mk.setAttribute('x2',st.t*300)}const s=$('#scrub');if(s&&document.activeElement!==s)s.value=st.t}

// ---------- Анимация модели ----------
function loop(now){
  if(!st.cv)return;
  const dt=Math.min(.05,(now-st.last)/1000); st.last=now;
  const co=$('#coach');
  if(st.playing&&!st.drag){
    const [E,Pz,C]=st.tempo, hold=.35, T=C+hold+E+Math.max(Pz,.15);
    st.clock+=dt; if(st.clock>=T){st.clock-=T;st.reps++}
    const c=st.clock, L=simLabels(st.ex); let ph,label;
    if(c<C){st.t=ease(c/C);label=L.con;ph=C}
    else if(c<C+hold){st.t=1;label='Пауза';ph=0}
    else if(c<C+hold+E){st.t=1-ease((c-C-hold)/E);label=L.ecc;ph=E}
    else {st.t=0;label=Pz?'Пауза':'';ph=Pz}
    if(co){co.innerHTML=`<span class="rep">Повтор ${st.reps+1}</span>${label?`<b>${label}</b><span class="sec2">${ph?ph+' с':''}</span>`:''}`;co.dataset.p='0'}
    st.dirty=true; drawStatusLive();
  } else if(co&&co.dataset.p!=='1'){co.innerHTML='<span class="rep">Пауза</span><b>Тяни конечность или ползунок</b>';co.dataset.p='1'}
  if(!st.playing&&st.ptr&&!reduceMotion())st.dirty=true;
  if(st.v3on)render3D(); else if(st.dirty){render();st.dirty=false}
  st.raf=requestAnimationFrame(loop);
}

// ---------- Перетаскивание: ручки настройки и сами конечности ----------
// Траектории суставов за повтор: тянешь кисть или стопу — модель проходит движение, нагрузка пересчитывается
const TRK_N=48, LIMB_NAMES={W:'кисть',Wl:'кисть',E:'локоть',El:'локоть',A:'стопа',K:'колено',H:'таз',S:'плечо',Sl:'плечо',L:'поясница',head:'голова',toe:'носок',heel:'пятка'};
function buildTracks(ex){
  const pts={};
  for(let i=0;i<=TRK_N;i++){const {P}=runSim(ex,st.p,i/TRK_N);for(const k in P.J){const q=P.J[k];if(!q||typeof q.x!=='number')continue;(pts[k]=pts[k]||[]).push(v(q.x,q.y))}}
  const keys=[],rng={};
  for(const k in pts){if(k==='head'||k==='heel'||k==='toe')continue;const a=pts[k];let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const q of a){x0=Math.min(x0,q.x);x1=Math.max(x1,q.x);y0=Math.min(y0,q.y);y1=Math.max(y1,q.y)}rng[k]=Math.hypot(x1-x0,y1-y0);if(rng[k]>.04)keys.push(k)}
  keys.sort((a,b)=>rng[b]-rng[a]);
  const pref=['W','A','H','K','E','Wl','El','S'];st.trk={pts,keys,main:pref.filter(k=>keys.includes(k)).filter((k,i,a)=>!(k==='Wl'&&a.includes('W'))&&!(k==='El'&&a.includes('E'))).slice(0,2)};
}
function tOnTrack(k,w){
  const a=st.trk.pts[k]; let bi=0,bd=1e9;
  for(let i=0;i<a.length;i++){const d=Math.hypot(a[i].x-w.x,a[i].y-w.y);if(d<bd){bd=d;bi=i}}
  // уточнение по соседним отрезкам
  let best=bi/TRK_N, bdist=bd;
  for(const j of [bi-1,bi]){if(j<0||j+1>=a.length)continue;const A=a[j],B=a[j+1],ab=sub(B,A),L2=dot(ab,ab)||1e-9,u=clamp(dot(sub(w,A),ab)/L2,0,1),q=add(A,mul(ab,u)),d=Math.hypot(q.x-w.x,q.y-w.y);if(d<bdist){bdist=d;best=(j+u)/TRK_N}}
  return best;
}
function bindDrag(ex){
  const cv=st.cv, S=SIMS[ex.sim], HS=S.handles||[];
  const pos=e=>{const r=cv.getBoundingClientRect();return v(e.clientX-r.left,e.clientY-r.top)};
  const nearH=(P,q)=>HS.find(h=>{const hp=toS(h.at(P));return Math.hypot(hp.x-q.x,hp.y-q.y)<28});
  const nearL=(P,q)=>{if(!st.trk)return null;let bk=null,bd=30;for(const k of st.trk.keys){const p=P.J[k];if(!p)continue;const c=toS(p),d=Math.hypot(c.x-q.x,c.y-q.y)*(st.trk.main.includes(k)?.8:1);if(d<bd){bd=d;bk=k}}return bk};
  const hit=e=>{const {P}=runSim(ex,st.p,st.t),q=pos(e);return {P,q,h:nearH(P,q),l:null}};
  // на телефоне не даём странице скроллиться, если палец попал на ручку или конечность
  cv.addEventListener('touchstart',e=>{const t=e.touches[0];if(!t)return;const {P,q,h}=hit(t);if(h||nearL(P,q))e.preventDefault()},{passive:false});
  cv.addEventListener('pointerdown',e=>{
    const {P,q,h}=hit(e);
    if(h){st.drag={h,start:toW(q.x,q.y),p0:st.p[h.param],axis:h.axis(P),def:simParams(ex).find(x=>x.id===h.param)};cv.setPointerCapture(e.pointerId);e.preventDefault();return}
    const l=nearL(P,q); if(!l)return;
    st.drag={limb:l}; st.hov=l; st.playing=false; syncPlay(); cv.setPointerCapture(e.pointerId); e.preventDefault(); st.dirty=true; hideLimbHint();
  });
  cv.addEventListener('pointermove',e=>{
    if(!st.drag){const {P,q,h}=hit(e);const l=h?null:nearL(P,q);cv.style.cursor=h||l?'grab':'default';if(l!==st.hov){st.hov=l;st.dirty=true}return}
    const q=pos(e), w=toW(q.x,q.y), d=st.drag;
    if(d.limb){st.t=tOnTrack(d.limb,w);st.dirty=true;drawStatusLive();cv.style.cursor='grabbing';return}
    const x=d.def;
    let val=d.p0+dot(sub(w,d.start),d.axis); val=clamp(Math.round(val/x.step)*x.step,x.min,x.max);
    st.p[d.h.param]=val; const i=$('#p-'+x.id); if(i){i.value=val;$('#o-'+x.id).textContent=x.fmt(val)} recompute();
  });
  const end=()=>{if(st.drag&&st.drag.limb){st.hov=null;st.dirty=true}st.drag=null};
  cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
  cv.addEventListener('pointerleave',()=>{if(!st.drag&&st.hov){st.hov=null;st.dirty=true}});
}
function hideLimbHint(){const h=$('#limbhint');if(h)h.classList.add('gone');try{localStorage.setItem('rychag.limbhint','1')}catch(e){}}

// ---------- Указатель работающей мышцы и «сейчас» ----------
function nowLoads(R){
  const L=Object.entries(R.loads).map(([m,x])=>[m,Math.max(0,x)]).filter(([m,x])=>x>0&&MUSCLES[m]);
  const sum=L.reduce((a,[,x])=>a+x,0)||1; return L.map(([m,x])=>[m,x/sum,x]).sort((a,b)=>b[2]-a[2]);
}
function drawPointer(ctx,P,R){
  const nl=nowLoads(R), sh=muscleShapes(P), gm=st.sw?st.sw.gmax||1:1;
  const cand=nl.filter(([m])=>sh[m]);
  if(!cand.length||cand[0][2]/gm<.06){st.ptr=null;return}
  // гистерезис, чтобы указатель не прыгал между мышцами с почти равной нагрузкой
  let top=cand[0]; const prev=st.ptr&&cand.find(c=>c[0]===st.ptr); if(prev&&prev[2]>top[2]*.88)top=prev; st.ptr=top[0];
  const [m,share,abs]=top, M=MUSCLES[m], c=toS(sh[m][0].c);
  // направление выноски — от центра тела наружу
  const J=P.J, ctr=toS(J.H&&J.S?lerpV(J.H,J.S,.5):v(0,0)); let d=nrm(v(c.x-ctr.x||1,c.y-ctr.y)); if(!isFinite(d.x))d=v(1,0);
  const txt=M.n, sub2=`${pct(share)} нагрузки сейчас`;
  ctx.font='600 12.5px "Golos Text",system-ui,sans-serif'; const w1=ctx.measureText(txt).width; ctx.font='500 10.5px "JetBrains Mono",monospace'; const w2=ctx.measureText(sub2).width;
  const bw=Math.max(w1,w2)+20, bh=36;
  let bx=c.x+d.x*62-(d.x<0?bw:0), by=c.y+d.y*46-bh/2;
  bx=clamp(bx,6,st.W-bw-6); by=clamp(by,30,st.H-bh-6);
  const ax=clamp(c.x,bx,bx+bw), ay=clamp(c.y,by,by+bh), k=clamp(abs/gm,0,1);
  ctx.save();
  ctx.strokeStyle=M.c; ctx.lineWidth=1.4; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(c.x,c.y); ctx.lineTo(ax,ay); ctx.stroke(); ctx.setLineDash([]);
  const pulse=reduceMotion()?0:(Math.sin(performance.now()/180)+1)/2;
  ctx.fillStyle=M.c; ctx.beginPath(); ctx.arc(c.x,c.y,4,0,7); ctx.fill();
  ctx.strokeStyle=hexA(M.c,.75-.5*pulse); ctx.lineWidth=2; ctx.beginPath(); ctx.arc(c.x,c.y,7+5*pulse,0,7); ctx.stroke();
  ctx.fillStyle='rgba(12,13,18,.9)'; ctx.strokeStyle=hexA(M.c,.85); ctx.lineWidth=1.2; ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,9); ctx.fill(); ctx.stroke();
  ctx.fillStyle=hexA(M.c,.9); ctx.fillRect(bx+8,by+bh-7,(bw-16)*k,2.5);
  ctx.fillStyle='#eef0f6'; ctx.font='600 12.5px "Golos Text",system-ui,sans-serif'; ctx.fillText(txt,bx+10,by+15);
  ctx.fillStyle=M.c; ctx.font='500 10.5px "JetBrains Mono",monospace'; ctx.fillText(sub2,bx+10,by+27);
  ctx.restore();
}
function drawTracks(ctx,P){
  if(!st.trk)return;
  const show=st.drag&&st.drag.limb?[st.drag.limb]:st.hov?[st.hov]:[];
  for(const k of show){const a=st.trk.pts[k];ctx.save();ctx.setLineDash([2,5]);ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=1.6;ctx.beginPath();a.forEach((q,i)=>{const s=toS(q);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y)});ctx.stroke();ctx.setLineDash([]);
    for(const q of [a[0],a[a.length-1]]){const e=toS(q);ctx.fillStyle='rgba(255,255,255,.7)';ctx.beginPath();ctx.arc(e.x,e.y,3,0,7);ctx.fill()}ctx.restore()}
  // кольца-подсказки на конечностях, которые можно тянуть
  for(const k of st.trk.main){const p=P.J[k];if(!p)continue;const c=toS(p),on=(st.drag&&st.drag.limb===k)||st.hov===k;ctx.strokeStyle=on?'#fff':'rgba(255,255,255,.5)';ctx.lineWidth=on?2.2:1.4;ctx.beginPath();ctx.arc(c.x,c.y,on?12:9,0,7);ctx.stroke();if(!on){ctx.fillStyle='rgba(255,255,255,.08)';ctx.fill()}}
}
let nowT=0;
function drawNow(R){
  const el=$('#nowbar'); if(!el)return; const t=performance.now(); if(t-nowT<120)return; nowT=t;
  const nl=nowLoads(R).filter(x=>x[1]>.02).slice(0,4);
  const lbl=st.drag&&st.drag.limb?`тянешь: ${LIMB_NAMES[st.drag.limb]||'сустав'}`:'в этой точке';
  el.innerHTML=`<span class="nlb">${lbl} · ${Math.round(st.t*100)}% амплитуды</span>${nl.map(([m,x])=>`<span class="nch" style="--c:${MUSCLES[m].c}"><i style="width:${Math.round(x*100)}%"></i><b>${MUSCLES[m].n}</b>${pct(x)}</span>`).join('')||'<span class="nlb">нагрузки почти нет</span>'}`;
}

// ---------- Рисование ----------
const COL={mach:'rgba(150,158,182,.55)',rail:'rgba(150,158,182,.28)',pad:'#262a38',padEdge:'rgba(170,178,200,.5)',body:'#c3c9dc',force:'#ff7a2f',line:'rgba(255,255,255,.82)',grid:'rgba(255,255,255,.045)'};
function render(){
  const ex=st.ex, ctx=st.ctx, dpr=st.dpr; if(!ctx)return;
  const {P,R}=runSim(ex,st.p,st.t);
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,st.W,st.H);
  ctx.strokeStyle=COL.grid; ctx.lineWidth=1; const b=st.bounds;
  for(let x=Math.ceil(b.x0/.25)*.25;x<b.x1;x+=.25){const a=toS(v(x,0));ctx.beginPath();ctx.moveTo(a.x,0);ctx.lineTo(a.x,st.H);ctx.stroke()}
  for(let y=Math.ceil(b.y0/.25)*.25;y<b.y1;y+=.25){const a=toS(v(0,y));ctx.beginPath();ctx.moveTo(0,a.y);ctx.lineTo(st.W,a.y);ctx.stroke()}
  if(!P.frontal){const f=toS(v(0,0));ctx.fillStyle='rgba(255,255,255,.035)';ctx.fillRect(0,f.y,st.W,st.H-f.y);ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,f.y);ctx.lineTo(st.W,f.y);ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=1;for(let x=-20;x<st.W;x+=10){ctx.beginPath();ctx.moveTo(x,f.y+10);ctx.lineTo(x+10,f.y);ctx.stroke()}}
  drawProps(ctx,P);
  if(!P.frontal&&!isDefBody()){const g=withBody(BODY_DEF,()=>runSim(ex,st.p,st.t).P);drawSkeleton(ctx,g,true)}
  drawBody(P);
  drawMuscles(ctx,P,R);
  drawSkeleton(ctx,P);
  drawForces(ctx,P,R);
  drawTracks(ctx,P);
  drawHandles(ctx,P);
  drawPointer(ctx,P,R);
  drawNow(R);
}
const W2=m=>m*st.s;
function strokeSeg(ctx,a,b,w,col,cap='round'){const A=toS(a),B=toS(b);ctx.strokeStyle=col;ctx.lineWidth=Math.max(1,W2(w));ctx.lineCap=cap;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke()}
function drawProps(ctx,P){
  for(const o of P.props){
    if(o.t==='line'){if(o.c==='pad'){strokeSeg(ctx,o.a,o.b,o.w+.012,COL.padEdge);strokeSeg(ctx,o.a,o.b,o.w,COL.pad)}else strokeSeg(ctx,o.a,o.b,o.w,COL[o.c]||COL.mach)}
    else if(o.t==='circle'){const c=toS(o.p);ctx.fillStyle=o.c==='pad'?COL.pad:'rgba(150,158,182,.35)';ctx.strokeStyle=COL.padEdge;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(c.x,c.y,W2(o.r),0,7);ctx.fill();ctx.stroke()}
    else if(o.t==='plate'){const c=toS(o.p),r=W2(o.r);ctx.fillStyle='rgba(14,15,21,.85)';ctx.strokeStyle='rgba(190,196,214,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,r,0,7);ctx.fill();ctx.stroke();ctx.lineWidth=1;ctx.strokeStyle='rgba(190,196,214,.25)';ctx.beginPath();ctx.arc(c.x,c.y,r*.78,0,7);ctx.stroke();ctx.fillStyle='rgba(190,196,214,.5)';ctx.beginPath();ctx.arc(c.x,c.y,Math.max(2,r*.12),0,7);ctx.fill()}
    else if(o.t==='cable'){const a=toS(o.a),b=toS(o.b);ctx.strokeStyle='rgba(230,234,245,.55)';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
    else if(o.t==='axis'){const c=toS(o.p);ctx.strokeStyle='#ff4f63';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(c.x,c.y,6,0,7);ctx.stroke();ctx.beginPath();ctx.moveTo(c.x-10,c.y);ctx.lineTo(c.x+10,c.y);ctx.moveTo(c.x,c.y-10);ctx.lineTo(c.x,c.y+10);ctx.stroke();ctx.fillStyle='#ff4f63';ctx.font='600 10px "JetBrains Mono",monospace';ctx.fillText('ось',c.x+9,c.y-8)}
    else if(o.t==='vline'){const a=toS(v(o.x,0));ctx.setLineDash([4,5]);ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x,toS(v(0,st.bounds.y1)).y);ctx.stroke();ctx.setLineDash([])}
  }
}
function drawBody(P){
  const L=st.layer.getContext('2d'), J=P.J, c=COL.body; L.setTransform(st.dpr,0,0,st.dpr,0,0); L.clearRect(0,0,st.W,st.H);
  const seg=(a,b,w)=>strokeSeg(L,a,b,w,c);
  if(P.frontal){
    if(P.kind==='bench'||P.kind==='machine'||P.kind==='fly'){const o=toS(v(0,-.06));L.fillStyle=c;L.beginPath();L.ellipse(o.x,o.y,W2(.24),W2(.13),0,0,7);L.fill();if(P.kind!=='bench'){const h=toS(v(0,-.05));L.beginPath();L.arc(h.x,h.y,W2(.1),0,7);L.fill()}}
    else{const a=toS(v(-.22,.04));L.fillStyle=c;L.beginPath();L.roundRect(a.x,a.y,W2(.44),W2(.6),W2(.07));L.fill();seg(v(0,0),v(0,.12),.08);const h=toS(v(0,.2));L.beginPath();L.arc(h.x,h.y,W2(.1),0,7);L.fill()}
    for(const [S,E,W] of [[J.S,J.E,J.W],[J.Sl,J.El,J.Wl]]){seg(S,E,.09);seg(E,W,.075)}
  } else {
    if(J.L){seg(J.H,J.L,.21);seg(J.L,J.S,.21)}else seg(J.H,J.S,.21);
    seg(J.S,J.head,.07); const h=toS(J.head); L.fillStyle=c; L.beginPath(); L.arc(h.x,h.y,W2(.105),0,7); L.fill();
    seg(J.H,J.K,.14); seg(J.K,J.A,.1);
    const hp=[toS(J.heel),toS(J.A),toS(J.toe)];L.strokeStyle=c;L.lineWidth=W2(.06);L.lineJoin='round';L.lineCap='round';L.beginPath();L.moveTo(hp[0].x,hp[0].y);L.lineTo(hp[1].x,hp[1].y);L.lineTo(hp[2].x,hp[2].y);L.closePath();L.stroke();L.fill();
    seg(J.S,J.E,.085); seg(J.E,J.W,.07);
  }
  const ctx=st.ctx; ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=.34; ctx.drawImage(st.layer,0,0); ctx.restore();
}
function muscleShapes(P){
  const J=P.J, f=P.face, out={};
  if(P.frontal){
    const put=(id,c,rx,ry,ang=0)=>(out[id]=out[id]||[]).push({c,rx,ry,ang});
    for(const [S,E,sg] of [[J.S,J.E,1],[J.Sl,J.El,-1]]){
      const ud=nrm(sub(E,S)), ang=Math.atan2(ud.y,ud.x);
      if(P.kind==='bench'||P.kind==='machine'||P.kind==='fly')put('chest',v(sg*.11,-.03),.1,.065);
      else put('lats',v(sg*.15,-.24),.04,.11);
      put('frontdelt',add(S,v(-sg*.02,.01)),.05,.05);put('middelt',add(S,v(sg*.035,0)),.04,.05);put('reardelt',add(S,v(sg*.01,-.01)),.045,.045);
      put('traps',add(S,v(-sg*.09,.06)),.06,.03);
      put('triceps',add(lerpV(S,E,.55),mul(cw(ud),.025*sg)),.11,.032,ang);put('biceps',add(lerpV(S,E,.55),mul(ccw(ud),.02*sg)),.1,.03,ang);
    }
    out.upperback=[{c:v(0,-.12),rx:.1,ry:.07,ang:0}];
    return out;
  }
  const one=(id,c,rx,ry,d)=>out[id]=[{c,rx,ry,ang:Math.atan2(d.y,d.x)}];
  const td=nrm(sub(J.S,J.H)), tAnt=ant(mul(td,-1),f), tPost=mul(tAnt,-1);
  const thd=nrm(sub(J.K,J.H)), thAnt=ant(thd,f), thPost=mul(thAnt,-1);
  const sd=nrm(sub(J.A,J.K)), sAnt=ant(sd,f), sPost=mul(sAnt,-1);
  const ud=nrm(sub(J.E,J.S)), uAnt=ant(ud,f), fd=nrm(sub(J.W,J.E));
  const tl=len(sub(J.S,J.H));
  one('glutes',add(add(J.H,mul(thPost,.075)),mul(thd,.03)),.085,.07,thd);
  one('gmed',add(J.H,mul(td,.07)),.05,.04,td);
  one('hams',add(lerpV(J.H,J.K,.5),mul(thPost,.05)),.17,.045,thd);
  one('quads',add(lerpV(J.H,J.K,.5),mul(thAnt,.05)),.17,.05,thd);
  one('adductors',lerpV(J.H,J.K,.35),.11,.035,thd);
  one('calves',add(lerpV(J.K,J.A,.3),mul(sPost,.045)),.1,.042,sd);
  one('soleus',add(lerpV(J.K,J.A,.6),mul(sPost,.035)),.085,.03,sd);
  one('erectors',add(add(J.H,mul(td,tl*.3)),mul(tPost,.085)),.14,.032,td);
  one('lats',add(add(J.H,mul(td,tl*.6)),mul(tPost,.07)),.13,.05,td);
  one('upperback',add(add(J.H,mul(td,tl*.85)),mul(tPost,.08)),.08,.04,td);
  one('traps',add(add(J.S,mul(td,.06)),mul(tPost,.03)),.05,.03,td);
  one('chest',add(add(J.H,mul(td,tl*.8)),mul(tAnt,.09)),.09,.05,td);
  one('abs',add(add(J.H,mul(td,tl*.4)),mul(tAnt,.08)),.13,.03,td);
  one('frontdelt',add(add(J.S,mul(uAnt,.04)),mul(ud,.03)),.05,.035,ud);
  one('middelt',add(J.S,mul(ud,.03)),.05,.04,ud);
  one('reardelt',add(add(J.S,mul(uAnt,-.04)),mul(ud,.03)),.05,.035,ud);
  one('biceps',add(lerpV(J.S,J.E,.55),mul(uAnt,.03)),.09,.03,ud);
  one('triceps',add(lerpV(J.S,J.E,.5),mul(uAnt,-.035)),.1,.032,ud);
  one('forearms',lerpV(J.E,J.W,.35),.09,.028,fd);
  return out;
}
function hexA(h,a){const n=parseInt(h.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${clamp(a,0,1).toFixed(3)})`}
function drawMuscles(ctx,P,R){
  const sh=muscleShapes(P), gm=st.sw?st.sw.gmax||1:1;
  ctx.save(); ctx.globalCompositeOperation='lighter';
  for(const id in R.loads){
    const list=sh[id]; if(!list)continue; const k=clamp(Math.max(0,R.loads[id])/gm,0,1);
    const col=MUSCLES[id].c, a=.08+.92*Math.pow(k,.8);
    for(const m of list){
      const c=toS(m.c); ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(-m.ang);
      const rx=W2(m.rx)*(1+.15*k), ry=W2(m.ry)*(1+.25*k);
      const g=ctx.createRadialGradient(0,0,0,0,0,Math.max(rx,ry)*1.6);
      g.addColorStop(0,hexA(col,a));g.addColorStop(.45,hexA(col,a*.55));g.addColorStop(1,hexA(col,0));
      ctx.fillStyle=g; ctx.scale(1,ry/rx); ctx.beginPath(); ctx.arc(0,0,rx*1.6,0,7); ctx.fill();
      ctx.fillStyle=hexA(col,.25+.6*k); ctx.beginPath(); ctx.arc(0,0,rx,0,7); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}
function drawSkeleton(ctx,P,ghost){
  const J=P.J; ctx.strokeStyle=ghost?'rgba(200,206,225,.45)':COL.line; ctx.lineWidth=ghost?1.2:1.4; ctx.lineCap='round';
  if(ghost)ctx.setLineDash([3,4]);
  const ln=(a,b)=>{const A=toS(a),B=toS(b);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke()};
  const pts=[];
  if(P.frontal){ln(J.Sl,J.S);for(const [S,E,W] of [[J.S,J.E,J.W],[J.Sl,J.El,J.Wl]]){ln(S,E);ln(E,W);pts.push(S,E,W)}}
  else{if(J.L){ln(J.H,J.L);ln(J.L,J.S);pts.push(J.L)}else ln(J.H,J.S);ln(J.H,J.K);ln(J.K,J.A);ln(J.S,J.E);ln(J.E,J.W);pts.push(J.S,J.H,J.K,J.A,J.E,J.W)}
  if(ghost){ctx.setLineDash([]);return}
  for(const p of pts){const c=toS(p);ctx.fillStyle='#0c0d12';ctx.beginPath();ctx.arc(c.x,c.y,3.6,0,7);ctx.fill();ctx.stroke()}
}
function arrow(ctx,a,b,col,w){const A=toS(a),B=toS(b),d=nrm(sub(B,A));ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=w;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x-d.x*8,B.y-d.y*8);ctx.stroke();const n=v(-d.y,d.x);ctx.beginPath();ctx.moveTo(B.x,B.y);ctx.lineTo(B.x-d.x*12+n.x*6,B.y-d.y*12+n.y*6);ctx.lineTo(B.x-d.x*12-n.x*6,B.y-d.y*12-n.y*6);ctx.closePath();ctx.fill()}
function drawForces(ctx,P,R){
  const lines=[], seen=new Set();
  for(const a of R.arms){const key=a.F.p.x.toFixed(3)+a.F.p.y.toFixed(3)+a.F.d.x.toFixed(3);if(!seen.has(key)){seen.add(key);lines.push(a.F)}}
  ctx.setLineDash([5,5]); ctx.strokeStyle='rgba(255,255,255,.4)'; ctx.lineWidth=1.2;
  for(const F of lines){const a=toS(add(F.p,mul(F.d,-6))),b=toS(add(F.p,mul(F.d,6)));ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
  ctx.setLineDash([]);
  ctx.font='600 11px "JetBrains Mono",ui-monospace,monospace';
  for(const a of R.arms){
    const foot=perpFoot(a.J,a.F), d=armLen(a.J,a.F); if(d<.004)continue;
    const col=MUSCLES[a.m]?MUSCLES[a.m].c:'#fff', A=toS(a.J), B=toS(foot);
    ctx.strokeStyle=col; ctx.lineWidth=3; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke();
    const u=nrm(sub(A,B)), fd=v(a.F.d.x,-a.F.d.y), q=7;
    ctx.lineWidth=1.3; ctx.beginPath(); ctx.moveTo(B.x+u.x*q,B.y+u.y*q); ctx.lineTo(B.x+u.x*q+fd.x*q,B.y+u.y*q+fd.y*q); ctx.lineTo(B.x+fd.x*q,B.y+fd.y*q); ctx.stroke();
    const mid=v((A.x+B.x)/2,(A.y+B.y)/2), txt=`${(d*100).toFixed(0)} см`, tw=ctx.measureText(txt).width;
    const off=v(-u.y*13,u.x*13);
    ctx.fillStyle='rgba(12,13,18,.82)'; ctx.beginPath(); ctx.roundRect(mid.x+off.x-tw/2-5,mid.y+off.y-9,tw+10,17,8); ctx.fill();
    ctx.fillStyle=col; ctx.fillText(txt,mid.x+off.x-tw/2,mid.y+off.y+4);
  }
  for(const F of P.forces){
    const L=clamp(.3*(F.m??1),.14,.42);
    if(F.k==='load'&&!F.main){arrow(ctx,F.p,add(F.p,mul(F.d,L*.8)),'rgba(120,170,255,.75)',2.5);continue}
    arrow(ctx,F.p,add(F.p,mul(F.d,L)),COL.force,3.5);
  }
}
function drawHandles(ctx,P){
  const S=SIMS[st.ex.sim]; if(!S.handles)return;
  for(const h of S.handles){
    const c=toS(h.at(P)), ax=h.axis(P), d=nrm(v(ax.x,-ax.y)), act=st.drag&&st.drag.h===h;
    ctx.fillStyle=act?'#ff9a5c':'#ff5a2a'; ctx.strokeStyle='rgba(12,13,18,.9)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(c.x,c.y,act?13:11,0,7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(c.x-d.x*6,c.y-d.y*6); ctx.lineTo(c.x+d.x*6,c.y+d.y*6); ctx.stroke();
    for(const s of [1,-1]){const tip=v(c.x+d.x*6*s,c.y+d.y*6*s),n=v(-d.y,d.x);ctx.beginPath();ctx.moveTo(tip.x-d.x*3*s+n.x*3,tip.y-d.y*3*s+n.y*3);ctx.lineTo(tip.x,tip.y);ctx.lineTo(tip.x-d.x*3*s-n.x*3,tip.y-d.y*3*s-n.y*3);ctx.stroke()}
  }
}

// ===================== ТРЕНИРОВКА =====================
const HEAVY=['rack','smith','hack','legpress45','hlegpress','pendulum','beltsquat','hipthrust','calfpress'];
const SMALL=['calves','soleus','abs','obliques','middelt','reardelt','forearms','traps'];
const plan={muscles:[],items:null};
function repsFor(ex,m){return HEAVY.includes(ex.id)?[6,10]:SMALL.includes(m)?[12,15]:[8,12]}
function restFor(ex,m){return HEAVY.includes(ex.id)?120:SMALL.includes(m)?60:90}
function planItem(ex,m){return {id:ex.id,target:m,reps:repsFor(ex,m),rest:restFor(ex,m),sets:[]}}
function candidates(m){
  const av=e=>concernOf(e.id,store.concerns).some(c=>c.lv==='avoid'), care=e=>concernOf(e.id,store.concerns).length;
  const base=EX.filter(e=>(e.mus[m]||0)>=2&&!av(e)), g=gymSet()?base.filter(e=>inGym(e.id)):base;
  return (g.length?g:base).sort((a,b)=>(b.mus[m]-a.mus[m])||(care(a)-care(b))||((isFav(b.id)?1:0)-(isFav(a.id)?1:0))||((b.sim?1:0)-(a.sim?1:0)));
}
function buildPlan(muscles){
  const total=clamp(muscles.length*2,4,6), pools=muscles.map(m=>({m,list:candidates(m)})), out=[], used=new Set();
  let guard=0;
  while(out.length<total&&guard++<50){let added=false;for(const p of pools){if(out.length>=total)break;const e=p.list.find(x=>!used.has(x.id));if(e){used.add(e.id);out.push(planItem(e,p.m));added=true}}if(!added)break}
  return out;
}
function activeSession(){const s=store.log.find(x=>!x.done);if(s&&Date.now()-s.ts>16*3600e3)return null;return s||null}
function lastSets(id,exceptId){for(const s of store.log){if(s.id===exceptId)continue;const it=s.items&&s.items.find(i=>i.id===id);if(it&&it.sets&&it.sets.length)return {ts:s.ts,sets:it.sets,reps:it.reps}}return null}
function suggest(id,exceptId){
  const l=lastSets(id,exceptId); if(!l)return null;
  const [lo,hi]=l.reps||[8,12], w=Math.max(...l.sets.map(s=>s.w)), top=l.sets.filter(s=>s.w===w);
  const inc=HEAVY.includes(id)?5:2.5;
  if(top.every(s=>s.r>=hi))return {w:w+inc,r:lo,tx:`В прошлый раз все подходы с ${kg(w)} кг дошли до ${hi} повторов — попробуй ${kg(w+inc)} кг на ${lo}–${hi}.`};
  if(top.some(s=>s.r<lo))return {w,r:lo,tx:`В прошлый раз с ${kg(w)} кг были подходы меньше ${lo} повторов — оставь этот вес и добери повторы.`};
  const best=Math.max(...top.map(s=>s.r));
  return {w,r:Math.min(hi,best+1),tx:`Держи ${kg(w)} кг и добавь повтор: цель — ${Math.min(hi,best+1)} в первом подходе.`};
}
const START={legpress45:1,hlegpress:.8,hack:.45,smith:.4,rack:.35,pendulum:.35,beltsquat:.35,hipthrust:.6,legext:.3,lyingcurl:.18,seatedcurl:.2,standingcurl:.08,abductor:.35,adductor:.3,calfstand:.6,calfseat:.35,calfpress:.8,
  latpull:.45,seatedrow:.45,tbar:.3,hammerrow:.35,straightarm:.15,pullovermachine:.25,shrug:.5,chestpress:.35,smithbench:.35,pecdeck:.25,crossover:.08,inclinehammer:.3,shoulderpress:.25,lateralmachine:.12,reversefly:.12,facepull:.15,cablelateral:.04,uprightrow:.2,preacher:.12,cablecurl:.15,pushdown:.15,overheadcable:.1,tricepsmachine:.15,abcrunch:.25,cablecrunch:.3,torsorot:.2,backext:.3,glutekick:.12,cablekick:.06};
function startHint(e){const c=START[e.id];if(!c||!store.prof.kg)return null;const f=store.prof.sex==='f'?.62:1;const step=HEAVY.includes(e.id)?5:2.5;return Math.max(step,Math.round(store.prof.kg*c*f/step)*step)}
const wk={rest:0,restEnd:0,restTimer:0,metro:false,mT:0,mStart:0,mRep:0,mPhase:'',tempo:[3,1,1],w:null,r:null};
function showWorkoutTab(){
  setNav('workout');
  const s=activeSession();
  if(s){keepAwake(true);renderActive(s);return}
  keepAwake(false);
  const groups={};for(const id in MUSCLES)(groups[MUSCLES[id].g]=groups[MUSCLES[id].g]||[]).push(id);
  if(plan.muscles.length&&!plan.items)plan.items=buildPlan(plan.muscles);
  const ps=progState();
  view().innerHTML=`${subNav('workout')}${ps&&!ps.finished?`<a class="gymlink" href="#programs"><span>📅</span><div><b>${esc(ps.P.short)} · неделя ${ps.week}</b><small>следующий: ${esc(ps.P.days[ps.day].n)}</small></div><span class="chev">›</span></a>`:''}<section class="intro"><h1>Тренировка</h1><p>Выбери мышцы на сегодня — соберу 4–6 тренажёров с настройкой под цель${store.concerns.length?` и учту, что беспокоит: ${store.concerns.map(k=>CONCERNS[k].short).join(', ')}`:''}${gymSet()?' — только из тренажёров твоего зала':''}.</p></section>
  <div class="groups" id="wm">${Object.entries(groups).map(([g,ids])=>`<div class="grp"><h3>${g}</h3><div class="chips">${ids.map(id=>`<button class="tchip${plan.muscles.includes(id)?' on':''}" data-m="${id}" style="--c:${MUSCLES[id].c}"><i></i>${MUSCLES[id].n}</button>`).join('')}</div></div>`).join('')}</div>
  <div id="planbox"></div>
  ${journalHtml()}`;
  $('#wm').addEventListener('click',e=>{const b=e.target.closest('.tchip');if(!b)return;const m=b.dataset.m;plan.muscles=plan.muscles.includes(m)?plan.muscles.filter(x=>x!==m):[...plan.muscles,m];b.classList.toggle('on');plan.items=plan.muscles.length?buildPlan(plan.muscles):null;drawPlan()});
  drawPlan(); bindJournal();
}
function drawPlan(){
  const box=$('#planbox'); if(!box)return;
  if(!plan.items||!plan.items.length){box.innerHTML=plan.muscles.length?'<p class="note">Под эти мышцы с учётом ограничений тренажёров не нашлось.</p>':'';return}
  box.innerHTML=`<h2 class="sec mt">План · ${plan.items.length} упражнений</h2><div class="plan">${plan.items.map((it,i)=>{const e=EXI[it.id],sg=suggest(it.id);return `<div class="pitem">${icon(e.id)}<div class="rowmain"><b>${esc(e.n)}</b><div class="rowsub"><i class="dotc" style="--c:${MUSCLES[it.target].c}"></i>${MUSCLES[it.target].n} · 3 × ${it.reps[0]}–${it.reps[1]} · отдых ${it.rest} с</div>${sg?`<p class="tip">${esc(sg.tx)}</p>`:''}</div><div class="pact"><button class="ib" data-swap="${i}" aria-label="Заменить">⇄</button><button class="ib" data-del="${i}" aria-label="Убрать">✕</button></div></div>`}).join('')}</div>
  <button class="btn wide" id="startw">Начать тренировку</button>`;
  box.querySelector('.plan').addEventListener('click',e=>{
    const sw=e.target.closest('[data-swap]'),dl=e.target.closest('[data-del]');
    if(sw){const i=+sw.dataset.swap,it=plan.items[i],c=candidates(it.target),used=new Set(plan.items.map(x=>x.id));const k=c.findIndex(x=>x.id===it.id);const nx=[...c.slice(k+1),...c.slice(0,k)].find(x=>!used.has(x.id));if(nx)plan.items[i]=planItem(nx,it.target);drawPlan()}
    if(dl){plan.items.splice(+dl.dataset.del,1);drawPlan()}
  });
  $('#startw').addEventListener('click',()=>{audio();const s={id:'w'+Date.now().toString(36),ts:Date.now(),items:plan.items.map(x=>({...x,sets:[]})),cur:0,done:false};saveSession(s);plan.items=null;plan.muscles=[];say('Начинаем. Сначала разминка.');showWorkoutTab()});
}
function renderActive(s){
  const it=s.items[s.cur]; if(!it){finishWorkout(s);return}
  if(!s.warm&&s.cur===0&&s.items.every(x=>!x.sets.length)){renderWarm(s);return}
  const e=EXI[it.id], last=lastSets(it.id,s.id), sg=suggest(it.id,s.id);
  if(wk.w==null||wk.for!==it.id){wk.for=it.id;const prev=it.sets[it.sets.length-1];wk.w=prev?prev.w:(sg?sg.w:(last?Math.max(...last.sets.map(x=>x.w)):(startHint(e)||20)));wk.r=prev?prev.r:(sg?sg.r:it.reps[1])}
  const done=s.items.filter(x=>x.sets.length).length;
  view().innerHTML=`<section class="wact">
  <div class="whead"><p class="eyebrow">${s.prog&&PROGRAMS[s.prog.id]?`${esc(PROGRAMS[s.prog.id].short)} · неделя ${s.prog.week} · `:''}Упражнение ${s.cur+1} из ${s.items.length} · выполнено ${done}</p><div class="wprog">${s.items.map((x,i)=>`<i class="${i===s.cur?'cur':x.sets.length?'dn':''}"></i>`).join('')}</div></div>
  <div class="wcard">${icon(e.id,'ico big')}<div class="rowmain"><h1>${esc(e.n)}</h1><p class="rowsub"><i class="dotc" style="--c:${MUSCLES[it.target].c}"></i>Цель: ${MUSCLES[it.target].n} · ${it.plan?it.plan+' × ':''}${it.reps[0]}–${it.reps[1]} повторов</p></div></div>
  ${e.focus&&e.focus[it.target]?`<p class="tip">${esc(e.focus[it.target])}</p>`:''}
  <a class="link" href="#ex-${e.id}" id="openEx">Модель и настройка тренажёра ›</a>
  ${voiceRow()}
  ${!last&&startHint(e)?`<div class="lastbox"><span>Ориентир для старта (${store.prof.sex==='f'?'женщина':'мужчина'}, ${store.prof.kg} кг)</span><b>около ${kg(startHint(e))} кг</b><p class="note">Грубая оценка по весу тела. Если 12 повторов даются легко — добавь, если техника ломается — сбавь.</p></div>`:''}
  ${last?`<div class="lastbox"><span>Прошлый раз, ${fmtDate(last.ts)}</span><b>${last.sets.map(x=>`${kg(x.w)}×${x.r}`).join(', ')}</b>${sg?`<p class="sug">${esc(sg.tx)}</p>`:''}</div>`:'<p class="note">Первый раз на этом тренажёре: подбери вес, с которым последний повтор даётся тяжело, но технично.</p>'}
  <div class="setin">
    <div class="stepper"><span>Вес, кг</span><div><button data-d="w:-${HEAVY.includes(e.id)?5:2.5}">−</button><input id="ww" inputmode="decimal" value="${kg(wk.w)}" aria-label="Вес"><button data-d="w:${HEAVY.includes(e.id)?5:2.5}">+</button></div></div>
    <div class="stepper"><span>Повторы</span><div><button data-d="r:-1">−</button><input id="wr" inputmode="numeric" value="${wk.r}" aria-label="Повторы"><button data-d="r:1">+</button></div></div>
  </div>
  ${micHtml()}
  <button class="btn wide${it.plan&&it.sets.length>=it.plan?' ghost':''}" id="logset">${it.plan&&it.sets.length>=it.plan?`Ещё подход (сверх плана)`:`Подход ${it.sets.length+1}${it.plan?' из '+it.plan:''} выполнен`}</button>
  ${it.sets.length?`<div class="sets">${it.sets.map((x,i)=>`<span class="setc">${i+1}: ${kg(x.w)} кг × ${x.r}<button data-rm="${i}" aria-label="Удалить подход">✕</button></span>`).join('')}</div>`:''}
  <div id="restbox"></div>
  <section class="metro"><div class="mhead2"><b>Метроном темпа</b><span class="hint">звук и вибрация — можно не смотреть в экран</span></div>
    <div class="tempo inl">${[[2,0,2],[3,1,1],[4,1,2]].map(x=>`<button data-t="${x.join('')}" class="${x.join('')===wk.tempo.join('')?'on':''}">${x.join('-')}</button>`).join('')}</div>
    <div class="mdisp" id="mdisp"><span class="mph">${wk.metro?'':'—'}</span><span class="mrep"></span></div>
    <button class="btn ghost wide" id="mtog">${wk.metro?'Остановить метроном':'▶ Запустить метроном'}</button></section>
  <div class="wnav"><button class="btn ghost" id="prev" ${s.cur===0?'disabled':''}>‹ Назад</button><button class="btn${it.plan&&it.sets.length>=it.plan?'':' ghost'}" id="next">${s.cur===s.items.length-1?'К итогам':'Дальше ›'}</button></div>
  <button class="link danger" id="finish">Завершить тренировку</button>
  </section>`;
  const readIn=()=>{const w=parseFloat(String($('#ww').value).replace(',','.')),r=parseInt($('#wr').value,10);if(!isNaN(w))wk.w=Math.max(0,w);if(!isNaN(r))wk.r=Math.max(1,r)};
  view().querySelector('.setin').addEventListener('click',ev=>{const b=ev.target.closest('[data-d]');if(!b)return;readIn();const [k,d]=b.dataset.d.split(':');if(k==='w')wk.w=Math.max(0,Math.round((wk.w+ +d)*10)/10);else wk.r=Math.max(1,wk.r+ +d);$('#ww').value=kg(wk.w);$('#wr').value=wk.r});
  const logSet=()=>{readIn();audio();it.sets.push({w:wk.w,r:wk.r,ts:Date.now()});saveSession(s);stopMetro();
    const n=it.sets.length, fin=it.plan&&n>=it.plan;
    wk.restSay=fin?(s.cur<s.items.length-1?`Отдых окончен. Следующее упражнение: ${EXI[s.items[s.cur+1].id].n}.`:'Отдых окончен. Это было последнее упражнение.'):`Отдых окончен. Подход ${n+1}.`;
    say(`Подход ${n} записан: ${kg(wk.w)} килограмм на ${wk.r}. ${fin?'Все подходы сделаны. ':''}Отдых ${it.rest} секунд.`);
    startRest(it.rest);renderActive(s)};
  $('#logset').addEventListener('click',logSet);
  bindVoiceRow(()=>renderActive(s));
  bindMic(p=>{if(p.w!=null)wk.w=Math.max(0,p.w);if(p.r!=null)wk.r=Math.max(1,p.r);$('#ww').value=kg(wk.w);$('#wr').value=wk.r;toast(`Распознано: ${kg(wk.w)} кг × ${wk.r}${p.log?' — записываю':''}`);if(p.log)logSet()});
  const sl=view().querySelector('.sets'); if(sl)sl.addEventListener('click',ev=>{const b=ev.target.closest('[data-rm]');if(!b)return;it.sets.splice(+b.dataset.rm,1);saveSession(s);renderActive(s)});
  view().querySelector('.metro .tempo').addEventListener('click',ev=>{const b=ev.target.closest('button');if(!b)return;wk.tempo=b.dataset.t.split('').map(Number);view().querySelectorAll('.metro .tempo button').forEach(x=>x.classList.toggle('on',x===b));if(wk.metro){stopMetro();startMetro()}});
  $('#mtog').addEventListener('click',()=>{wk.metro?stopMetro():startMetro();$('#mtog').textContent=wk.metro?'Остановить метроном':'▶ Запустить метроном'});
  $('#prev').addEventListener('click',()=>{stopMetro();s.cur=Math.max(0,s.cur-1);saveSession(s);wk.w=null;renderActive(s);window.scrollTo(0,0)});
  $('#next').addEventListener('click',()=>{stopMetro();if(s.cur>=s.items.length-1){finishWorkout(s);return}s.cur++;saveSession(s);wk.w=null;const ni=s.items[s.cur];say(`Следующее упражнение: ${EXI[ni.id].n}. ${ni.reps[0]}–${ni.reps[1]} повторов.`);renderActive(s);window.scrollTo(0,0)});
  $('#finish').addEventListener('click',()=>finishWorkout(s));
  drawRest();
}
// --- отдых ---
function startRest(sec){wk.said10=sec<=15;wk.restEnd=Date.now()+sec*1000;wk.restTotal=sec;clearInterval(wk.restTimer);wk.restTimer=setInterval(tickRest,250);tickRest()}
function tickRest(){const left=Math.ceil((wk.restEnd-Date.now())/1000);if(left<=10&&left>0&&!wk.said10){wk.said10=true;say('Десять секунд',{fast:true})}if(left<=0){clearInterval(wk.restTimer);wk.restTimer=0;wk.restEnd=0;beep(988,.18);setTimeout(()=>beep(1318,.25),200);buzz([200,100,200]);say(wk.restSay||'Отдых окончен.');drawRest(true);return}drawRest()}
function drawRest(ended){
  const box=$('#restbox'); if(!box)return;
  if(ended){box.innerHTML='<div class="rest done"><b>Отдых окончен</b><span>Следующий подход</span></div>';return}
  if(!wk.restEnd){box.innerHTML='';return}
  const left=Math.max(0,Math.ceil((wk.restEnd-Date.now())/1000)), k=left/(wk.restTotal||1), C=2*Math.PI*26;
  box.innerHTML=`<div class="rest"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="rbg"/><circle cx="32" cy="32" r="26" class="rfg" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-k)}"/></svg><div><b class="rnum">${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}</b><span>Отдых</span></div><div class="ract"><button data-r="-15">−15</button><button data-r="15">+15</button><button data-r="skip">Пропустить</button></div></div>`;
  box.querySelector('.ract').onclick=ev=>{const b=ev.target.closest('button');if(!b)return;if(b.dataset.r==='skip'){clearInterval(wk.restTimer);wk.restEnd=0;drawRest();return}wk.restEnd+=(+b.dataset.r)*1000;tickRest()};
}
// --- метроном ---
function startMetro(){audio();wk.metro=true;wk.mStart=performance.now();wk.mRep=0;wk.mPhase='';clearInterval(wk.mT);wk.mT=setInterval(tickMetro,40);tickMetro()}
function stopMetro(){wk.metro=false;clearInterval(wk.mT);wk.mT=0;const d=$('#mdisp');if(d)d.innerHTML='<span class="mph">—</span><span class="mrep"></span>'}
function tickMetro(){
  const [E,Pz,C]=wk.tempo, hold=.5, T=C+hold+E+Math.max(Pz,.3), el=(performance.now()-wk.mStart)/1000, rep=Math.floor(el/T), c=el%T;
  let ph; if(c<C)ph='ВВЕРХ'; else if(c<C+hold)ph='ДЕРЖИ'; else if(c<C+hold+E)ph='ВНИЗ'; else ph='ПАУЗА';
  if(ph!==wk.mPhase){wk.mPhase=ph;if(ph==='ВВЕРХ'){beep(988,.12);buzz(60);if(store.voice.on&&store.voice.count)say(NUMW[Math.min(rep+1,20)]||String(rep+1),{fast:true})}else if(ph==='ВНИЗ'){beep(523,.16);buzz([30,40,30])}else beep(740,.05,.12)}
  const sec=ph==='ВВЕРХ'?C-c:ph==='ВНИЗ'?C+hold+E-c:0;
  const d=$('#mdisp');if(d)d.innerHTML=`<span class="mph ${ph==='ВВЕРХ'?'up':ph==='ВНИЗ'?'dn':''}">${ph}</span><span class="mrep">повтор ${rep+1}${sec>0?` · ${sec.toFixed(1).replace('.',',')} с`:''}</span>`;
}
function finishWorkout(s){
  stopMetro();clearInterval(wk.restTimer);wk.restEnd=0;wk.w=null;
  s.items=s.items.filter(x=>x.sets.length);
  if(!s.items.length){deleteSession(s.id);keepAwake(false);showWorkoutTab();return}
  s.done=true; s.end=Date.now(); saveSession(s); keepAwake(false);
  const pa=programAdvance(s);
  say('Тренировка завершена. Отличная работа! Не забудь заминку.');
  const vol=s.items.reduce((a,x)=>a+x.sets.reduce((b,y)=>b+y.w*y.r,0),0);
  const prs=s.items.filter(x=>{const l=lastSets(x.id,s.id);return l&&Math.max(...x.sets.map(y=>y.w))>Math.max(...l.sets.map(y=>y.w))});
  view().innerHTML=`<section class="intro"><p class="eyebrow">Тренировка завершена</p><h1>Готово!</h1><p>${s.items.length} упражнений · ${s.items.reduce((a,x)=>a+x.sets.length,0)} подходов · ${Math.round(vol).toLocaleString('ru-RU')} кг общего тоннажа${s.end?` · ${Math.max(1,Math.round((s.end-s.ts)/60000))} мин`:''}</p></section>
  ${prs.length?`<div class="w ok"><span class="wi">${ICON.ok}</span><p>Рост веса: ${prs.map(x=>esc(EXI[x.id].n)).join(', ')}</p></div>`:''}
  <div class="list">${s.items.map(x=>`<div class="row">${icon(x.id)}<div class="rowmain"><b>${esc(EXI[x.id].n)}</b><div class="rowsub">${x.sets.map(y=>`${kg(y.w)}×${y.r}`).join(', ')}</div></div></div>`).join('')}</div>
  ${pa?`<div class="w ok"><span class="wi">${ICON.ok}</span><p>${pa.finished?`Программа «${esc(pa.P.n)}» пройдена!`:`Программа: следующий раз — ${esc(pa.P.days[pa.day].n)} (неделя ${pa.week} из ${pa.P.weeks}).`}</p></div>`:''}
  ${cooldownHtml(s)}
  <a class="btn wide" href="#progress">Мой прогресс</a><a class="btn ghost wide" href="#muscles">На главную</a>`;
  const cc=$('#cchk');if(cc)cc.addEventListener('click',e=>{const b=e.target.closest('.ck');if(b)b.classList.toggle('on')});
}
function journalHtml(){
  const L=store.log.filter(x=>x.done);
  if(!L.length)return `<h2 class="sec mt">Журнал</h2><p class="note">Здесь появятся твои тренировки. ${store.mode==='db'?'Они сохраняются в твоём аккаунте.':`Они сохраняются ${HERE}.`}</p>`;
  return `<h2 class="sec mt">Журнал · ${L.length}</h2><div class="journal" id="jr">${L.slice(0,40).map(s=>{const sets=s.items.reduce((a,x)=>a+x.sets.length,0),vol=s.items.reduce((a,x)=>a+x.sets.reduce((b,y)=>b+y.w*y.r,0),0);return `<details class="jitem"><summary><span class="jd">${fmtDate(s.ts)}</span><span class="jn">${s.items.map(x=>esc(EXI[x.id]?EXI[x.id].n:x.id)).join(' · ')}</span><span class="jv">${sets} подх. · ${Math.round(vol).toLocaleString('ru-RU')} кг</span></summary>
  <div class="jbody">${s.items.map(x=>`<div class="hrow"><a href="#ex-${x.id}">${esc(EXI[x.id]?EXI[x.id].n:x.id)}</a><b>${x.sets.map(y=>`${kg(y.w)}×${y.r}`).join(', ')}</b></div>`).join('')}<button class="link danger" data-delj="${s.id}">Удалить запись</button></div></details>`}).join('')}</div>`;
}
function bindJournal(){const j=$('#jr');if(!j)return;j.addEventListener('click',e=>{const b=e.target.closest('[data-delj]');if(!b)return;const det=b.closest('details');if(b.dataset.armed){deleteSession(b.dataset.delj);showWorkoutTab()}else{b.dataset.armed='1';b.textContent='Нажми ещё раз, чтобы удалить';setTimeout(()=>{if(det.isConnected){b.dataset.armed='';b.textContent='Удалить запись'}},3000)}})}

// ===================== ПРОФИЛЬ =====================
function showProfileTab(){
  setNav('profile');
  const p=store.prof;
  view().innerHTML=`<section class="intro"><h1>Профиль</h1><p>Пропорции меняют рычаги в модели, ограничения — подбор тренажёров и план тренировки.</p></section>
  <section class="pbox"><h2 class="sec">Моё тело</h2>
    ${profileFields()}
    <p class="note">Как понять: сядь на стул, бедро параллельно полу. Если колено заметно выступает дальше, чем у большинства, при той же высоте сиденья — бёдра длинные. Длинные бёдра в приседе требуют большего наклона корпуса.</p>
    <a class="btn ghost" href="#ex-rack">Посмотреть на приседе со штангой</a></section>
  <div class="plinks"><a class="gymlink" href="#health"><span>🩺</span><div><b>Тренировки и здоровье</b><small>поясница, колено, плечо, давление, беременность, диабет</small></div><span class="chev">›</span></a>
  <a class="gymlink" href="#gym"><span>🏠</span><div><b>Мой зал</b><small>${gymSet()?`отмечено ${store.gym.length} тренажёров`:'не отмечен — используются все тренажёры'}</small></div><span class="chev">›</span></a></div>
  ${voiceAvail()?`<section class="pbox"><h2 class="sec">Голосовой тренер</h2><p class="note">Подсказывает во время тренировки: подход записан, отдых, «десять секунд», следующее упражнение, счёт повторов под метроном.</p>${voiceRow()}<div class="param"><label class="plabel" for="vrate"><span>Скорость речи</span><output id="ovr">${kg(store.voice.rate||1)}×</output></label><input type="range" id="vrate" min=".8" max="1.4" step=".1" value="${store.voice.rate||1}"></div><button class="btn sm ghost" id="vtest">Проверить голос</button></section>`:''}
  <section class="pbox"><h2 class="sec">Что беспокоит</h2><div class="cgrid" id="cg">${Object.entries(CONCERNS).map(([k,c])=>`<button class="cbtn${store.concerns.includes(k)?' on':''}" data-k="${k}" aria-pressed="${store.concerns.includes(k)}"><b>${c.n}</b><span>${c.note}</span></button>`).join('')}</div>
    <p class="note">Это общие рекомендации, а не диагноз. При острой боли, отёке, онемении или боли после травмы сначала покажись врачу. Подробнее — в разделе <a href="#health">«Тренировки и здоровье»</a>.</p></section>
  <section class="pbox"><h2 class="sec">Где хранятся данные</h2><p class="note" id="smode">${store.mode==='db'?'Избранное, профиль и журнал сохраняются в твоём аккаунте и видны только тебе.':IS_APP?'Данные хранятся на этом телефоне. Если удалить приложение, журнал пропадёт.':'Данные сохраняются в этом браузере. Если очистить данные сайта, журнал пропадёт.'}</p></section>
  <section class="how"><h2 class="sec">Как читать модель</h2>
      <div class="howrow"><span class="sw force"></span><div><b>Оранжевая стрелка</b> — сила, с которой тренажёр или пол давит на тело. Пунктир продолжает её линию.</div></div>
      <div class="howrow"><span class="sw arm"></span><div><b>Цветные отрезки</b> — плечи рычага от суставов до этой линии, в сантиметрах. Цвет — мышца, которая держит этот момент. Чем длиннее отрезок, тем сильнее работает мышца.</div></div>
      <div class="howrow"><span class="sw glow"></span><div><b>Свечение</b> — насколько мышца нагружена в этой фазе. Полоски под моделью — средняя доля за весь повтор.</div></div>
      <div class="howrow"><span class="sw handle"></span><div><b>Оранжевые кружки</b> можно тянуть пальцем: стопы, хват, положение колена. Ползунки делают то же самое.</div></div>
      <div class="howrow"><span class="sw ghost"></span><div><b>Пунктирный скелет</b> — тот же человек со средними пропорциями. Видно, как меняется техника при твоих рычагах.</div></div>
      <div class="howrow"><span class="sw skull">${SKULL}</span><div><b>Череп</b> — настройка, при которой нагрузка уходит туда, где её быть не должно: на поясницу, связки или суставную капсулу.</div></div>
      <p class="note">Модель упрощённая и двумерная: она показывает моменты в суставах в плоскости рисунка и не учитывает вращения и вес звеньев. Проценты — ориентир, какая мышца ведёт, а не замер мышечной активности.</p></section>
  <section class="txt"><h2 class="sec">Исследования в приложении</h2><div class="srcs">${Object.values(SOURCES).map(s=>`<a class="src" href="${s.u}" target="_blank" rel="noopener"><b>${esc(s.t)}</b><span>${esc(s.tx)}</span><small>${esc(s.j)} · PubMed ↗</small></a>`).join('')}</div></section>`;
  bindProfileFields();
  bindVoiceRow(()=>showProfileTab());
  const vr=$('#vrate');if(vr){vr.addEventListener('input',e=>{store.voice={...store.voice,rate:+e.target.value};$('#ovr').textContent=kg(+e.target.value)+'×';saveSettings()});$('#vtest').addEventListener('click',()=>say('Подход два записан: сорок килограмм на десять. Отдых девяносто секунд.',{force:true}))}
  $('#cg').addEventListener('click',e=>{const b=e.target.closest('.cbtn');if(!b)return;const k=b.dataset.k,on=!store.concerns.includes(k);store.concerns=on?[...store.concerns,k]:store.concerns.filter(x=>x!==k);b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);saveSettings();renderTopConcerns()});
}

