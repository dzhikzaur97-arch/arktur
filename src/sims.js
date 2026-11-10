// ===== Вектора и геометрия (метры, y вверх) =====
const D2R = Math.PI/180;
const v = (x,y)=>({x,y});
const add=(a,b)=>v(a.x+b.x,a.y+b.y), sub=(a,b)=>v(a.x-b.x,a.y-b.y), mul=(a,k)=>v(a.x*k,a.y*k);
const len=a=>Math.hypot(a.x,a.y);
const nrm=a=>{const l=len(a)||1;return v(a.x/l,a.y/l)};
const cross=(a,b)=>a.x*b.y-a.y*b.x, dot=(a,b)=>a.x*b.x+a.y*b.y;
const ccw=a=>v(-a.y,a.x), cw=a=>v(a.y,-a.x);
const dirA=deg=>v(Math.cos(deg*D2R),Math.sin(deg*D2R));
const rotV=(a,deg)=>{const c=Math.cos(deg*D2R),s=Math.sin(deg*D2R);return v(a.x*c-a.y*s,a.x*s+a.y*c)};
const lerp=(a,b,t)=>a+(b-a)*t, lerpV=(a,b,t)=>v(lerp(a.x,b.x,t),lerp(a.y,b.y,t));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

const BODY={sh:.43, th:.44, to:.50, nk:.22, ua:.30, fa:.33};
const BODY_DEF={...BODY};
// пропорции: рост (см) и длина бедра (-1 короче … +1 длиннее среднего)
function setBody(prof){const k=(prof&&prof.h?prof.h:178)/178, f=prof&&prof.femur?prof.femur:0;
  Object.assign(BODY,{sh:.43*k*(1-.04*f),th:.44*k*(1+.09*f),to:.50*k,nk:.22*k,ua:.30*k,fa:.33*k})}
function withBody(b,fn){const keep={...BODY};Object.assign(BODY,b);try{return fn()}finally{Object.assign(BODY,keep)}}

function ik(A,B,l1,l2,bend){
  const d=sub(B,A); let dl=len(d);
  dl=clamp(dl,Math.abs(l1-l2)+1e-4,l1+l2-1e-4);
  const u=nrm(d), a=(l1*l1-l2*l2+dl*dl)/(2*dl), h=Math.sqrt(Math.max(0,l1*l1-a*a));
  return add(add(A,mul(u,a)),mul(ccw(u),h*bend));
}
function angAt(J,P,Q){const a=nrm(sub(P,J)),b=nrm(sub(Q,J));return Math.acos(clamp(dot(a,b),-1,1))/D2R}
function torque(J,F){return cross(sub(F.p,J),mul(F.d,F.m??1))}
function perpFoot(J,F){return add(F.p,mul(F.d,dot(sub(J,F.p),F.d)))}
function armLen(J,F){return Math.abs(cross(sub(J,F.p),F.d))}
// внешний момент на дистальный сегмент: close=true — внешняя сила «закрывает» сустав
function demand(J,distal,proximal,forces){
  let M=0; for(const F of forces) M+=torque(J,F);
  const c=cross(sub(distal,J),sub(proximal,J));
  return {M:Math.abs(M), close:M*c>0, raw:M};
}
function shoulderDemand(S,forces,face){let M=0;for(const F of forces)M+=torque(S,F);return {M:Math.abs(M),toFlex:M*face>0}}
function solveOnLine(R0,u,A,D){ // точка R0+u*s на расстоянии D от A (берём дальний корень)
  const b=sub(R0,A), bu=dot(b,u), c=dot(b,b)-D*D, disc=bu*bu-c;
  return add(R0,mul(u,-bu+Math.sqrt(Math.max(0,disc))));
}
// доля бицепса бедра в разгибании бедра: при согнутом колене он укорочен
const hamsShare=kneeDeg=>clamp(.1+.45*(kneeDeg-90)/90,.08,.55);
const ant=(segDir,face)=>face>0?ccw(segDir):cw(segDir); // передняя сторона сегмента (segDir — от проксимального к дистальному)

function flatFoot(A,face,y0=0){return {heel:v(A.x-face*.07,y0),toe:v(A.x+face*.18,y0)}}
function arm(S,W,face){return ik(S,W,BODY.ua,BODY.fa,-face)}
function headOf(S,H,k=BODY.nk){return add(S,mul(nrm(sub(S,H)),k))}

const fmtCm=x=>`${Math.round(x*100)} см`;

// ===== Описание симуляций =====
// pose(p,t,cfg) -> {face, J:{S,H,K,A,E,W,head,heel,toe,L?}, props:[], forces:[], extra}
// analyze(P,p,cfg) -> {loads:{}, arms:[], warns:[]}
const SIMS = {};

// ---------- Ягодичный мост ----------
SIMS.hipthrust = {
  lo:'низ', hi:'верх (таз поднят)', con:'Таз вверх', ecc:'Опускай таз',
  params:[
    {id:'footX',label:'Стопы от скамьи',min:.62,max:1.32,step:.01,def:.96,fmt:fmtCm},
    {id:'push',label:'Усилие стопой',min:-12,max:12,step:1,def:0,fmt:x=>x<-3?'толкаю от себя':x>3?'тяну пятки к себе':'вертикально вниз'},
    {id:'arch',label:'Таз в верхней точке',min:0,max:20,step:1,def:0,fmt:x=>x<4?'на линии корпуса':`прогиб ${x}°`},
  ],
  handles:[{param:'footX',at:P=>P.J.A,axis:()=>v(1,0)}],
  presetsFor(){const b=Math.round((.53+BODY.th)*100)/100;return {glutes:{footX:b,push:0,arch:0},hams:{footX:b+.19,push:11,arch:0},quads:{footX:b-.27,push:-10,arch:0}}},
  pose(p,t){
    const face=1, S=v(.06,.46);
    const phi=lerp(-42,p.arch,t);
    const H=add(S,mul(dirA(phi),BODY.to));
    const A=v(p.footX,.08), K=ik(H,A,BODY.th,BODY.sh,1);
    const torsoAnt=ant(nrm(sub(H,S)),face);
    const bar=add(H,mul(torsoAnt,.13));
    const W=add(bar,v(-.02,0)), E=arm(S,W,face);
    const C=v(A.x+.03,0), g=dirA(90-p.push);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[
        {t:'line',a:v(-.5,.42),b:v(.04,.42),w:.07,c:'pad'},
        {t:'line',a:v(-.42,.38),b:v(-.42,0),w:.035,c:'mach'},{t:'line',a:v(-.04,.38),b:v(-.04,0),w:.035,c:'mach'},
        {t:'plate',p:bar,r:.225},{t:'vline',x:A.x}],
      forces:[{p:C,d:g,m:1,k:'grf',main:true},{p:bar,d:v(0,-1),m:.8,k:'load'}]};
  },
  analyze(P,p){
    const {H,K,A,S}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F), hp=demand(H,K,S,F), kA=angAt(K,H,A), hs=hamsShare(kA);
    const L={glutes:0,hams:0,quads:0,erectors:0};
    if(hp.close){L.glutes+=hp.M*(1-hs);L.hams+=hp.M*hs}
    if(kn.close)L.quads+=kn.M; else L.hams+=kn.M;
    if(p.arch>5){const x=hp.M*(p.arch-5)/15*.45;L.erectors+=x;L.glutes-=x*.6}
    const warns=[];
    return {loads:L,kneeAng:kA,arms:[{J:H,F:F[0],m:'glutes'},{J:K,F:F[0],m:kn.close?'quads':'hams'}],warns};
  },
  check(bot,top,p){
    const w=[]; const k=top.kneeAng;
    if(p.arch>7)w.push({lv:'bad',tx:'Переразгибание поясницы вверху: таз уходит выше линии корпуса. Подкрути таз назад, рёбра вниз — ягодицы сократятся сильнее, а поясница разгрузится.'});
    if(k<78)w.push({lv:'warn',tx:`Стопы близко: колено в верхней точке ${Math.round(k)}° — растёт работа квадрицепса.`});
    if(k>112)w.push({lv:'warn',tx:`Стопы далеко: колено ${Math.round(k)}° — включается бицепс бедра, его может сводить.`});
    if(!w.length)w.push({lv:'ok',tx:`Голень почти вертикальна, колено вверху ${Math.round(k)}° — классическая постановка на ягодицы.`});
    return w;
  }
};

// ---------- Жим ногами (45° и горизонтальный) ----------
SIMS.legpress = {
  lo:'низ (колени у груди)', hi:'верх', con:'Жми платформу', ecc:'Опускай платформу',
  params:[
    {id:'fh',label:'Стопы на платформе',min:-.14,max:.18,step:.01,def:.02,fmt:x=>(x>.06?'высоко':x<-.05?'низко':'по центру')+` (${x>0?'+':''}${Math.round(x*100)} см)`},
    {id:'depth',label:'Глубина',min:0,max:1,step:.05,def:.6,fmt:x=>`${Math.round(x*100)}%`},
  ],
  handles:[{param:'fh',at:P=>P.extra.C,axis:P=>P.extra.q}],
  presets:{glutes:{fh:.10,depth:.55},hams:{fh:.14,depth:.4},quads:{fh:-.07,depth:.55},adductors:{fh:.06,depth:.7}},
  pose(p,t,cfg){
    const face=1, rail=cfg.rail??45, back=cfg.back??35;
    const H=v(0,.45), S=add(H,mul(dirA(180-back),BODY.to));
    const r=dirA(rail), q=ccw(r);
    const O=add(H,mul(q,.10));
    const D=lerp(lerp(.68,.47,p.depth),.82,t);
    const off=add(mul(r,-.08),mul(q,p.fh-.03));
    const A=solveOnLine(add(O,off),r,H,D);
    const P0=sub(A,off), C=add(P0,mul(q,p.fh));
    const K=ik(H,A,BODY.th,BODY.sh,face);
    const tdir=nrm(sub(H,S)), post=mul(ant(tdir,face),-1), up=mul(tdir,-1);
    const W=add(H,v(.10,.05)), E=arm(S,W,face);
    const platA=add(P0,add(mul(q,-.26),mul(r,.03))), platB=add(P0,add(mul(q,.32),mul(r,.03)));
    const railA=add(O,mul(r,.25)), railB=add(O,mul(r,1.45));
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel:add(C,mul(q,-.08)),toe:add(C,mul(q,.15))},
      props:[
        {t:'line',a:railA,b:railB,w:.035,c:'rail'},
        {t:'line',a:v(railB.x,railB.y),b:v(railB.x,0),w:.04,c:'mach'},
        {t:'line',a:platA,b:platB,w:.05,c:'mach'},
        {t:'plate',p:add(P0,add(mul(r,.22),mul(q,.12))),r:.2},
        {t:'line',a:add(H,v(-.22,-.09)),b:add(H,v(.14,-.09)),w:.07,c:'pad'},
        {t:'line',a:add(add(H,mul(post,.12)),mul(up,-.04)),b:add(add(S,mul(post,.12)),mul(up,.18)),w:.07,c:'pad'},
        {t:'line',a:v(0,.36),b:v(0,0),w:.04,c:'mach'}],
      forces:[{p:C,d:mul(r,-1),m:1,k:'load',main:true}],
      extra:{C,q}};
  },
  analyze(P){
    const {H,K,A,S,toe}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F), hp=demand(H,K,S,F), an=demand(A,toe,K,F);
    const kA=angAt(K,H,A), hA=angAt(H,S,K), hs=hamsShare(kA)*.8, ad=hA<75?.2:.1;
    const L={quads:0,glutes:0,hams:0,adductors:0,calves:0};
    if(kn.close)L.quads+=kn.M; else L.hams+=kn.M;
    if(hp.close){L.glutes+=hp.M*(1-hs-ad);L.hams+=hp.M*hs;L.adductors+=hp.M*ad}
    if(an.close)L.calves+=an.M*.4;
    return {loads:L,kneeAng:kA,hipAng:hA,ankAng:angAt(A,K,toe),arms:[{J:K,F:F[0],m:kn.close?'quads':'hams'},{J:H,F:F[0],m:'glutes'}]};
  },
  check(bot,top){
    const w=[];
    if(bot.hipAng<40)w.push({lv:'bad',tx:`Угол в тазобедренном внизу ${Math.round(bot.hipAng)}°: таз подкручивается и отрывается от спинки — нагрузка уходит на поясничные диски. Уменьши глубину или подними стопы.`});
    if(bot.ankAng<60)w.push({lv:'warn',tx:'Сильное сгибание голеностопа внизу — пятки будут отрываться от платформы. Подними стопы выше.'});
    if(top.kneeAng>172)w.push({lv:'warn',tx:'Колени почти в замке вверху — оставь их чуть согнутыми.'});
    if(!w.length)w.push({lv:'ok',tx:'Таз остаётся на спинке, пятки на платформе — безопасная амплитуда.'});
    return w;
  }
};

// ---------- Гакк-машина ----------
SIMS.hack = {
  lo:'низ', hi:'верх', con:'Вставай', ecc:'Опускайся',
  params:[
    {id:'fx',label:'Стопы на платформе',min:0,max:.36,step:.01,def:.14,fmt:x=>(x<.08?'низко':x>.24?'высоко':'по центру')+` (${fmtCm(x)})`},
    {id:'depth',label:'Глубина',min:0,max:1,step:.05,def:.7,fmt:x=>`${Math.round(x*100)}%`},
  ],
  handles:[{param:'fx',at:P=>P.J.A,axis:()=>v(1,0)}],
  presets:{quads:{fx:.04,depth:.85},glutes:{fx:.30,depth:.85},adductors:{fx:.2,depth:1}},
  pose(p,t){
    const face=1, u=dirA(180-55), R0=v(-.06,.06);
    const A=v(p.fx,.14), C=v(p.fx+.04,.06);
    const D=lerp(lerp(.62,.38,p.depth),.83,t);
    const H=solveOnLine(R0,u,A,D), S=add(H,mul(u,BODY.to));
    const K=ik(H,A,BODY.th,BODY.sh,face);
    const tdir=nrm(sub(H,S)), an=ant(tdir,face), post=mul(an,-1);
    const W=add(S,add(mul(an,.08),mul(u,.06))), E=arm(S,W,face);
    const padA=add(add(H,mul(post,.12)),mul(u,-.08)), padB=add(add(S,mul(post,.12)),mul(u,.1));
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel:v(A.x-.07,.06),toe:v(A.x+.18,.06)},
      props:[
        {t:'line',a:add(R0,add(mul(post,.24),mul(u,.1))),b:add(R0,add(mul(post,.24),mul(u,2.0))),w:.035,c:'rail'},
        {t:'line',a:padA,b:padB,w:.07,c:'pad'},
        {t:'line',a:add(S,add(mul(u,.07),mul(post,.06))),b:add(S,add(mul(u,.07),mul(an,.12))),w:.06,c:'pad'},
        {t:'plate',p:add(S,add(mul(post,.38),mul(u,-.05))),r:.2},
        {t:'line',a:v(-.25,.03),b:v(.62,.03),w:.06,c:'mach'}],
      forces:[{p:C,d:u,m:1,k:'grf',main:true},{p:add(S,mul(u,.06)),d:mul(u,-1),m:.7,k:'load'}]};
  },
  analyze(P){
    const {H,K,A,S,toe}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F), hp=demand(H,K,S,F);
    const kA=angAt(K,H,A), hA=angAt(H,S,K), hs=hamsShare(kA)*.8, ad=hA<75?.2:.1;
    const L={quads:0,glutes:0,hams:0,adductors:0};
    if(kn.close)L.quads+=kn.M; else L.hams+=kn.M;
    if(hp.close){L.glutes+=hp.M*(1-hs-ad);L.hams+=hp.M*hs;L.adductors+=hp.M*ad}
    return {loads:L,kneeAng:kA,hipAng:hA,ankAng:angAt(A,K,toe),arms:[{J:K,F:F[0],m:kn.close?'quads':'hams'},{J:H,F:F[0],m:'glutes'}]};
  },
  check(bot,top){
    const w=[];
    if(bot.ankAng<55)w.push({lv:'warn',tx:'Колени далеко за носками, голеностоп сильно согнут — пятки будут отрываться. Поставь стопы выше.'});
    if(bot.hipAng<50)w.push({lv:'bad',tx:'Внизу таз уезжает от спинки (подворот) — поясница сгибается под нагрузкой. Уменьши глубину.'});
    if(top.kneeAng>172)w.push({lv:'warn',tx:'Колени в замке вверху.'});
    if(!w.length)w.push({lv:'ok',tx:'Пятки на платформе, таз на спинке.'});
    return w;
  }
};

// ---------- Присед в Смите ----------
SIMS.smith = {
  lo:'низ', hi:'верх', con:'Вставай', ecc:'Опускайся',
  params:[
    {id:'fx',label:'Стопы относительно грифа',min:-.04,max:.34,step:.01,def:.08,fmt:x=>x<.03?'под грифом':`${fmtCm(x)} впереди`},
    {id:'depth',label:'Глубина',min:0,max:1,step:.05,def:.75,fmt:x=>`${Math.round(x*100)}%`},
  ],
  handles:[{param:'fx',at:P=>P.J.A,axis:()=>v(1,0)}],
  presets:{quads:{fx:0,depth:.85},glutes:{fx:.27,depth:.95},adductors:{fx:.18,depth:1}},
  pose(p,t){
    const face=1;
    const aB=clamp(38-70*p.fx,8,45), aBot=4+(aB-4)*(.4+.6*p.depth), al=lerp(aBot,4,t);
    const D=lerp(lerp(.66,.40,p.depth),.85,t);
    const A=v(p.fx,.08);
    const hx=-BODY.to*Math.sin(al*D2R), dx=hx-A.x, Dd=Math.max(D,Math.abs(dx)+.03);
    const H=v(hx,A.y+Math.sqrt(Dd*Dd-dx*dx)), S=v(0,H.y+BODY.to*Math.cos(al*D2R));
    const K=ik(H,A,BODY.th,BODY.sh,face);
    const tdir=nrm(sub(H,S)), post=mul(ant(tdir,face),-1);
    const bar=add(add(S,mul(post,.04)),v(0,.04));
    const W=add(bar,v(.03,0)), E=arm(S,W,face);
    const C=v(A.x+.05,0);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'line',a:v(bar.x-.18,0),b:v(bar.x-.18,2.1),w:.03,c:'rail'},{t:'plate',p:bar,r:.22}],
      forces:[{p:C,d:nrm(sub(bar,C)),m:1,k:'grf',main:true},{p:bar,d:v(0,-1),m:.8,k:'load'}],
      extra:{bar,al}};
  },
  analyze(P){
    const {H,K,A,S,toe}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F), hp=demand(H,K,S,F);
    const kA=angAt(K,H,A), hA=angAt(H,S,K), hs=hamsShare(kA)*.8, ad=hA<75?.2:.1;
    const er=Math.abs(torque(H,P.forces[1]))*.5;
    const L={quads:0,glutes:0,hams:0,adductors:0,erectors:er};
    if(kn.close)L.quads+=kn.M; else L.hams+=kn.M;
    if(hp.close){L.glutes+=hp.M*(1-hs-ad);L.hams+=hp.M*hs;L.adductors+=hp.M*ad}
    return {loads:L,kneeAng:kA,hipAng:hA,lean:P.extra.al,ankAng:angAt(A,K,toe),arms:[{J:K,F:F[0],m:kn.close?'quads':'hams'},{J:H,F:F[0],m:'glutes'}]};
  },
  check(bot,top,p){
    const w=[];
    if(bot.lean>36)w.push({lv:'warn',tx:`Наклон корпуса внизу ${Math.round(bot.lean)}° — растёт нагрузка на поясницу. Поставь стопы чуть впереди грифа.`});
    if(bot.ankAng<55)w.push({lv:'warn',tx:'Колени сильно уходят вперёд — пятки могут оторваться.'});
    if(p.fx>.3)w.push({lv:'warn',tx:'Стопы далеко впереди: тело «висит» на грифе, внизу легко подкрутить таз. Не опускайся глубже, чем держишь ровную спину.'});
    if(!w.length)w.push({lv:'ok',tx:'Корпус и стопы в рабочем положении.'});
    return w;
  }
};

// ---------- Разгибание ног ----------
SIMS.legext = {
  lo:'старт (колено согнуто)', hi:'верх (нога прямая)', con:'Разгибай', ecc:'Опускай медленно',
  params:[
    {id:'b',label:'Колено относительно оси',min:-.08,max:.08,step:.005,def:.035,fmt:x=>Math.abs(x)<.012?'на оси ✓':(x>0?`впереди на ${fmtCm(x)}`:`позади на ${fmtCm(-x)}`)},
    {id:'pad',label:'Валик на голени',min:.2,max:.4,step:.01,def:.37,fmt:x=>x>.33?'над стопой':x<.26?'высоко на голени':'середина голени'},
    {id:'recline',label:'Наклон спинки',min:0,max:30,step:1,def:8,fmt:x=>`${x}°`},
  ],
  handles:[{param:'b',at:P=>P.J.K,axis:()=>v(1,0)}],
  presets:{quads:{b:0,pad:.37,recline:22}},
  pose(p,t){
    const face=1, M=v(.44,.55), H=v(p.b,.55), K=v(.44+p.b,.55);
    const S=add(H,mul(dirA(90+p.recline),BODY.to));
    const th=lerp(-95,-8,t), Ld=dirA(th);
    const Pc=add(M,mul(Ld,p.pad));
    const sd=nrm(sub(Pc,K)), A=add(K,mul(sd,BODY.sh)), sa=ant(sd,face);
    const R=add(Pc,mul(ccw(Ld),.065));
    const W=add(H,v(.16,-.02)), E=arm(S,W,face);
    const tdir=nrm(sub(H,S)), post=mul(ant(tdir,face),-1);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel:add(add(A,mul(sd,.08)),mul(sa,-.06)),toe:add(add(A,mul(sd,.08)),mul(sa,.17))},
      props:[
        {t:'line',a:v(-.2,.46),b:v(.36,.46),w:.07,c:'pad'},
        {t:'line',a:add(add(H,mul(post,.12)),v(0,-.04)),b:add(add(S,mul(post,.12)),mul(nrm(sub(S,H)),.12)),w:.07,c:'pad'},
        {t:'line',a:v(.12,.42),b:v(.12,0),w:.04,c:'mach'},
        {t:'line',a:M,b:R,w:.03,c:'mach'},{t:'circle',p:R,r:.045,c:'pad'},
        {t:'axis',p:M}],
      forces:[{p:Pc,d:cw(Ld),m:.37/p.pad,k:'load',main:true}],
      extra:{M,Pc}};
  },
  analyze(P,p){
    const {H,K,A}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F);
    return {loads:{quads:kn.close?kn.M:0,hams:kn.close?0:kn.M},padDist:len(sub(P.extra.Pc,K)),arms:[{J:K,F:F[0],m:'quads'}]};
  },
  check(bot,top,p){
    const w=[]; const slide=Math.abs(bot.padDist-top.padDist);
    if(Math.abs(p.b)>.015)w.push({lv:'bad',tx:`Ось колена смещена на ${fmtCm(Math.abs(p.b))} от оси тренажёра — валик проезжает по голени ${fmtCm(slide)}, на колено действует сдвиг. Подвинь спинку ${p.b>0?'назад':'вперёд'}.`});
    if(p.pad<.27)w.push({lv:'warn',tx:`Валик высоко на голени — давление на голень в ${(0.37/p.pad).toFixed(1)} раза больше. Момент на колене тот же: его задаёт тренажёр. Опусти валик к стопе.`});
    if(p.recline>15)w.push({lv:'ok',tx:'Откинутая спинка: бедро разогнуто, прямая мышца бедра работает сильнее.'});
    if(!w.length)w.push({lv:'ok',tx:'Колено на оси, валик над стопой — правильная настройка.'});
    return w;
  }
};

// ---------- Сгибание ног лёжа ----------
SIMS.legcurl = {
  lo:'старт (нога прямая)', hi:'верх (пятка к ягодице)', con:'Сгибай', ecc:'Разгибай медленно',
  params:[
    {id:'hf',label:'Изгиб скамьи под тазом',min:0,max:35,step:1,def:15,fmt:x=>`${x}°`},
    {id:'ankle',label:'Стопа',min:0,max:1,step:.05,def:.8,fmt:x=>x>.6?'носок на себя':x<.35?'носок оттянут':'нейтрально'},
    {id:'pad',label:'Валик',min:.28,max:.42,step:.01,def:.39,fmt:x=>x>.36?'над пяткой':'на икрах'},
  ],
  presets:{hams:{hf:30,ankle:.1,pad:.39},calves:{hf:15,ankle:1,pad:.39}},
  pose(p,t){
    const face=-1, K=v(.40,.72), H=add(K,v(-BODY.th,0));
    const S=add(H,mul(dirA(180+p.hf),BODY.to));
    const th=lerp(4,118,t), sd=dirA(th), A=add(K,mul(sd,BODY.sh));
    const sa=ant(sd,face), post=mul(sa,-1);
    const Pc=add(K,mul(sd,p.pad)), R=add(Pc,mul(post,.065));
    const toe=add(A,add(mul(sd,lerp(.17,.06,p.ankle)),mul(sa,lerp(.04,.16,p.ankle))));
    const heel=add(A,add(mul(sd,.06),mul(sa,-.05)));
    const W=add(S,v(-.05,-.12)), E=arm(S,W,face);
    const hd=headOf(S,H);
    return {face,J:{S,H,K,A,E,W,head:add(hd,v(0,.03)),heel,toe},
      props:[
        {t:'line',a:v(.38,.62),b:H.x<0?v(-.04,.62):v(H.x,.62),w:.07,c:'pad'},
        {t:'line',a:v(H.x+.02,.62),b:add(v(H.x,.62),mul(dirA(180+p.hf),.62)),w:.07,c:'pad'},
        {t:'line',a:v(.1,.58),b:v(.1,0),w:.04,c:'mach'},
        {t:'line',a:K,b:R,w:.03,c:'mach'},{t:'circle',p:R,r:.045,c:'pad'},{t:'axis',p:K}],
      forces:[{p:Pc,d:cw(sd),m:.39/p.pad,k:'load',main:true}]};
  },
  analyze(P,p){
    const {H,K,A}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F), g=lerp(.04,.24,p.ankle);
    const L={hams:kn.M*(1-g),calves:kn.M*g};
    return {loads:L,arms:[{J:K,F:F[0],m:'hams'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.pad<.34)w.push({lv:'warn',tx:'Валик на икрах — он давит на мышцу. Опусти его к ахиллу, над пяткой.'});
    if(p.hf>=20)w.push({lv:'ok',tx:`Таз выше коленей (${p.hf}°) — бицепс бедра растянут со стороны таза, это даёт больший стимул.`});
    else w.push({lv:'warn',tx:'Скамья почти плоская — бицепс бедра укорочен. Если тренажёр позволяет, выбери изогнутую скамью или подложи подушку под таз.'});
    return w;
  }
};

// ---------- Гиперэкстензия 45° ----------
SIMS.hyper = {
  lo:'низ (корпус свисает)', hi:'верх (тело прямое)', con:'Поднимай корпус', ecc:'Опускайся',
  params:[
    {id:'pad',label:'Валик относительно таза',min:-.12,max:.1,step:.01,def:-.05,fmt:x=>x<-.015?`ниже таза на ${fmtCm(-x)}`:x>.015?`выше таза на ${fmtCm(x)}`:'на уровне таза'},
    {id:'round',label:'Поясница',min:0,max:1,step:.05,def:0,fmt:x=>x<.2?'ровная':x<.6?'слегка округляется':'сгибается'},
    {id:'plate',label:'Отягощение',min:0,max:1,step:.1,def:0,fmt:x=>x<.05?'без веса':`блин ×${(x*20).toFixed(0)} кг`},
  ],
  handles:[{param:'pad',at:P=>P.extra.padPt,axis:P=>P.extra.e}],
  presets:{glutes:{pad:-.07,round:0,plate:.5},hams:{pad:-.05,round:0,plate:.5},erectors:{pad:.06,round:.8,plate:0}},
  pose(p,t){
    const face=1, e=dirA(45), A=v(0,.2);
    const K=add(A,mul(e,BODY.sh)), H=add(K,mul(e,BODY.th));
    const blockHip=p.pad>0?clamp(1-p.pad/.06,0,1):1;
    const hipFrac=blockHip*(1-.55*p.round), spineFrac=1-hipFrac;
    const Fl=lerp(100,0,t), hip=Fl*hipFrac, lum=Fl*spineFrac;
    const ld=rotV(e,-hip), ud=rotV(ld,-lum);
    const L=add(H,mul(ld,.22)), S=add(L,mul(ud,.28));
    const an=ant(mul(e,-1),face);
    const padPt=add(H,mul(e,p.pad)), R=add(padPt,mul(an,.11));
    const sa=ant(mul(ud,-1),face);
    const W=add(sub(S,mul(ud,.14)),mul(sa,.08)), E=arm(S,W,face);
    const heelP=add(A,mul(an,-.06));
    return {face,J:{S,H,K,A,E,W,L,head:add(S,mul(ud,BODY.nk)),heel:add(A,mul(e,-.08)),toe:add(add(A,mul(e,-.06)),mul(an,.17))},
      props:[
        {t:'line',a:v(-.22,.04),b:add(R,v(.02,-.05)),w:.04,c:'mach'},
        {t:'line',a:add(add(A,mul(e,-.12)),mul(an,.1)),b:add(add(A,mul(e,-.12)),mul(an,.32)),w:.05,c:'mach'},
        {t:'circle',p:add(heelP,mul(e,.05)),r:.045,c:'pad'},
        {t:'circle',p:R,r:.08,c:'pad'},
        ...(p.plate>.05?[{t:'plate',p:add(W,mul(sa,.02)),r:.11+.06*p.plate}]:[])],
      forces:[{p:add(L,mul(ud,.06)),d:v(0,-1),m:.5,k:'load',main:true},{p:S,d:v(0,-1),m:.25,k:'load'},...(p.plate>.05?[{p:W,d:v(0,-1),m:.6*p.plate,k:'load'}]:[])],
      extra:{padPt,e,hipFrac,spineFrac,blockHip}};
  },
  analyze(P,p){
    const {H,L}=P.J, F=P.forces;
    let mH=0,mL=0; for(const f of F){mH+=torque(H,f);mL+=torque(L,f)}
    const hipM=Math.abs(mH)*P.extra.blockHip, lumM=Math.abs(mL);
    const er=lumM*(.35+.75*P.extra.spineFrac);
    // для отображения рычага — суммарная сила тяжести, приложенная в центре масс
    let m=0,cx=0,cy=0; for(const f of F){m+=f.m;cx+=f.p.x*f.m;cy+=f.p.y*f.m}
    const G={p:v(cx/m,cy/m),d:v(0,-1),m};
    return {loads:{glutes:hipM*.5,hams:hipM*.5,erectors:er},arms:[{J:H,F:G,m:'glutes'},{J:L,F:G,m:'erectors'}]};
  },
  forceShown:P=>{let m=0,cx=0,cy=0;for(const f of P.forces){m+=f.m;cx+=f.p.x*f.m;cy+=f.p.y*f.m}return {p:v(cx/m,cy/m),d:v(0,-1),m,k:'load'}},
  check(bot,top,p){
    const w=[];
    if(p.pad>.015)w.push({lv:'bad',tx:'Валик выше таза: тазобедренный сустав заблокирован, движение идёт за счёт сгибания поясницы. Если цель — ягодицы, опусти валик на 3–5 см ниже паховой складки.'});
    if(p.round>.5&&p.pad<=.015)w.push({lv:'warn',tx:'Поясница сгибается под нагрузкой. Так тренируют разгибатели спины — только с небольшим весом и медленно.'});
    if(!w.length)w.push({lv:'ok',tx:'Таз свободно сгибается над валиком — работают ягодицы и бицепс бедра.'});
    return w;
  }
};

// ---------- Икры ----------
SIMS.calf = {
  lo:'низ (пятка опущена)', hi:'верх (на носках)', con:'Вверх на носки', ecc:'Опускай пятки',
  params:[
    {id:'knee',label:'Сгибание колена',min:0,max:90,step:5,def:0,fmt:x=>x<10?'колено прямое':x>70?`${x}° (сидя)`:`${x}°`},
    {id:'rom',label:'Амплитуда внизу',min:.2,max:1,step:.05,def:1,fmt:x=>x>.8?'полная':x<.45?'короткая':'средняя'},
  ],
  presets:{calves:{knee:0,rom:1},soleus:{knee:90,rom:1}},
  paramsFor(cfg){const b=this.params.map(x=>({...x}));b[0].def=cfg.knee||0;return b},
  pose(p,t,cfg){
    const face=1, B=v(.12,.25), be=lerp(-22*p.rom,30,t);
    const e=v(Math.cos(be*D2R),-Math.sin(be*D2R)), n=ccw(e);
    const heel=sub(B,mul(e,.20)), toe=add(B,mul(e,.05));
    const A=add(sub(B,mul(e,.14)),mul(n,.08));
    const k=p.knee, tau=k*.12;
    const K=add(A,mul(dirA(90-tau),BODY.sh)), H=add(K,mul(dirA(90+k-tau),BODY.th));
    const S=add(H,mul(dirA(92),BODY.to));
    const seated=k>55;
    const W=seated?add(K,v(-.06,.1)):add(S,v(.08,.02)), E=arm(S,W,face);
    const props=[{t:'line',a:v(.1,.125),b:v(.5,.125),w:.25,c:'mach'}];
    if(seated){props.push({t:'line',a:v(H.x-.15,H.y-.1),b:v(H.x+.15,H.y-.1),w:.07,c:'pad'},{t:'line',a:v(H.x,H.y-.14),b:v(H.x,0),w:.04,c:'mach'},{t:'line',a:add(K,v(-.18,.08)),b:add(K,v(.06,.08)),w:.06,c:'pad'},{t:'plate',p:add(K,v(.2,.1)),r:.18})}
    else props.push({t:'line',a:add(S,v(-.1,.07)),b:add(S,v(.1,.07)),w:.06,c:'pad'},{t:'line',a:add(S,v(-.2,.07)),b:v(-.2,0),w:.04,c:'rail'});
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel,toe},props,forces:[{p:B,d:v(0,1),m:1,k:'grf',main:true}],extra:{B}};
  },
  analyze(P,p){
    const {A,K,toe}=P.J, F=[P.forces[0]];
    const an=demand(A,toe,K,F), g=.08+.54*Math.cos(p.knee*D2R);
    return {loads:an.close?{calves:an.M*g,soleus:an.M*(1-g)}:{calves:0,soleus:0},arms:[{J:A,F:F[0],m:p.knee>45?'soleus':'calves'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.rom<.6)w.push({lv:'warn',tx:'Короткая амплитуда внизу — икры не растягиваются. Опускай пятку ниже уровня платформы с паузой 1–2 с.'});
    if(p.knee>=15&&p.knee<=55)w.push({lv:'warn',tx:'Промежуточный угол колена: работают обе мышцы, но ни одна не в лучшем положении. Выбери прямые колени или сидя.'});
    if(!w.length)w.push({lv:'ok',tx:p.knee<15?'Колени прямые — максимум работы икроножной.':'Колени согнуты — икроножная укорочена, работает камбаловидная.'});
    return w;
  }
};

// ---------- Горизонтальная тяга ----------
SIMS.row = {
  lo:'старт (руки вытянуты)', hi:'конец (рукоять у корпуса)', con:'Тяни локтями', ecc:'Отпускай медленно',
  params:[
    {id:'lean',label:'Наклон корпуса',min:-15,max:28,step:1,def:4,fmt:x=>x<-2?`вперёд ${-x}°`:x>2?`назад ${x}°`:'вертикально'},
    {id:'path',label:'Тянешь к',min:0,max:1,step:.05,def:.25,fmt:x=>x<.35?'поясу, локти у корпуса':x>.65?'груди, локти в стороны':'низу груди'},
    {id:'dev',label:'Предплечье и трос',min:0,max:40,step:1,def:14,fmt:x=>x<6?'на одной линии ✓':`угол ${x}° — тянешь руками`},
  ],
  presets:{lats:{lean:5,path:.05,dev:2},upperback:{lean:6,path:.9,dev:2},reardelt:{lean:2,path:1,dev:2},biceps:{lean:4,path:.35,dev:30}},
  pose(p,t){
    const face=1, H=v(0,.48), S=add(H,mul(dirA(90+p.lean),BODY.to));
    const A=v(.74,.30), K=ik(H,A,BODY.th,BODY.sh,face);
    const P=v(1.08,.42);
    const tdir=nrm(sub(H,S));
    const a0=Math.atan2(P.y-S.y,P.x-S.x)/D2R;
    const down=Math.atan2(tdir.y,tdir.x)/D2R, a1=down-(35+40*p.path);
    const E=add(S,mul(dirA(lerp(a0,a1,ease(t))),BODY.ua));
    const d=rotV(nrm(sub(P,E)),-p.dev*Math.sin(Math.PI*Math.min(1,t*1.4+.15)));
    const W=add(E,mul(d,BODY.fa));
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel:v(A.x-.02,A.y-.08),toe:v(A.x+.06,A.y+.12)},
      props:[{t:'line',a:v(-.25,.4),b:v(.4,.4),w:.07,c:'pad'},{t:'line',a:v(0,.36),b:v(0,0),w:.04,c:'mach'},
        {t:'line',a:v(.8,.15),b:v(.8,.5),w:.05,c:'mach'},{t:'circle',p:P,r:.05,c:'mach'},{t:'line',a:v(1.08,.42),b:v(1.08,0),w:.04,c:'mach'},
        {t:'cable',a:W,b:P}],
      forces:[{p:W,d:nrm(sub(P,W)),m:1,k:'cable',main:true}]};
  },
  analyze(P,p){
    const {S,E,W,H}=P.J, F=[P.forces[0]];
    const sh=shoulderDemand(S,F,P.face), el=demand(E,W,S,F);
    const L={lats:0,upperback:0,reardelt:0,biceps:0,erectors:0};
    L.lats+=sh.M*lerp(.62,.26,p.path);L.upperback+=sh.M*lerp(.28,.46,p.path);L.reardelt+=sh.M*lerp(.10,.28,p.path);
    L.biceps+=el.M+sh.M*.08;
    L.erectors=Math.abs(torque(H,F[0]))*.1*(1+Math.max(0,p.lean)/12);
    return {loads:L,arms:[{J:S,F:F[0],m:'lats'},{J:E,F:F[0],m:'biceps'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.lean>15)w.push({lv:'warn',tx:`Отклон назад ${p.lean}° — раскачка: нагрузку забирают поясница и инерция.`});
    if(p.lean<-6)w.push({lv:'bad',tx:'Корпус наклонён вперёд в конце тяги — спина округляется под нагрузкой. Сядь ровно.'});
    if(p.dev>12)w.push({lv:'warn',tx:'Предплечье не на линии троса — сгибается локоть, работает бицепс. Тяни локтями, кисти — просто крючки.'});
    if(!w.length)w.push({lv:'ok',tx:'Предплечье продолжает линию троса, корпус неподвижен — тянет спина.'});
    return w;
  }
};

// ---------- Верхняя тяга (вид спереди) ----------
SIMS.pulldown = {
  frontal:true,
  lo:'верх (руки вытянуты)', hi:'низ (гриф у груди)', con:'Тяни локти вниз', ecc:'Отпускай медленно',
  params:[
    {id:'grip',label:'Ширина хвата',min:.12,max:.46,step:.01,def:.36,fmt:x=>`${Math.round(x*200)} см`},
    {id:'hold',label:'Хват',type:'choice',options:[['over','Прямой (ладони от себя)'],['under','Обратный (ладони к себе)']],def:'over'},
  ],
  handles:[{param:'grip',at:P=>P.J.W,axis:()=>v(1,0)}],
  presets:{lats:{grip:.31,hold:'over'},upperback:{grip:.42,hold:'over'},reardelt:{grip:.44,hold:'over'},biceps:{grip:.15,hold:'under'}},
  pose(p,t){
    const S=v(.2,0), ua=BODY.ua*.8;
    const yt=Math.sqrt(Math.max(.02,Math.pow(ua+BODY.fa-.02,2)-Math.pow(p.grip-.2,2)));
    const W=v(p.grip,lerp(yt,.1,ease(t)));
    const E=ik(S,W,ua,BODY.fa,-1);
    const J={S,W,E,Sl:v(-S.x,S.y),Wl:v(-W.x,W.y),El:v(-E.x,E.y)};
    return {face:1,frontal:true,kind:'pull',J,
      props:[{t:'line',a:v(-.62,W.y),b:v(.62,W.y),w:.03,c:'mach'},{t:'cable',a:v(0,W.y),b:v(0,1.25)},{t:'circle',p:v(0,1.25),r:.06,c:'mach'},
        {t:'line',a:v(-.3,-.62),b:v(.3,-.62),w:.07,c:'pad'}],
      forces:[{p:W,d:v(0,1),m:1,k:'cable',main:true},{p:J.Wl,d:v(0,1),m:1,k:'cable'}]};
  },
  analyze(P,p){
    const {S,E,W}=P.J, F=[P.forces[0]];
    const shM=Math.abs(torque(S,F[0]))+.1, el=demand(E,W,S,F);
    const wide=clamp((p.grip-.28)/.16,0,1);
    const L={lats:shM*lerp(.74,.52,wide),upperback:shM*lerp(.16,.30,wide),reardelt:shM*lerp(.10,.18,wide),biceps:0};
    L.biceps=el.M*(p.hold==='under'?1.2:.8)+shM*(p.hold==='under'?.18:.05);
    return {loads:L,arms:[{J:S,F:F[0],m:'lats'},{J:E,F:F[0],m:'biceps'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.grip>.42)w.push({lv:'warn',tx:'Очень широкий хват — амплитуда короче, плечевому суставу теснее. Больше работает середина спины.'});
    if(p.grip<.2)w.push({lv:'ok',tx:'Узкий хват: движение больше похоже на разгибание плеча, растёт работа бицепса.'});
    if(!w.length)w.push({lv:'ok',tx:'Внизу предплечья почти вертикальны — тянет спина, бицепс помогает.'});
    return w;
  }
};

// ---------- Жимы: фронтальная проекция (жим лёжа, жим сидя, жим над головой) ----------
SIMS.press2 = {
  frontal:true,
  lo:'низ', hi:'верх (руки выпрямлены)', con:'Жми', ecc:'Опускай',
  params:[
    {id:'grip',label:'Ширина хвата',min:.17,max:.46,step:.01,def:.33,fmt:x=>`${Math.round(x*200)} см`},
    {id:'flare',label:'Локти от корпуса',min:20,max:90,step:1,def:60,fmt:x=>`${x}°`},
  ],
  paramsFor(cfg){
    const b=this.params.map(x=>({...x}));
    if(cfg.kind==='bench')b.push({id:'incl',label:'Наклон скамьи',min:0,max:45,step:5,def:0,fmt:x=>x?`${x}°`:'горизонтально'});
    if(cfg.kind==='ohp'){b[0].def=.30;b[1].def=55;b[1].label='Локти от фронтальной плоскости';b[1].fmt=x=>x>80?'строго в стороны':`${90-x}° вперёд`}
    if(cfg.kind==='machine'){b[0].label='Ширина рукояток'}
    return b;
  },
  handles:[{param:'grip',at:P=>P.J.W,axis:()=>v(1,0)}],
  presetsFor(cfg){
    if(cfg.kind==='ohp')return {frontdelt:{grip:.26,flare:35},middelt:{grip:.36,flare:72},triceps:{grip:.2,flare:30}};
    const p={chest:{grip:.37,flare:65,incl:0},triceps:{grip:.19,flare:30,incl:0},frontdelt:{grip:.27,flare:40,incl:35}};
    return p;
  },
  pose(p,t,cfg){
    const ohp=cfg.kind==='ohp';
    const S=v(.2,0), ua=BODY.ua*Math.sin(p.flare*D2R);
    const yb=ohp?.10:.11, yt=Math.sqrt(Math.max(.01,Math.pow(ua+BODY.fa-.02,2)-Math.pow(p.grip-.2,2)));
    const W=v(p.grip,lerp(yb,yt,t));
    const E=ik(S,W,Math.max(ua,.05),BODY.fa,-1);
    const J={S,W,E,Sl:v(-S.x,S.y),Wl:v(-W.x,W.y),El:v(-E.x,E.y)};
    const props=[];
    if(cfg.kind==='bench'){props.push({t:'line',a:v(-.16,-.17),b:v(.16,-.17),w:.07,c:'pad'},{t:'line',a:v(0,-.2),b:v(0,-.62),w:.05,c:'mach'},{t:'line',a:v(-.62,W.y),b:v(.62,W.y),w:.03,c:'mach'},{t:'plate',p:v(.66,W.y),r:.22},{t:'plate',p:v(-.66,W.y),r:.22},{t:'line',a:v(.8,-.62),b:v(.8,1.0),w:.03,c:'rail'},{t:'line',a:v(-.8,-.62),b:v(-.8,1.0),w:.03,c:'rail'})}
    if(cfg.kind==='machine'){props.push({t:'line',a:v(-.3,-.2),b:v(.3,-.2),w:.07,c:'pad'},{t:'line',a:add(W,v(0,-.06)),b:add(W,v(0,.06)),w:.04,c:'mach'},{t:'line',a:add(J.Wl,v(0,-.06)),b:add(J.Wl,v(0,.06)),w:.04,c:'mach'},{t:'line',a:add(W,v(.03,.03)),b:v(W.x+.18,1.0),w:.03,c:'rail'},{t:'line',a:add(J.Wl,v(-.03,.03)),b:v(-W.x-.18,1.0),w:.03,c:'rail'})}
    if(ohp){props.push({t:'line',a:v(-.62,W.y),b:v(.62,W.y),w:.03,c:'mach'},{t:'line',a:v(-.18,-.62),b:v(.18,-.62),w:.07,c:'pad'})}
    return {face:1,frontal:true,kind:cfg.kind,J,props,t,
      forces:[{p:W,d:v(0,-1),m:1,k:'load',main:true},{p:J.Wl,d:v(0,-1),m:1,k:'load'}]};
  },
  analyze(P,p,cfg){
    const {S,E,W}=P.J, F=[P.forces[0]];
    const shM=torque(S,F[0]); // >0 — тянет руку к средней линии; <0 — отводит (держат приводящие: грудь)
    const el=demand(E,W,S,F);
    const L={chest:0,frontdelt:0,middelt:0,triceps:0};
    const tuck=1-Math.sin(p.flare*D2R);
    // сагиттальная составляющая: локти ближе к корпусу — больше сгибание плеча
    const sag=.06*(1+1.6*tuck)*(.35+.65*(1-(P.t??.5)));
    if(cfg.kind==='ohp'){
      const m=Math.abs(shM); const fd=clamp(.35+.5*tuck,.3,.8); L.frontdelt+=m*fd+sag; L.middelt+=m*(1-fd);
    } else {
      const m=Math.abs(shM); let fd=clamp(.18+.45*tuck,.15,.55); if(p.incl)fd=clamp(fd+p.incl/45*.3,0,.75);
      if(shM<0){L.chest+=m*(1-fd);L.frontdelt+=m*fd} else {L.frontdelt+=m*.6;L.middelt+=m*.4}
      L.chest+=sag*(1-fd);L.frontdelt+=sag*fd;
    }
    if(el.close)L.triceps+=el.M;
    return {loads:L,arms:[{J:S,F:F[0],m:cfg.kind==='ohp'?'frontdelt':'chest'},{J:E,F:F[0],m:'triceps'}]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(cfg.kind==='ohp'){
      if(p.flare>82)w.push({lv:'warn',tx:'Локти строго в стороны — плечевой сустав в тесном положении. Выведи их на 20–30° вперёд (плоскость лопатки).'});
    } else {
      if(p.flare>80)w.push({lv:'bad',tx:'Локти разведены почти на 90° — плечо в уязвимом положении (импинджмент). Держи 45–70°.'});
      if(p.grip>.42)w.push({lv:'warn',tx:'Очень широкий хват — амплитуда короче, но нагрузка на плечевой сустав выше.'});
    }
    if(p.grip<.22)w.push({lv:'ok',tx:'Узкий хват: кисти внутри локтей — рычаг на локте растёт, акцент на трицепс.'});
    if(!w.length)w.push({lv:'ok',tx:'Предплечья почти вертикальны внизу — сила идёт без лишних моментов.'});
    return w;
  }
};

// ---------- Скамья Скотта ----------
SIMS.preacher = {
  lo:'старт (рука почти прямая)', hi:'верх (рука согнута)', con:'Сгибай', ecc:'Опускай медленно',
  params:[
    {id:'pad',label:'Наклон подушки',min:25,max:65,step:1,def:45,fmt:x=>x<38?`${x}° (крутая)`:x>52?`${x}° (пологая)`:`${x}°`},
    {id:'res',label:'Сопротивление',type:'choice',options:[['free','Штанга / гантель'],['cam','Тренажёр с кулачком']],def:'free'},
  ],
  presets:{biceps:{pad:45,res:'free'}},
  pose(p,t){
    const face=1, S=v(0,1.2), ad=dirA(-90+p.pad), E=add(S,mul(ad,BODY.ua));
    const a0=-90+p.pad, th=lerp(a0+14,a0+138,t), W=add(E,mul(dirA(th),BODY.fa));
    const H=v(-.06,.7), K=v(.36,.66), A=v(.36,.08);
    const und=cw(ad);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'line',a:add(S,add(mul(und,.07),mul(ad,.05))),b:add(E,add(mul(und,.07),mul(ad,.06))),w:.07,c:'pad'},
        {t:'line',a:add(E,mul(und,.14)),b:v(E.x-.05,0),w:.04,c:'mach'},{t:'line',a:v(-.24,.62),b:v(.2,.62),w:.07,c:'pad'},
        ...(p.res==='free'?[{t:'plate',p:W,r:.1}]:[{t:'axis',p:E}])],
      forces:[p.res==='free'?{p:W,d:v(0,-1),m:1,k:'load',main:true}:{p:W,d:cw(dirA(th)),m:1,k:'load',main:true}]};
  },
  analyze(P){
    const {E,W,S}=P.J, F=[P.forces[0]], el=demand(E,W,S,F);
    return {loads:el.close?{biceps:0,forearms:0,triceps:el.M}:{biceps:el.M*.8,forearms:el.M*.2,triceps:0},arms:[{J:E,F:F[0],m:'biceps'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.res==='free')w.push({lv:'ok',tx:`Со свободным весом пик нагрузки там, где предплечье горизонтально. При подушке ${p.pad}° это ${p.pad>50?'ближе к растянутому положению':p.pad<38?'ближе к сокращению':'середина амплитуды'}.`});
    else w.push({lv:'ok',tx:'Кулачок тренажёра выравнивает нагрузку по всей амплитуде.'});
    if(p.pad>55&&p.res==='free')w.push({lv:'warn',tx:'Пологая подушка: максимальная нагрузка в растянутом положении — опускай медленно, не бросай вес.'});
    return w;
  }
};

// ---------- Блок: сгибание и разгибание рук ----------
SIMS.cable = {
  lo:'', hi:'', con:'', ecc:'',
  paramsFor(cfg){return [
    {id:'e',label:'Локти',min:0,max:40,step:1,def:4,fmt:x=>x<6?'у корпуса':`вперёд ${x}°`},
    {id:'d',label:'Расстояние до блока',min:.15,max:.9,step:.01,def:cfg.mode==='push'?.32:.42,fmt:fmtCm}]},
  presetsFor(cfg){return cfg.mode==='push'?{triceps:{e:0,d:.3}}:{biceps:{e:3,d:.55},forearms:{e:3,d:.45}}},
  labels(cfg){return cfg.mode==='push'?{lo:'старт (локоть согнут)',hi:'низ (рука прямая)',con:'Разгибай',ecc:'Возвращай'}:{lo:'старт (рука прямая)',hi:'верх (рука согнута)',con:'Сгибай',ecc:'Опускай медленно'}},
  pose(p,t,cfg){
    const face=1, push=cfg.mode==='push';
    const S=v(0,1.42), H=v(-.02,.92), K=v(0,.5), A=v(0,.08);
    const ad=dirA(-90+p.e), E=add(S,mul(ad,BODY.ua)), a0=-90+p.e;
    const th=push?lerp(a0+135,a0+3,t):lerp(a0+6,a0+140,t);
    const W=add(E,mul(dirA(th),BODY.fa));
    const P=push?v(p.d,2.25):v(p.d,.1);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'circle',p:P,r:.05,c:'mach'},{t:'line',a:v(p.d+.1,2.4),b:v(p.d+.1,0),w:.05,c:'mach'},{t:'cable',a:W,b:P},{t:'line',a:add(W,v(0,-.05)),b:add(W,v(0,.05)),w:.03,c:'mach'}],
      forces:[{p:W,d:nrm(sub(P,W)),m:1,k:'cable',main:true}]};
  },
  analyze(P,p,cfg){
    const {S,E,W}=P.J, F=[P.forces[0]], el=demand(E,W,S,F), sh=shoulderDemand(S,F,P.face);
    const L={biceps:0,forearms:0,triceps:0,lats:0,frontdelt:0};
    if(el.close)L.triceps+=el.M; else {L.biceps+=el.M*.8;L.forearms+=el.M*.2}
    const shK=.16+p.e/40*.5;
    if(sh.toFlex)L.lats+=sh.M*shK; else L.frontdelt+=sh.M*shK;
    return {loads:L,arms:[{J:E,F:F[0],m:cfg.mode==='push'?'triceps':'biceps'},{J:S,F:F[0],m:sh.toFlex?'lats':'frontdelt'}]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(p.e>18)w.push({lv:'warn',tx:cfg.mode==='push'?'Локти уходят вперёд — подключаются широчайшие и корпус, трицепс недорабатывает.':'Локти вперёд — работает передняя дельта, а вверху бицепс разгружается.'});
    if(!w.length)w.push({lv:'ok',tx:'Локти зафиксированы у корпуса — работает только локтевой сустав.'});
    return w;
  }
};


// ---------- Присед со штангой (баланс: гриф над серединой стопы) ----------
SIMS.rack = {
  lo:'низ', hi:'верх', con:'Вставай', ecc:'Опускайся',
  params:[
    {id:'depth',label:'Глубина',min:0,max:1,step:.05,def:.8,fmt:x=>x>.75?'ниже параллели':x>.45?'параллель':'выше параллели'},
    {id:'bar',label:'Гриф',type:'choice',options:[['high','Высоко (на трапециях)'],['low','Низко (на задних дельтах)']],def:'high'},
    {id:'ankle',label:'Подвижность голеностопа',min:18,max:45,step:1,def:34,fmt:x=>x<26?`${x}° — жёсткий`:x>38?`${x}° — хорошая`:`${x}°`},
  ],
  presets:{quads:{depth:.85,bar:'high',ankle:42},glutes:{depth:.85,bar:'low',ankle:30},adductors:{depth:1,bar:'low',ankle:34}},
  pose(p,t){
    const face=1, A=v(0,.08), mx=.05;
    const thB=lerp(28,-12,p.depth), th=lerp(thB,86,ease(t)), sl=lerp(p.ankle,3,ease(t));
    const K=add(A,mul(v(Math.sin(sl*D2R),Math.cos(sl*D2R)),BODY.sh));
    const H=add(K,mul(v(-Math.cos(th*D2R),Math.sin(th*D2R)),BODY.th));
    const low=p.bar==='low', offP=low?.07:.045, offU=low?-.05:.03;
    const Rr=Math.hypot(BODY.to+offU,offP), ph=Math.atan2(offP,BODY.to+offU);
    const ratio=(mx-H.x)/Rr, bal=Math.abs(ratio)<=1;
    const al=ph+Math.asin(clamp(ratio,-1,1));
    const u=v(Math.sin(al),Math.cos(al)), post=v(-Math.cos(al),Math.sin(al));
    const S=add(H,mul(u,BODY.to)), bar=add(add(S,mul(post,offP)),mul(u,offU));
    const W=add(bar,mul(post,-.02)), E=arm(S,W,face);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'plate',p:bar,r:.225},{t:'line',a:v(-.55,0),b:v(-.55,1.9),w:.04,c:'rail'},{t:'vline',x:mx}],
      forces:[{p:v(mx,0),d:v(0,1),m:1,k:'grf',main:true},{p:bar,d:v(0,-1),m:.8,k:'load'}],extra:{lean:al/D2R,bal}};
  },
  analyze(P){
    const {H,K,A,S,toe}=P.J, F=[P.forces[0]];
    const kn=demand(K,A,H,F), hp=demand(H,K,S,F);
    const kA=angAt(K,H,A), hA=angAt(H,S,K), hs=hamsShare(kA)*.8, ad=hA<75?.2:.1;
    const L={quads:0,glutes:0,hams:0,adductors:0,erectors:Math.abs(torque(H,P.forces[1]))*.35};
    if(kn.close)L.quads+=kn.M; else L.hams+=kn.M;
    if(hp.close){L.glutes+=hp.M*(1-hs-ad);L.hams+=hp.M*hs;L.adductors+=hp.M*ad}
    return {loads:L,lean:P.extra.lean,bal:P.extra.bal,arms:[{J:K,F:F[0],m:kn.close?'quads':'hams'},{J:H,F:F[0],m:'glutes'}]};
  },
  check(bot,top,p){
    const w=[], L=Math.round(bot.lean);
    w.push({lv:L>48?'warn':'ok',tx:`Наклон корпуса внизу ${L}° при твоих пропорциях. ${L>48?'Это много: поясница держит большой момент. Помогут подставка под пятки, стойка шире или присед в гакк-машине.':'Гриф остаётся над серединой стопы — равновесие сохранено.'}`});
    if(p.ankle<26)w.push({lv:'warn',tx:'Жёсткий голеностоп: колени не уходят вперёд, и таз уезжает назад. Подставь под пятки блины 1–2 см или используй штангетки.'});
    if(!bot.bal)w.push({lv:'bad',tx:'В нижней точке равновесие не удерживается: гриф уходит за пятку. Уменьши глубину.'});
    return w;
  }
};

// ---------- Сведение рук: бабочка и кроссовер (вид сверху) ----------
SIMS.fly = {
  frontal:true,
  lo:'старт (руки разведены)', hi:'сведение', con:'Своди руки', ecc:'Разводи медленно',
  paramsFor(cfg){const b=[{id:'eb',label:'Сгибание локтей',min:5,max:90,step:1,def:20,fmt:x=>x<25?`${x}° — почти прямые`:x>55?`${x}° — уже жим`:`${x}°`},
    {id:'start',label:'Стартовое растяжение',min:-40,max:0,step:1,def:-15,fmt:x=>x<-28?`${-x}° за линию плеч`:x>-5?'руки в линии плеч':`${-x}° за линию плеч`}];
    if(cfg.kind==='crossover')b.push({id:'step',label:'Шаг вперёд от блоков',min:0,max:.45,step:.01,def:.2,fmt:fmtCm});
    return b},
  presetsFor(cfg){return cfg.kind==='crossover'?{chest:{eb:15,start:-15,step:.25},frontdelt:{eb:25,start:-8,step:.05}}:{chest:{eb:15,start:-15},frontdelt:{eb:30,start:-5}}},
  pose(p,t,cfg){
    const cross=cfg.kind==='crossover', S=v(.2,0), phi=lerp(p.start,82,ease(t));
    const E=add(S,mul(dirA(phi),BODY.ua)), W=add(E,mul(dirA(phi+p.eb),BODY.fa));
    const J={S,E,W,Sl:v(-S.x,S.y),El:v(-E.x,E.y),Wl:v(-W.x,W.y)};
    const props=[{t:'line',a:v(-.32,-.2),b:v(.32,-.2),w:.07,c:'pad'}];
    let forces;
    if(cross){const P=v(.95,-.1-p.step);props.push({t:'circle',p:P,r:.05,c:'mach'},{t:'circle',p:v(-P.x,P.y),r:.05,c:'mach'},{t:'cable',a:W,b:P},{t:'cable',a:J.Wl,b:v(-P.x,P.y)});
      forces=[{p:W,d:nrm(sub(P,W)),m:1,k:'cable',main:true},{p:J.Wl,d:nrm(sub(v(-P.x,P.y),J.Wl)),m:1,k:'cable'}]}
    else{const pd=add(E,mul(dirA(phi),-.04));props.push({t:'circle',p:pd,r:.05,c:'pad'},{t:'circle',p:v(-pd.x,pd.y),r:.05,c:'pad'},{t:'line',a:S,b:pd,w:.025,c:'mach'},{t:'line',a:J.Sl,b:v(-pd.x,pd.y),w:.025,c:'mach'},{t:'axis',p:S});
      forces=[{p:pd,d:cw(dirA(phi)),m:1,k:'load',main:true},{p:v(-pd.x,pd.y),d:ccw(dirA(180-phi)),m:1,k:'load'}]}
    return {face:1,frontal:true,kind:'fly',J,props,forces,t};
  },
  analyze(P,p,cfg){
    const {S,E,W}=P.J, F=[P.forces[0]];
    const sh=Math.abs(torque(S,F[0])), el=demand(E,W,S,F), fd=clamp(.2+p.eb/90*.35,.2,.55);
    const L={chest:sh*(1-fd),frontdelt:sh*fd,biceps:0,triceps:0};
    if(cfg.kind==='crossover'){if(el.close)L.triceps+=el.M*.35; else L.biceps+=el.M*.35}
    return {loads:L,arms:[{J:S,F:F[0],m:'chest'},...(cfg.kind==='crossover'?[{J:E,F:F[0],m:el.close?'triceps':'biceps'}]:[])]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(p.start<-28)w.push({lv:'bad',tx:'Слишком глубокое разведение: плечо уходит далеко за линию корпуса, передняя капсула под нагрузкой. Начинай с рук в линии плеч или чуть позади.'});
    if(p.eb>50)w.push({lv:'warn',tx:'Локти сильно согнуты — движение превращается в жим, грудь растягивается меньше.'});
    if(cfg.kind==='crossover')w.push({lv:'ok',tx:'Блок держит натяжение и в сведении, где у гантелей нагрузка почти исчезает.'});
    else w.push({lv:'ok',tx:'Упоры на локтях: тренажёр задаёт момент только в плечевом суставе, локоть не нагружается.'});
    return w;
  }
};

// ---------- Махи в стороны (вид спереди) ----------
SIMS.lateral = {
  frontal:true,
  lo:'низ (руки вдоль тела)', hi:'верх (руки в стороны)', con:'Поднимай локти', ecc:'Опускай медленно',
  paramsFor(cfg){return [
    {id:'res',label:'Сопротивление',type:'choice',options:[['machine','Тренажёр'],['cable','Нижний блок'],['db','Гантели']],def:cfg.kind==='cable'?'cable':'machine'},
    {id:'top',label:'Верхняя точка',min:60,max:120,step:1,def:88,fmt:x=>x>98?`${x}° — выше плеч`:`${x}°`},
    {id:'shrug',label:'Плечи',min:0,max:1,step:.05,def:.1,fmt:x=>x<.25?'опущены':x>.6?'поднимаются к ушам':'немного поднимаются'}]},
  presetsFor(){return {middelt:{top:88,shrug:0},traps:{top:110,shrug:.8}}},
  pose(p,t){
    const S=v(.2+.0,0+.06*p.shrug*t), g=lerp(12,p.top,ease(t));
    const ud=dirA(-90+g), E=add(S,mul(ud,BODY.ua)), W=add(E,mul(dirA(-90+g-12),BODY.fa));
    const J={S,E,W,Sl:v(-S.x,S.y),El:v(-E.x,E.y),Wl:v(-W.x,W.y)};
    const props=[{t:'line',a:v(-.18,-.62),b:v(.18,-.62),w:.07,c:'pad'}];
    let F;
    if(p.res==='machine'){props.push({t:'axis',p:S},{t:'circle',p:add(E,v(0,.05)),r:.045,c:'pad'},{t:'circle',p:add(J.El,v(0,.05)),r:.045,c:'pad'});F=[{p:E,d:cw(ud),m:1,k:'load',main:true},{p:J.El,d:ccw(v(-ud.x,ud.y)),m:1,k:'load'}]}
    else if(p.res==='cable'){const Pc=v(-.3,-.85);props.push({t:'circle',p:Pc,r:.05,c:'mach'},{t:'cable',a:W,b:Pc});F=[{p:W,d:nrm(sub(Pc,W)),m:1,k:'cable',main:true}]}
    else F=[{p:W,d:v(0,-1),m:1,k:'load',main:true},{p:J.Wl,d:v(0,-1),m:1,k:'load'}];
    return {face:1,frontal:true,kind:'stand',J,props,forces:F,t};
  },
  analyze(P,p){
    const {S,E}=P.J, F=[P.forces[0]], m=Math.abs(torque(S,F[0]));
    const ab=Math.acos(clamp(dot(nrm(sub(E,S)),v(0,-1)),-1,1))/D2R, tr=clamp(.08+.5*p.shrug+(ab>95?(ab-95)/40:0),.05,.75);
    return {loads:{middelt:m*(1-tr),traps:m*tr},arms:[{J:S,F:F[0],m:'middelt'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.shrug>.35)w.push({lv:'warn',tx:'Плечи поднимаются — работу забирают трапеции. Опусти плечи и веди руку локтем.'});
    if(p.top>98)w.push({lv:'warn',tx:'Выше уровня плеч рычаг на дельте падает, включаются трапеции, а плечу становится тесно.'});
    if(p.res==='db')w.push({lv:'ok',tx:'С гантелью внизу нагрузки почти нет — её пик в верхней точке. Блок и тренажёр нагружают и начало движения.'});
    if(!w.length)w.push({lv:'ok',tx:'Плечи опущены, подъём до уровня плеч — работает средняя дельта.'});
    return w;
  }
};

// ---------- Тяга на прямых руках и пуловер (вид сбоку) ----------
SIMS.straight = {
  lo:'старт (руки впереди-вверху)', hi:'руки у бёдер', con:'Опускай руки', ecc:'Возвращай медленно',
  paramsFor(cfg){return cfg.kind==='pullover'?[{id:'seat',label:'Ось плеча и тренажёра',min:-.08,max:.08,step:.005,def:0,fmt:x=>Math.abs(x)<.012?'совпадают ✓':`смещение ${fmtCm(Math.abs(x))}`}]
    :[{id:'lean',label:'Наклон корпуса',min:0,max:45,step:1,def:22,fmt:x=>`${x}°`},{id:'eb',label:'Сгибание локтей',min:3,max:70,step:1,def:12,fmt:x=>x<20?`${x}° — почти прямые`:`${x}°`}]},
  presetsFor(cfg){return cfg.kind==='pullover'?{lats:{seat:0}}:{lats:{lean:25,eb:8},triceps:{lean:15,eb:50}}},
  pose(p,t,cfg){
    const face=1, po=cfg.kind==='pullover';
    if(po){
      const H=v(0,.5), S=v(0,1.0), A=v(.42,.08), K=ik(H,A,BODY.th,BODY.sh,face);
      const M=v(p.seat,1.0+.0), fl=lerp(165,25,ease(t)), ud=rotV(v(0,-1),fl);
      const E=add(S,mul(ud,BODY.ua)), W=add(E,mul(rotV(ud,95),BODY.fa*.9));
      const pd=add(E,mul(ccw(ud),.05));
      return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
        props:[{t:'line',a:v(-.2,.42),b:v(.25,.42),w:.07,c:'pad'},{t:'line',a:v(-.12,.45),b:v(-.12,1.2),w:.07,c:'pad'},{t:'axis',p:M},{t:'line',a:M,b:pd,w:.03,c:'mach'},{t:'circle',p:pd,r:.04,c:'pad'}],
        forces:[{p:pd,d:ccw(nrm(sub(pd,M))),m:.3/Math.max(.1,len(sub(pd,M))),k:'load',main:true}],extra:{mis:Math.abs(p.seat)}};
    }
    const A=v(0,.08), K=v(.02,.5), H=v(-.04,.92);
    const S=add(H,mul(dirA(90-p.lean),BODY.to)), td=nrm(sub(H,S));
    const fl=lerp(150,12,ease(t)), ud=rotV(td,fl), E=add(S,mul(ud,BODY.ua)), W=add(E,mul(rotV(ud,p.eb),BODY.fa));
    const P=v(.95,2.2);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'circle',p:P,r:.05,c:'mach'},{t:'line',a:v(1.05,2.35),b:v(1.05,0),w:.05,c:'mach'},{t:'cable',a:W,b:P},{t:'line',a:add(W,v(0,-.05)),b:add(W,v(0,.05)),w:.03,c:'mach'}],
      forces:[{p:W,d:nrm(sub(P,W)),m:1,k:'cable',main:true}]};
  },
  analyze(P,p,cfg){
    const {S,E,W,H}=P.J, F=[P.forces[0]], sh=shoulderDemand(S,F,P.face), el=demand(E,W,S,F);
    const L={lats:0,triceps:0,reardelt:0,erectors:0,chest:0};
    if(sh.toFlex){L.lats+=sh.M*.72;L.triceps+=sh.M*.12;L.reardelt+=sh.M*.08;L.chest+=sh.M*.08}
    if(el.close)L.triceps+=el.M*.45;
    if(cfg.kind!=='pullover')L.erectors=Math.abs(torque(H,F[0]))*.12;
    return {loads:L,arms:[{J:S,F:F[0],m:'lats'},...(cfg.kind==='pullover'?[]:[{J:E,F:F[0],m:'triceps'}])]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(cfg.kind==='pullover'){
      if(p.seat&&Math.abs(p.seat)>.015)w.push({lv:'bad',tx:`Ось плеча смещена на ${fmtCm(Math.abs(p.seat))} от оси тренажёра — упор скользит по руке, плечо работает с рывком. Подстрой сиденье.`});
      else w.push({lv:'ok',tx:'Упор на локтях: бицепс не участвует, широчайшие работают изолированно.'});
      return w;
    }
    if(p.eb>30)w.push({lv:'warn',tx:'Локти сильно согнуты — подключается трицепс, и движение превращается в разгибание рук.'});
    else w.push({lv:'ok',tx:'Почти прямые руки: работает плечевой сустав, нагрузка уходит в широчайшие.'});
    return w;
  }
};

function simParams(ex){const s=SIMS[ex.sim];return s.paramsFor?s.paramsFor(ex.cfg||{}):s.params}
function simPresets(ex){const s=SIMS[ex.sim];return s.presetsFor?s.presetsFor(ex.cfg||{}):(s.presets||{})}
function simLabels(ex){const s=SIMS[ex.sim];return s.labels?s.labels(ex.cfg||{}):{lo:s.lo,hi:s.hi,con:s.con,ecc:s.ecc}}
function runSim(ex,p,t){const s=SIMS[ex.sim],cfg=ex.cfg||{};const P=s.pose(p,t,cfg);const R=s.analyze(P,p,cfg);return {P,R}}
// средние доли по амплитуде + профиль
function sweep(ex,p,target,N=24){
  const tot={}; const prof=[]; const sum=[]; let bot=null,top=null,gmax=0;
  for(let i=0;i<=N;i++){
    const t=i/N, {R}=runSim(ex,p,t); if(i===0)bot=R; if(i===N)top=R;
    let s=0; for(const k in R.loads){const x=Math.max(0,R.loads[k]);tot[k]=(tot[k]||0)+x;s+=x;if(x>gmax)gmax=x}
    prof.push(target?Math.max(0,R.loads[target]||0):s); sum.push(s);
  }
  let S=0; for(const k in tot)S+=tot[k];
  const share={}; for(const k in tot)share[k]=S?tot[k]/S:0;
  const s=SIMS[ex.sim]; const warns=s.check?s.check(bot,top,p,ex.cfg||{}):[];
  return {share,prof,sum,gmax,warns};
}
