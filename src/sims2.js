// ===== Модели v2: оставшиеся тренажёры и свободные веса =====
// Те же соглашения, что в sims.js: метры, y вверх, face=1 — смотрит вправо.
const armLenH=()=>BODY.ua+BODY.fa-.03, gripLen=()=>BODY.ua+BODY.fa+.06;
function stand(face=1){const A=v(0,.08),K=v(.02,.08+BODY.sh),H=v(0,K.y+BODY.th);return {A,K,H,...flatFoot(A,face)}}
const bisect=(f,a,b,n=32)=>{let fa=f(a);for(let i=0;i<n;i++){const m=(a+b)/2,fm=f(m);if((fm>0)===(fa>0)){a=m;fa=fm}else b=m}return (a+b)/2};
const gravC=F=>{let m=0,cx=0,cy=0;for(const f of F){m+=f.m;cx+=f.p.x*f.m;cy+=f.p.y*f.m}return {p:v(cx/m,cy/m),d:v(0,-1),m,k:'load'}};

// ---------- Сгибание ног сидя / стоя, GHD ----------
SIMS.kneecurl = {
  paramsFor(cfg){
    if(cfg.pos==='ghd')return [
      {id:'hip',label:'Сгибание в тазу',min:0,max:60,step:1,def:0,fmt:x=>x<8?'тело прямое ✓':`${x}°`},
      {id:'arms',label:'Руки',min:0,max:1,step:.1,def:0,fmt:x=>x<.3?'на груди':x>.7?'за головой':'перед собой'}];
    const b=[{id:'pad',label:'Валик',min:.28,max:.42,step:.01,def:.39,fmt:x=>x>.36?'над пяткой':'на икрах'},
      {id:'ankle',label:'Стопа',min:0,max:1,step:.05,def:.7,fmt:x=>x>.6?'носок на себя':x<.35?'носок оттянут':'нейтрально'}];
    if(cfg.pos==='seated')b.unshift({id:'rec',label:'Наклон спинки',min:-15,max:30,step:1,def:8,fmt:x=>x<-2?`корпус вперёд ${-x}°`:x>2?`назад ${x}°`:'вертикально'});
    else b.unshift({id:'hip',label:'Бедро рабочей ноги',min:0,max:30,step:1,def:8,fmt:x=>x<4?'вертикально':`вперёд ${x}°`});
    return b;
  },
  presetsFor(cfg){return cfg.pos==='ghd'?{hams:{hip:0,arms:0},glutes:{hip:25,arms:0}}:cfg.pos==='seated'?{hams:{rec:-10,pad:.4,ankle:.2},calves:{rec:8,pad:.4,ankle:1}}:{hams:{hip:20,pad:.4,ankle:.2}}},
  labels(cfg){return cfg.pos==='ghd'?{lo:'старт (тело горизонтально)',hi:'верх (корпус вертикально)',con:'Подтягивай себя пятками',ecc:'Опускайся медленно'}:{lo:'старт (нога прямая)',hi:'пятка к ягодице',con:'Сгибай',ecc:'Разгибай медленно'}},
  pose(p,t,cfg){
    const face=1;
    if(cfg.pos==='ghd'){
      const K=v(0,.62), A=add(K,v(-BODY.sh,0)), bd=dirA(lerp(4,86,ease(t)));
      const H=add(K,mul(bd,BODY.th)), td=rotV(bd,-p.hip), S=add(H,mul(td,BODY.to));
      const up=ant(mul(td,-1),face);
      const W=p.arms>.7?add(S,mul(td,.32)):p.arms>.3?add(add(S,mul(td,-.12)),mul(up,.4)):add(add(S,mul(td,-.1)),mul(up,.12));
      const E=arm(S,W,face);
      const F=[{p:lerpV(K,H,.5),d:v(0,-1),m:.22,k:'load'},{p:lerpV(H,S,.55),d:v(0,-1),m:.5,k:'load',main:true},{p:W,d:v(0,-1),m:.12,k:'load'}];
      return {face,J:{S,H,K,A,E,W,head:add(S,mul(td,BODY.nk)),heel:add(A,v(-.02,.06)),toe:add(A,v(-.05,-.15))},
        props:[{t:'circle',p:add(K,v(.04,-.08)),r:.08,c:'pad'},{t:'circle',p:add(A,v(-.02,.12)),r:.045,c:'pad'},{t:'line',a:add(A,v(-.12,-.18)),b:add(A,v(.12,-.18)),w:.04,c:'mach'},{t:'line',a:v(-.2,.5),b:v(-.2,0),w:.04,c:'mach'},{t:'line',a:v(.1,.5),b:v(.1,0),w:.04,c:'mach'}],
        forces:F};
    }
    if(cfg.pos==='seated'){
      const H=v(0,.55), K=add(H,v(BODY.th,0)), S=add(H,mul(dirA(90+p.rec),BODY.to));
      const sd=dirA(lerp(-8,-118,ease(t))), A=add(K,mul(sd,BODY.sh)), sa=ant(sd,face);
      const Pc=add(K,mul(sd,p.pad)), R=add(Pc,mul(sa,-.065));
      const toe=add(A,add(mul(sd,.06),mul(sa,lerp(.06,.16,p.ankle)))), heel=add(A,add(mul(sd,.05),mul(sa,-.05)));
      const W=add(H,v(.12,.06)), E=arm(S,W,face), post=mul(ant(nrm(sub(H,S)),face),-1);
      return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel,toe},
        props:[{t:'line',a:v(-.12,.48),b:add(K,v(-.06,-.07)),w:.07,c:'pad'},{t:'line',a:add(add(H,mul(post,.11)),v(0,.02)),b:add(S,mul(post,.11)),w:.07,c:'pad'},
          {t:'circle',p:add(lerpV(H,K,.82),v(0,.1)),r:.05,c:'pad'},{t:'line',a:v(.05,.44),b:v(.05,0),w:.04,c:'mach'},{t:'line',a:K,b:R,w:.03,c:'mach'},{t:'circle',p:R,r:.045,c:'pad'},{t:'axis',p:K}],
        forces:[{p:Pc,d:ccw(sd),m:.39/p.pad,k:'load',main:true}]};
    }
    const {A:A0}=stand(face), H=v(0,.08+BODY.sh+BODY.th), K=add(H,mul(dirA(-90+p.hip),BODY.th));
    const sd=dirA(-90+p.hip-lerp(4,112,ease(t))), A=add(K,mul(sd,BODY.sh)), sa=ant(sd,face);
    const S=add(H,mul(dirA(80),BODY.to)), Pc=add(K,mul(sd,p.pad)), R=add(Pc,mul(sa,-.06));
    const W=add(S,v(.22,-.22)), E=arm(S,W,face);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel:add(A,add(mul(sd,.05),mul(sa,-.05))),toe:add(A,add(mul(sd,.06),mul(sa,lerp(.06,.16,p.ankle))))},
      props:[{t:'line',a:H,b:A0,w:.05,c:'rail'},{t:'line',a:add(S,v(.12,-.05)),b:add(S,v(.12,-.35)),w:.07,c:'pad'},{t:'line',a:K,b:R,w:.03,c:'mach'},{t:'circle',p:R,r:.045,c:'pad'},{t:'axis',p:K},{t:'line',a:v(.42,1.3),b:v(.42,0),w:.04,c:'mach'}],
      forces:[{p:Pc,d:ccw(sd),m:.39/p.pad,k:'load',main:true}]};
  },
  analyze(P,p,cfg){
    const {H,K,A,S}=P.J;
    if(cfg.pos==='ghd'){
      let mK=0,mH=0;for(const f of P.forces){mK+=torque(K,f);mH+=torque(H,f)}
      const hipFrac=clamp(1-p.hip/45,0,1), kn=Math.abs(mK)*hipFrac+Math.abs(mK)*.35*(1-hipFrac);
      const G=gravC(P.forces);
      return {loads:{hams:kn*.85+Math.abs(mH)*.25,glutes:Math.abs(mH)*.45,calves:kn*.15,erectors:Math.abs(mH)*.2},arms:[{J:K,F:G,m:'hams'}]};
    }
    const F=[P.forces[0]], kn=demand(K,A,H,F), g=lerp(.04,.22,p.ankle);
    return {loads:{hams:kn.M*(1-g),calves:kn.M*g},arms:[{J:K,F:F[0],m:'hams'}]};
  },
  forceShown(P,p,cfg){return cfg&&cfg.pos==='ghd'?gravC(P.forces):null},
  check(bot,top,p,cfg){
    const w=[];
    if(cfg.pos==='ghd'){
      if(p.hip>20)w.push({lv:'warn',tx:'Таз сгибается — нагрузка уходит с бицепса бедра на ягодицы и поясницу, это уже гиперэкстензия. Держи тело одной линией от колен до плеч.'});
      else w.push({lv:'ok',tx:'Тело прямое: колено сгибает бицепс бедра против веса всего корпуса — одно из самых тяжёлых упражнений на заднюю поверхность.'});
      if(p.arms>.7)w.push({lv:'warn',tx:'Руки за головой удлиняют рычаг — нагрузка заметно больше. Новичкам — руки на груди.'});
      return w;
    }
    if(p.pad<.34)w.push({lv:'warn',tx:'Валик на икрах давит на мышцу. Опусти его к ахиллу, над пяткой.'});
    if(cfg.pos==='seated'){
      if(p.rec>12)w.push({lv:'warn',tx:'Откинутая спинка разгибает бедро — бицепс бедра укорачивается со стороны таза. Сядь вертикальнее или наклонись вперёд.'});
      else w.push({lv:'ok',tx:'Сидя бедро согнуто, и бицепс бедра растянут со стороны таза. В исследовании Maeo 2021 сгибание сидя дало больший рост, чем лёжа.'});
    } else {
      if(p.hip<10)w.push({lv:'warn',tx:'Бедро вертикально — бицепс бедра укорочен. Если тренажёр позволяет, выведи бедро немного вперёд.'});
      w.push({lv:'ok',tx:'Работаешь одной ногой — удобно выровнять силу левой и правой.'});
    }
    return w;
  }
};

// ---------- Отведение ноги назад: тренажёр, кроссовер, обратная гиперэкстензия ----------
SIMS.kick = {
  paramsFor(cfg){
    if(cfg.kind==='reverse')return [{id:'knee',label:'Сгибание колен',min:0,max:70,step:1,def:10,fmt:x=>x<12?'ноги почти прямые':`${x}°`},{id:'top',label:'Верхняя точка',min:-10,max:25,step:1,def:0,fmt:x=>x>8?`выше линии тела на ${x}° — прогиб в пояснице`:'линия тела ✓'},{id:'plate',label:'Отягощение',min:0,max:1,step:.1,def:.3,fmt:x=>x<.05?'без веса':`${Math.round(x*40)} кг`}];
    const b=[{id:'knee',label:'Сгибание колена',min:0,max:110,step:1,def:cfg.kind==='cable'?8:90,fmt:x=>x<12?'нога прямая':`${x}°`},{id:'ext',label:'Разгибание в конце',min:-10,max:35,step:1,def:15,fmt:x=>x>22?`${x}° — прогиб в пояснице`:`${x}° за линию корпуса`}];
    if(cfg.kind==='machine')b.push({id:'lean',label:'Наклон корпуса',min:20,max:70,step:1,def:40,fmt:x=>`${x}° от горизонта`});
    else b.push({id:'lean',label:'Наклон корпуса',min:55,max:90,step:1,def:80,fmt:x=>x>86?'вертикально':`вперёд на ${90-x}°`});
    return b;
  },
  presetsFor(cfg){return cfg.kind==='reverse'?{glutes:{knee:10,top:0,plate:.4},hams:{knee:0,top:0,plate:.4}}:{glutes:{knee:cfg.kind==='cable'?20:95,ext:15,lean:cfg.kind==='cable'?72:40},hams:{knee:0,ext:12,lean:cfg.kind==='cable'?80:45}}},
  labels(cfg){return cfg.kind==='reverse'?{lo:'низ (ноги свисают)',hi:'верх (ноги в линию)',con:'Поднимай ноги ягодицами',ecc:'Опускай подконтрольно'}:{lo:'старт (бедро впереди)',hi:'нога отведена назад',con:'Толкай назад пяткой',ecc:'Возвращай медленно'}},
  pose(p,t,cfg){
    const face=1;
    if(cfg.kind==='reverse'){
      const H=v(0,1.0), td=dirA(0), S=add(H,mul(td,BODY.to)), thd=dirA(lerp(-92,-180-p.top,ease(t)));
      const K=add(H,mul(thd,BODY.th)), sd=rotV(thd,-p.knee), A=add(K,mul(sd,BODY.sh)), sa=ant(sd,face);
      const W=add(S,v(.12,-.42)), E=arm(S,W,face);
      const F=[{p:lerpV(H,K,.55),d:v(0,-1),m:.2,k:'load',main:true},{p:lerpV(K,A,.5),d:v(0,-1),m:.1,k:'load'},...(p.plate>.05?[{p:A,d:v(0,-1),m:.5*p.plate,k:'load'}]:[])];
      return {face,J:{S,H,K,A,E,W,head:add(S,mul(td,BODY.nk)),heel:add(A,mul(sa,-.05)),toe:add(A,add(mul(sd,.05),mul(sa,.15)))},
        props:[{t:'line',a:add(H,v(.02,-.07)),b:add(S,v(-.02,-.07)),w:.08,c:'pad'},{t:'line',a:add(S,v(-.05,-.12)),b:add(S,v(-.05,-1)),w:.04,c:'mach'},{t:'line',a:add(H,v(.04,-.12)),b:add(H,v(.04,-1)),w:.04,c:'mach'},...(p.plate>.05?[{t:'plate',p:add(A,v(0,-.08)),r:.08+.06*p.plate}]:[])],
        forces:F};
    }
    const cable=cfg.kind==='cable', H=v(0,.08+BODY.sh+BODY.th-(cable?0:.08)), td=dirA(p.lean), S=add(H,mul(td,BODY.to));
    const neutral=180+p.lean, start=cable?-70:-90+lerp(55,25,(p.lean-20)/50);
    const a0=cable?start:neutral+100, a1=(cable?-90-p.ext-(90-p.lean)*.3:neutral-p.ext);
    const thd=dirA(lerp(cable?a0:a0,a1,ease(t)));
    const K=add(H,mul(thd,BODY.th)), sd=rotV(thd,-p.knee), A=add(K,mul(sd,BODY.sh)), sa=ant(sd,face);
    const W=add(S,mul(dirA(p.lean-80),.42)), E=arm(S,W,face);
    let F, props=[{t:'line',a:H,b:v(H.x+.02,.08),w:.05,c:'rail'}];
    if(cable){const Pc=v(.55,.12);props.push({t:'circle',p:Pc,r:.05,c:'mach'},{t:'cable',a:A,b:Pc},{t:'line',a:v(.65,2),b:v(.65,0),w:.05,c:'mach'});F=[{p:A,d:nrm(sub(Pc,A)),m:1,k:'cable',main:true}]}
    else{const pad=lerpV(K,A,.85), R=add(pad,mul(sa,.06));props.push({t:'line',a:add(S,v(.1,-.05)),b:add(lerpV(H,S,.4),v(.12,-.08)),w:.08,c:'pad'},{t:'axis',p:H},{t:'line',a:H,b:R,w:.025,c:'mach'},{t:'circle',p:R,r:.05,c:'pad'},{t:'line',a:v(.5,1.2),b:v(.5,0),w:.04,c:'mach'});
      const lev=sub(pad,H);F=[{p:pad,d:ccw(nrm(lev)),m:.5/len(lev),k:'load',main:true}]}
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),heel:add(A,mul(sa,-.05)),toe:add(A,add(mul(sd,.05),mul(sa,.15)))},props,forces:F};
  },
  analyze(P,p,cfg){
    const {S,H,K,A}=P.J;
    let mH=0;for(const f of P.forces)mH+=torque(H,f);
    const hip=cfg.kind==='reverse'?Math.abs(mH):demand(H,K,S,[P.forces[0]]).M*(demand(H,K,S,[P.forces[0]]).close?1:.15);
    const hs=hamsShare(180-p.knee)*(cfg.kind==='reverse'?1:.9);
    const L={glutes:hip*(1-hs),hams:hip*hs,erectors:cfg.kind==='reverse'?hip*.15:0,gmed:cfg.kind==='cable'?hip*.12:0};
    return {loads:L,arms:[{J:H,F:cfg.kind==='reverse'?gravC(P.forces):P.forces[0],m:'glutes'}]};
  },
  forceShown(P,p,cfg){return cfg&&cfg.kind==='reverse'?gravC(P.forces):null},
  check(bot,top,p,cfg){
    const w=[];
    if(cfg.kind==='reverse'){
      if(p.top>8)w.push({lv:'warn',tx:'Ноги выше линии тела — движение заканчивает поясница, а не ягодицы. Поднимай до горизонтали.'});
      w.push({lv:'ok',tx:'Корпус лежит на скамье, позвоночник разгружен — подходит при осторожности с поясницей, если нет боли.'});
      if(p.knee>35)w.push({lv:'ok',tx:'Согнутые колени укорачивают бицепс бедра — больше работают ягодицы.'});
      return w;
    }
    if(p.ext>22)w.push({lv:'warn',tx:'Слишком далеко назад — таз наклоняется, работает поясница. Останавливайся, когда ягодица полностью сокращена.'});
    if(p.knee>60)w.push({lv:'ok',tx:'Колено согнуто — бицепс бедра выключен, отводят ягодичные.'});
    else w.push({lv:'ok',tx:'Прямая нога — бицепс бедра помогает ягодичным.'});
    if(cfg.kind==='cable')w.push({lv:'ok',tx:'Блок держит натяжение в растянутом положении, когда бедро впереди.'});
    return w;
  }
};

// ---------- Становая и румынская тяга ----------
SIMS.hinge = {
  paramsFor(cfg){
    const b=[{id:'drift',label:'Гриф относительно середины стопы',min:0,max:.15,step:.01,def:0,fmt:x=>x<.015?'над серединой стопы ✓':`впереди на ${fmtCm(x)}`},
      {id:'round',label:'Спина',min:0,max:1,step:.05,def:0,fmt:x=>x<.15?'ровная':x<.5?'слегка округлена':'круглая'}];
    if(cfg.kind==='rdl')b.unshift({id:'depth',label:'Глубина',min:0,max:1,step:.05,def:.6,fmt:x=>x<.3?'до колен':x<.7?'до середины голени':'почти до пола'},{id:'knee',label:'Колени',min:5,max:30,step:1,def:15,fmt:x=>x<10?'почти прямые':x>22?'заметно согнуты':'слегка согнуты'});
    else b.unshift({id:'shin',label:'Колени вперёд на старте',min:4,max:30,step:1,def:16,fmt:x=>x<10?'голень вертикальна — таз высоко':x>22?'колени далеко вперёд — таз низко':'средне'});
    return b;
  },
  presetsFor(cfg){return cfg.kind==='rdl'?{hams:{depth:.75,knee:10,drift:0,round:0},glutes:{depth:.55,knee:22,drift:0,round:0}}:{glutes:{shin:14,drift:0,round:0},quads:{shin:26,drift:0,round:0},erectors:{shin:8,drift:0,round:0}}},
  labels(cfg){return cfg.kind==='rdl'?{lo:'низ (таз отведён)',hi:'верх (стоя)',con:'Таз вперёд',ecc:'Отводи таз назад'}:{lo:'старт (гриф на полу)',hi:'верх (стоя)',con:'Толкай пол',ecc:'Опускай вдоль ног'}},
  pose(p,t,cfg){
    const face=1, A=v(0,.08), mx=.04+p.drift, aL=gripLen(), rdl=cfg.kind==='rdl';
    const build=(sl,th)=>{
      const K=add(A,mul(v(Math.sin(sl*D2R),Math.cos(sl*D2R)),BODY.sh)), H=add(K,mul(v(-Math.cos(th*D2R),Math.sin(th*D2R)),BODY.th));
      const bend=20*p.round, Sx=al=>H.x+.22*Math.cos(al*D2R)+(BODY.to-.22)*Math.cos((al-bend)*D2R);
      const al=Sx(95)>=mx?95:Sx(-5)<=mx?-5:bisect(a=>Sx(a)-mx,-5,95);
      const u=dirA(al), L=add(H,mul(u,.22)), S=add(L,mul(dirA(al-bend),BODY.to-.22)), W=v(S.x,S.y-aL);
      return {K,H,L,S,W,al};
    };
    const sl0=rdl?p.knee*.55:p.shin, slT=lerp(sl0,rdl?3:2,ease(t));
    const yT=rdl?lerp(.62,.24,p.depth):.225;
    const fy=th=>build(sl0,th).W.y-yT, th0=fy(-8)>0?-8:bisect(fy,-8,89);
    const P=build(slT,lerp(th0,rdl?84:86,ease(t)));
    const Wg=add(P.W,v(0,.05)), E=ik(P.S,Wg,BODY.ua,BODY.fa,face);
    return {face,J:{S:P.S,H:P.H,K:P.K,A,E,W:Wg,L:P.L,head:headOf(P.S,P.L),...flatFoot(A,face)},
      props:[{t:'plate',p:P.W,r:.225},{t:'vline',x:.04}],
      forces:[{p:v(P.W.x,0),d:v(0,1),m:1,k:'grf',main:true},{p:P.W,d:v(0,-1),m:1,k:'load'}],extra:{lean:P.al}};
  },
  analyze(P,p,cfg){
    const {H,K,A,S,L}=P.J, G=[P.forces[0]], bar=P.forces[1];
    const kn=demand(K,A,H,G), hp=demand(H,K,S,G), kA=angAt(K,H,A);
    const hs=Math.min(.68,hamsShare(kA)*(cfg.kind==='rdl'?1.4:.85)), ad=cfg.kind==='rdl'?.06:.12;
    const lb=Math.abs(torque(H,bar)), spine=Math.abs(torque(L,bar))*(1.05+.5*p.round);
    const Ld={quads:0,glutes:0,hams:0,adductors:0,erectors:spine,forearms:.1*lb+.01,traps:.05*lb};
    if(kn.close)Ld.quads+=kn.M; else Ld.hams+=kn.M*.6;
    if(hp.close){Ld.glutes+=hp.M*(1-hs-ad);Ld.hams+=hp.M*hs;Ld.adductors+=hp.M*ad}
    return {loads:Ld,lean:P.extra.lean,arms:[{J:H,F:G[0],m:'glutes'},{J:L,F:bar,m:'erectors'}]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(p.drift>.04)w.push({lv:'bad',tx:`Гриф уходит от ног на ${fmtCm(p.drift)} — плечо силы на пояснице растёт. Веди гриф вплотную к голеням и бёдрам.`});
    if(p.round>.3)w.push({lv:'bad',tx:'Спина округляется под весом — нагрузка ложится на диски и связки. Сбрось вес, держи нейтральную спину и жёсткий корпус.'});
    if(cfg.kind==='rdl'){
      if(p.depth>.8)w.push({lv:'warn',tx:'Опускаться ниже середины голени стоит, только если спина остаётся ровной. Глубину задаёт гибкость бицепса бедра, а не цель коснуться пола.'});
      if(!w.length)w.push({lv:'ok',tx:'Колени почти не двигаются, таз уходит назад — бицепс бедра растягивается под нагрузкой.'});
    } else {
      w.push({lv:'ok',tx:`Наклон корпуса на старте ${Math.round(90-bot.lean)}° от вертикали. ${p.shin>22?'Таз низко — больше работают квадрицепсы, как в приседе.':p.shin<10?'Таз высоко — тяга ближе к румынской, больше бицепс бедра и поясница.':'Баланс квадрицепсов и ягодиц.'}`});
    }
    return w;
  }
};

// ---------- Шраги ----------
SIMS.shrug = {
  lo:'низ (плечи опущены)', hi:'верх (плечи к ушам)', con:'Поднимай плечи', ecc:'Опускай с растяжением',
  params:[{id:'lean',label:'Наклон корпуса',min:0,max:30,step:1,def:5,fmt:x=>x<4?'вертикально':`вперёд ${x}°`},{id:'roll',label:'Вращение плечами',type:'choice',options:[['no','Нет — строго вверх'],['yes','Да, по кругу']],def:'no'}],
  presets:{traps:{lean:5,roll:'no'}},
  pose(p,t){
    const face=1, st=stand(face), td=dirA(90-p.lean), base=add(st.H,mul(td,BODY.to-.04));
    const S=add(base,mul(td,.07*ease(t))), W=add(S,v(.02,-armLenH())), E=arm(S,W,face);
    return {face,J:{...st,S,E,W,head:add(base,mul(td,BODY.nk+.04)),heel:st.heel,toe:st.toe},
      props:[{t:'plate',p:add(W,v(0,-.06)),r:.12},{t:'line',a:v(-.35,2.1),b:v(-.35,0),w:.04,c:'rail'}],
      forces:[{p:W,d:v(0,-1),m:1,k:'load',main:true}]};
  },
  analyze(P,p){const L={traps:.32*(1-.004*p.lean),upperback:.02+.003*p.lean,forearms:.06};return {loads:L,arms:[]}},
  check(bot,top,p){
    const w=[];
    if(p.roll==='yes')w.push({lv:'warn',tx:'Вращение плечами ничего не добавляет трапециям, а плечевой сустав нагружает. Поднимай строго вверх.'});
    w.push({lv:'ok',tx:'Задержись наверху на 1 с и опускай до полного растяжения — у шрагов короткая амплитуда, её важно использовать целиком.'});
    if(p.lean>15)w.push({lv:'ok',tx:'Наклон вперёд подключает середину трапеции.'});
    return w;
  }
};

// ---------- Тяга к подбородку ----------
SIMS.upright = {
  lo:'низ (руки у бёдер)', hi:'верх', con:'Веди локти вверх', ecc:'Опускай',
  params:[{id:'grip',label:'Хват',min:.2,max:.7,step:.01,def:.45,fmt:x=>x<.32?'узкий':x>.55?'широкий':'на ширине плеч'},{id:'top',label:'Верхняя точка',min:0,max:1,step:.05,def:.5,fmt:x=>x<.3?'к низу груди':x>.75?'к подбородку':'к груди'}],
  presets:{middelt:{grip:.6,top:.5},traps:{grip:.4,top:.85}},
  pose(p,t){
    const face=1, st=stand(face), S=add(st.H,mul(dirA(90),BODY.to));
    const W=lerpV(v(S.x+.08,S.y-.62),v(S.x+.12,S.y-lerp(.3,.04,p.top)),ease(t));
    const E=ik(S,W,BODY.ua,BODY.fa,face), Pc=v(.32,.12);
    return {face,J:{...st,S,E,W,head:headOf(S,st.H)},
      props:[{t:'circle',p:Pc,r:.05,c:'mach'},{t:'cable',a:W,b:Pc},{t:'line',a:add(W,v(0,-.03)),b:add(W,v(0,.03)),w:.04,c:'mach'},{t:'line',a:v(.42,2),b:v(.42,0),w:.05,c:'mach'}],
      forces:[{p:W,d:nrm(sub(Pc,W)),m:1,k:'cable',main:true}]};
  },
  analyze(P,p){
    const {S,E,W}=P.J, F=[P.forces[0]], sh=Math.abs(torque(S,F[0])), el=demand(E,W,S,F);
    const tr=clamp(.15+.35*p.top-.25*(p.grip-.45),.08,.55);
    return {loads:{middelt:sh*(1-tr)*.85,frontdelt:sh*(1-tr)*.15,traps:sh*tr,biceps:el.close?0:el.M*.12},arms:[{J:S,F:F[0],m:'middelt'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.grip<.32&&p.top>.6)w.push({lv:'bad',tx:'Узкий хват и тяга к подбородку — плечо во внутренней ротации и подъёме, классический риск импинджмента. Возьми хват на ширине плеч и тяни до уровня груди.'});
    else if(p.top>.75)w.push({lv:'warn',tx:'Локти выше плеч: дельта дальше не работает, плечевому суставу тесно. Останавливай локти на уровне плеч.'});
    if(p.grip>=.45)w.push({lv:'ok',tx:'Широкий хват — больше средней дельты, меньше трапеций и безопаснее для плеча.'});
    if(!w.length)w.push({lv:'ok',tx:'Локти ведут движение, кисти ниже локтей — правильно.'});
    return w;
  }
};

// ---------- Разгибание рук: из-за головы и трицепс-машина ----------
SIMS.triext = {
  paramsFor(cfg){return cfg.kind==='overhead'?[{id:'sh',label:'Плечо',min:0,max:45,step:1,def:15,fmt:x=>x<6?'вертикально вверх':`вперёд ${x}°`},{id:'end',label:'Конец движения',min:0,max:30,step:1,def:5,fmt:x=>x<8?'рука прямая ✓':`не доразгибаешь ${x}°`}]
    :[{id:'pad',label:'Наклон подушки',min:20,max:60,step:1,def:40,fmt:x=>`${x}°`},{id:'axis',label:'Локоть и ось тренажёра',min:-.06,max:.06,step:.005,def:0,fmt:x=>Math.abs(x)<.012?'на оси ✓':`смещение ${fmtCm(Math.abs(x))}`}]},
  presetsFor(cfg){return cfg.kind==='overhead'?{triceps:{sh:10,end:0}}:{triceps:{pad:40,axis:0}}},
  labels(cfg){return cfg.kind==='overhead'?{lo:'старт (кисти за головой)',hi:'руки прямые',con:'Разгибай',ecc:'Опускай за голову'}:{lo:'старт (локоть согнут)',hi:'рука прямая',con:'Разгибай',ecc:'Возвращай'}},
  pose(p,t,cfg){
    const face=1;
    if(cfg.kind==='overhead'){
      const st=stand(face), td=dirA(78), S=add(st.H,mul(td,BODY.to)), ad=dirA(90-p.sh), E=add(S,mul(ad,BODY.ua));
      const a=90-p.sh, th=lerp(a+150,a+p.end,ease(t)), W=add(E,mul(dirA(th),BODY.fa)), Pc=v(-.55,1.95);
      return {face,J:{...st,S,E,W,head:add(S,mul(td,BODY.nk))},
        props:[{t:'circle',p:Pc,r:.05,c:'mach'},{t:'cable',a:W,b:Pc},{t:'line',a:v(-.65,2.3),b:v(-.65,0),w:.05,c:'mach'}],
        forces:[{p:W,d:nrm(sub(Pc,W)),m:1,k:'cable',main:true}]};
    }
    const H=v(-.05,.55), S=v(0,1.15), ad=dirA(-90+p.pad), E=add(S,mul(ad,BODY.ua)), a0=-90+p.pad;
    const th=lerp(a0+125,a0+6,ease(t)), fd=dirA(th), W=add(E,mul(fd,BODY.fa)), K=v(.4,.55), A=v(.42,.08), und=cw(ad);
    const Ax=add(E,mul(fd,p.axis));
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'line',a:add(S,add(mul(und,.07),mul(ad,.05))),b:add(E,add(mul(und,.07),mul(ad,.06))),w:.07,c:'pad'},{t:'line',a:v(-.25,.48),b:v(.25,.48),w:.07,c:'pad'},{t:'axis',p:add(E,mul(cw(fd),p.axis))},{t:'circle',p:add(W,mul(ccw(fd),.05)),r:.045,c:'pad'}],
      forces:[{p:W,d:ccw(fd),m:1,k:'load',main:true}],extra:{ax:p.axis}};
  },
  analyze(P,p,cfg){
    const {S,E,W}=P.J, F=[P.forces[0]], el=demand(E,W,S,F);
    const long=cfg.kind==='overhead'?1.12:1;
    return {loads:{triceps:el.M*long,frontdelt:cfg.kind==='overhead'?.02:0},arms:[{J:E,F:F[0],m:'triceps'}]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(cfg.kind==='overhead'){
      w.push({lv:'ok',tx:'Рука над головой растягивает длинную головку трицепса. В исследовании Maeo 2023 разгибания из-за головы дали больший рост трицепса, чем разгибания у корпуса.'});
      if(p.sh>30)w.push({lv:'warn',tx:'Плечо уходит вперёд — длинная головка растягивается меньше. Держи плечо ближе к вертикали.'});
      if(p.end>15)w.push({lv:'warn',tx:'Не доразгибаешь руку — теряется пиковое сокращение.'});
    } else {
      if(Math.abs(p.axis)>.015)w.push({lv:'warn',tx:`Локоть смещён от оси тренажёра на ${fmtCm(Math.abs(p.axis))} — рукоять скользит по руке. Подгони сиденье.`});
      else w.push({lv:'ok',tx:'Локоть на оси тренажёра — нагрузка ровная по всей амплитуде.'});
    }
    return w;
  }
};

// ---------- Брусья в тренажёре ----------
SIMS.dip = {
  lo:'низ (локти согнуты)', hi:'руки прямые', con:'Дави вниз', ecc:'Поднимай рукояти медленно',
  params:[{id:'lean',label:'Наклон корпуса',min:0,max:30,step:1,def:8,fmt:x=>x<4?'вертикально':`вперёд ${x}°`},{id:'depth',label:'Глубина',min:.4,max:1,step:.05,def:.7,fmt:x=>x>.85?'плечо ниже локтя':x<.55?'короткая':'плечо на уровне локтя'}],
  presets:{triceps:{lean:2,depth:.7},chest:{lean:25,depth:.8}},
  pose(p,t){
    const face=1, H=v(0,.55), td=dirA(90-p.lean), S=add(H,mul(td,BODY.to)), K=add(H,v(BODY.th,0)), A=add(K,v(.03,-BODY.sh+.1));
    const aL=BODY.ua+BODY.fa;
    const Wb=add(S,v(lerp(.12,.06,p.depth),-lerp(.32,.18,p.depth))), Wt=add(S,v(.06,-aL+.03)), W=lerpV(Wb,Wt,ease(t));
    const E=ik(S,W,BODY.ua,BODY.fa,face);
    return {face,J:{S,H,K,A,E,W,head:headOf(S,H),...flatFoot(A,face)},
      props:[{t:'line',a:v(-.2,.48),b:add(K,v(-.05,-.07)),w:.07,c:'pad'},{t:'line',a:add(W,v(-.06,0)),b:add(W,v(.06,0)),w:.04,c:'mach'},{t:'line',a:add(W,v(.06,0)),b:v(W.x+.06,0),w:.03,c:'mach'}],
      forces:[{p:W,d:v(0,1),m:1,k:'load',main:true}]};
  },
  analyze(P,p){
    const {S,E,W}=P.J, F=[P.forces[0]], el=demand(E,W,S,F), sh=Math.abs(torque(S,F[0]));
    const ch=clamp(.4+p.lean/30*.3,.3,.7);
    return {loads:{triceps:(el.close?el.M:0)+sh*.15,chest:sh*ch,frontdelt:sh*(.85-ch)},arms:[{J:E,F:F[0],m:'triceps'},{J:S,F:F[0],m:'chest'}]};
  },
  check(bot,top,p){
    const w=[];
    if(p.depth>.85)w.push({lv:'warn',tx:'Глубоко: плечо уходит ниже локтя, передняя капсула плеча сильно растянута. При дискомфорте в плече останавливайся раньше.'});
    w.push({lv:'ok',tx:p.lean>15?'Наклон вперёд добавляет работы нижней части груди.':'Корпус вертикально — основная работа у трицепса.'});
    return w;
  }
};

// ---------- Обратная бабочка и тяга к лицу (вид сверху) ----------
SIMS.rfly = {
  frontal:true,
  paramsFor(cfg){return cfg.kind==='facepull'?[{id:'end',label:'Конец движения',min:-20,max:20,step:1,def:0,fmt:x=>x<-8?'локти за линией плеч':x>8?'не доводишь':'локти в линии плеч ✓'},{id:'scap',label:'Лопатки',min:0,max:1,step:.05,def:.5,fmt:x=>x<.3?'не сводятся':x>.7?'сводятся сильно':'сводятся в конце'}]
    :[{id:'eb',label:'Сгибание локтей',min:0,max:60,step:1,def:15,fmt:x=>`${x}°`},{id:'end',label:'Конец движения',min:-25,max:15,step:1,def:0,fmt:x=>x<-10?'руки за линией плеч':x>8?'не доводишь':'руки в линии плеч ✓'},{id:'scap',label:'Лопатки',min:0,max:1,step:.05,def:.2,fmt:x=>x<.3?'не сводятся ✓ (дельта)':x>.7?'сводятся (середина спины)':'немного'}]},
  presetsFor(){return {reardelt:{eb:15,end:0,scap:.1},upperback:{eb:25,end:-8,scap:.9}}},
  labels(cfg){return cfg.kind==='facepull'?{lo:'старт (руки вперёд)',hi:'канат у лица',con:'Тяни к лицу, локти в стороны',ecc:'Отпускай'}:{lo:'старт (руки впереди)',hi:'руки разведены',con:'Разводи руки',ecc:'Своди медленно'}},
  pose(p,t,cfg){
    const S=v(.2,0), fp=cfg.kind==='facepull', phi=lerp(80,p.end,ease(t)), eb=fp?lerp(5,95,ease(t)):p.eb;
    const E=add(S,mul(dirA(phi),BODY.ua)), W=add(E,mul(dirA(phi+eb),BODY.fa));
    const J={S,E,W,Sl:v(-S.x,S.y),El:v(-E.x,E.y),Wl:v(-W.x,W.y)};
    const props=[{t:'line',a:v(-.32,-.2),b:v(.32,-.2),w:.07,c:'pad'}];
    let forces;
    if(fp){const Pc=v(0,1.15);props.push({t:'circle',p:Pc,r:.05,c:'mach'},{t:'cable',a:W,b:Pc},{t:'cable',a:J.Wl,b:Pc});forces=[{p:W,d:nrm(sub(Pc,W)),m:1,k:'cable',main:true},{p:J.Wl,d:nrm(sub(Pc,J.Wl)),m:1,k:'cable'}]}
    else{props.push({t:'circle',p:W,r:.05,c:'pad'},{t:'circle',p:J.Wl,r:.05,c:'pad'},{t:'axis',p:S});forces=[{p:W,d:ccw(nrm(sub(W,S))),m:1,k:'load',main:true},{p:J.Wl,d:cw(nrm(sub(J.Wl,J.Sl))),m:1,k:'load'}]}
    return {face:1,frontal:true,kind:'pull',J,props,forces,t};
  },
  analyze(P,p,cfg){
    const {S,E,W}=P.J, F=[P.forces[0]], sh=Math.abs(torque(S,F[0])), ub=clamp(.18+.45*p.scap,.15,.65);
    const L={reardelt:sh*(1-ub)*(cfg.kind==='facepull'?.8:1),upperback:sh*ub,middelt:cfg.kind==='facepull'?sh*.12:0,traps:sh*ub*.25};
    return {loads:L,arms:[{J:S,F:F[0],m:'reardelt'}]};
  },
  check(bot,top,p,cfg){
    const w=[];
    if(cfg.kind==='facepull'){w.push({lv:'ok',tx:'Тяга к лицу с локтями в стороны и кистями выше локтей укрепляет заднюю дельту и наружные ротаторы — полезна для здоровья плеча.'});if(p.end<-10)w.push({lv:'warn',tx:'Локти уходят далеко за линию плеч — поясница прогибается, работа уходит в корпус.'})}
    else{if(p.scap>.6)w.push({lv:'ok',tx:'Сведение лопаток подключает середину спины. Чтобы изолировать заднюю дельту — держи лопатки неподвижно.'});else w.push({lv:'ok',tx:'Лопатки на месте — работает задняя дельта.'});if(p.end<-10)w.push({lv:'warn',tx:'Руки далеко за линией плеч — рычаг на дельте исчезает, работают лопатки.'})}
    return w;
  }
};

// ---------- Пресс и разгибание спины: тренажёр, блок, скамья, упор ----------
SIMS.trunk = {
  paramsFor(cfg){
    if(cfg.kind==='captain')return [{id:'knee',label:'Колени',min:0,max:100,step:1,def:80,fmt:x=>x<15?'ноги прямые':`согнуты ${x}°`},{id:'curl',label:'Подкручивание таза',min:0,max:1,step:.05,def:.6,fmt:x=>x<.25?'нет — работают сгибатели бедра':x>.7?'сильное ✓':'частичное'}];
    if(cfg.kind==='backext')return [{id:'start',label:'Наклон на старте',min:20,max:60,step:1,def:40,fmt:x=>`${x}°`},{id:'end',label:'Конец движения',min:-20,max:5,step:1,def:0,fmt:x=>x<-8?`прогиб назад ${-x}°`:'вертикально ✓'}];
    const b=[{id:'curl',label:'Как сгибаешься',min:0,max:1,step:.05,def:.75,fmt:x=>x<.3?'наклон в тазу (сгибатели бедра)':x>.65?'скручивание позвоночника ✓':'смешанно'}];
    if(cfg.kind==='roman')b.push({id:'dec',label:'Наклон скамьи',min:0,max:35,step:1,def:15,fmt:x=>x?`${x}°`:'горизонтально'});
    return b;
  },
  presetsFor(cfg){return cfg.kind==='backext'?{erectors:{start:40,end:0}}:cfg.kind==='captain'?{abs:{knee:70,curl:.9}}:{abs:{curl:.9,dec:15}}},
  labels(cfg){return {machine:{lo:'старт (корпус прямо)',hi:'скручен',con:'Скручивайся',ecc:'Возвращайся'},cable:{lo:'старт',hi:'скручен',con:'Своди рёбра к тазу',ecc:'Поднимайся'},roman:{lo:'лёжа',hi:'корпус поднят',con:'Скручивайся',ecc:'Опускайся медленно'},captain:{lo:'ноги внизу',hi:'колени к груди',con:'Поднимай колени и таз',ecc:'Опускай без раскачки'},backext:{lo:'наклон вперёд',hi:'корпус вертикально',con:'Разгибайся',ecc:'Наклоняйся медленно'}}[cfg.kind]},
  pose(p,t,cfg){
    const face=1, k=cfg.kind, e=ease(t);
    const spine=(H,base,flex,sf)=>{const hipF=flex*(1-sf),lumF=flex*sf;const ld=rotV(base,-hipF-lumF*.35),ud=rotV(base,-hipF-lumF);const L=add(H,mul(ld,.22));return {L,S:add(L,mul(ud,BODY.to-.22)),ud}};
    if(k==='captain'){
      const S=v(0,1.45), H=v(0,1.45-BODY.to), L=add(H,v(0,.22)), hf=lerp(5,lerp(70,105,p.curl),e);
      const H2=add(H,mul(v(-1,0),.06*p.curl*e)), thd=dirA(-90+hf), K=add(H2,mul(thd,BODY.th)), sd=rotV(thd,-p.knee*Math.min(1,e*1.5+.3)), A=add(K,mul(sd,BODY.sh)), sa=ant(sd,face);
      const W=add(S,v(.28,-.05)), E=add(S,v(.25,-.22));
      return {face,J:{S,H:H2,K,A,E,W,L,head:add(S,v(0,BODY.nk)),heel:add(A,mul(sa,-.05)),toe:add(A,add(mul(sd,.05),mul(sa,.15)))},
        props:[{t:'line',a:v(-.1,1.6),b:v(-.1,.6),w:.08,c:'pad'},{t:'line',a:add(E,v(-.12,-.02)),b:add(E,v(.14,-.02)),w:.06,c:'pad'},{t:'line',a:v(-.2,2),b:v(-.2,0),w:.05,c:'mach'}],
        forces:[{p:lerpV(H2,K,.5),d:v(0,-1),m:.2,k:'load',main:true},{p:lerpV(K,A,.5),d:v(0,-1),m:.1,k:'load'}],extra:{H0:H}};
    }
    if(k==='roman'){
      const H=v(0,.75), base=dirA(180+p.dec), flex=lerp(0,95+p.dec,e), sf=p.curl, b=spine(H,base,flex,sf);
      const K=add(H,mul(dirA(p.dec*.5),BODY.th)), A=add(K,mul(dirA(-60),BODY.sh)), W=add(b.S,mul(b.ud,-.08)), E=arm(b.S,add(W,v(.02,.02)),-1);
      return {face:-1,J:{S:b.S,H,K,A,E,W,L:b.L,head:add(b.S,mul(b.ud,BODY.nk)),heel:add(A,v(.02,-.04)),toe:add(A,v(.15,.02))},
        props:[{t:'line',a:add(H,mul(base,-.0)),b:add(H,mul(base,.95)),w:.06,c:'pad'},{t:'line',a:add(H,mul(dirA(180+p.dec),-.0)),b:add(add(H,mul(dirA(180+p.dec),.95)),v(0,-.06)),w:.04,c:'mach'},{t:'circle',p:add(A,v(.06,.06)),r:.045,c:'pad'}],
        forces:[{p:add(b.L,mul(nrm(sub(b.S,b.L)),.12)),d:v(0,-1),m:.5,k:'load',main:true},{p:b.S,d:v(0,-1),m:.25,k:'load'}]};
    }
    if(k==='cable'){
      const K=v(0,.08), A=add(K,v(-BODY.sh,0)), H=add(K,v(-.03,BODY.th)), flex=lerp(15,80,e), b=spine(H,dirA(90),flex,p.curl);
      const W=add(b.S,mul(b.ud,.06)), E=add(b.S,mul(rotV(b.ud,-60),BODY.ua*.8)), Pc=v(-.15,2.35);
      return {face,J:{S:b.S,H,K,A,E,W,L:b.L,head:add(b.S,mul(b.ud,BODY.nk)),heel:add(A,v(0,.04)),toe:add(A,v(-.04,-.06))},
        props:[{t:'circle',p:Pc,r:.05,c:'mach'},{t:'cable',a:W,b:Pc},{t:'line',a:v(-.25,2.5),b:v(-.25,0),w:.05,c:'mach'},{t:'line',a:v(-.5,.02),b:v(.2,.02),w:.04,c:'pad'}],
        forces:[{p:W,d:nrm(sub(Pc,W)),m:1,k:'cable',main:true}]};
    }
    // тренажёр: скручивания и разгибание спины сидя
    const H=v(0,.55), Kp=add(H,v(BODY.th,0)), A=add(Kp,v(.02,-BODY.sh+.08)), back=k==='backext';
    const flex=back?lerp(p.start,p.end,e):lerp(-4,38,e), b=spine(H,dirA(90),flex,back?.75:p.curl);
    const pad=add(b.S,mul(b.ud,-.08)), side=back?mul(ant(mul(b.ud,-1),face),-1):ant(mul(b.ud,-1),face);
    const R=add(pad,mul(side,.09)), W=back?add(b.S,mul(side,-.15)):add(R,mul(b.ud,.06)), E=arm(b.S,W,face);
    return {face,J:{S:b.S,H,K:Kp,A,E,W,L:b.L,head:add(b.S,mul(b.ud,BODY.nk)),...flatFoot(A,face)},
      props:[{t:'line',a:v(-.15,.48),b:add(Kp,v(-.05,-.07)),w:.07,c:'pad'},{t:'circle',p:R,r:.06,c:'pad'},{t:'axis',p:H},{t:'line',a:H,b:R,w:.025,c:'mach'},{t:'circle',p:add(A,v(.02,.12)),r:.045,c:'pad'}],
      forces:[{p:pad,d:back?cw(b.ud):ccw(b.ud),m:1,k:'load',main:true}]};
  },
  analyze(P,p,cfg){
    const {H,L}=P.J, k=cfg.kind;
    let mH=0,mL=0;for(const f of P.forces){mH+=torque(H,f);mL+=torque(L,f)}
    mH=Math.abs(mH);mL=Math.abs(mL);
    if(k==='backext')return {loads:{erectors:mL*1.1,glutes:mH*.3,hams:mH*.15},arms:[{J:L,F:P.forces[0],m:'erectors'}]};
    if(k==='captain'){const c=p.curl;return {loads:{abs:mH*(.15+.6*c),obliques:mH*(.05+.12*c),quads:mH*(.55-.35*c)},arms:[{J:H,F:gravC(P.forces),m:'abs'}]}}
    const c=p.curl;
    return {loads:{abs:mL*(.4+.6*c)+mH*.1,obliques:mL*.18,quads:mH*(.45-.35*c)},arms:[{J:L,F:k==='roman'?gravC(P.forces):P.forces[0],m:'abs'}]};
  },
  forceShown(P,p,cfg){return cfg&&(cfg.kind==='roman'||cfg.kind==='captain')?gravC(P.forces):null},
  check(bot,top,p,cfg){
    const w=[], k=cfg.kind;
    if(k==='backext'){if(p.end<-8)w.push({lv:'warn',tx:'Прогиб назад в конце нагружает задние отделы позвонков. Заканчивай в вертикали.'});w.push({lv:'ok',tx:'Двигайся медленно, без рывка, с умеренным весом — разгибатели спины тренируются выносливостью.'});return w}
    if(k==='captain'){if(p.curl<.3)w.push({lv:'warn',tx:'Таз не подкручивается — ноги поднимают сгибатели бедра (подвздошно-поясничная и прямая мышца бедра), пресс почти не работает. В конце подкрути таз к груди.'});else w.push({lv:'ok',tx:'Подкручивание таза наверху — тут и работает прямая мышца живота.'});if(p.knee<20)w.push({lv:'ok',tx:'Прямые ноги — длинный рычаг, это сложнее. Начинай с согнутых коленей.'});return w}
    if(p.curl<.35)w.push({lv:'warn',tx:'Наклон идёт в тазу, а не в позвоночнике — работают сгибатели бедра. Своди рёбра к тазу, округляя спину.'});
    else w.push({lv:'ok',tx:'Скручивание позвоночника — основная функция прямой мышцы живота.'});
    if(k==='roman'&&p.dec>25)w.push({lv:'ok',tx:'Крутой наклон скамьи увеличивает нагрузку — добавляй постепенно.'});
    return w;
  }
};

// ---------- Подъём гантелей на бицепс стоя ----------
SIMS.curlfree = {
  lo:'старт (рука прямая)', hi:'верх (рука согнута)', con:'Сгибай', ecc:'Опускай медленно',
  params:[{id:'e',label:'Локти',min:-20,max:40,step:1,def:4,fmt:x=>x<-6?`назад ${-x}°`:x<6?'у корпуса':`вперёд ${x}°`},{id:'swing',label:'Раскачка корпусом',min:0,max:1,step:.05,def:0,fmt:x=>x<.15?'нет ✓':x>.5?'сильная':'немного'}],
  presets:{biceps:{e:-8,swing:0},forearms:{e:2,swing:0}},
  pose(p,t){
    const face=1, st=stand(face), lean=-12*p.swing*Math.sin(Math.PI*t), td=dirA(90+lean), S=add(st.H,mul(td,BODY.to));
    const ad=dirA(-90+p.e), E=add(S,mul(ad,BODY.ua)), a0=-90+p.e, W=add(E,mul(dirA(lerp(a0+8,a0+140,ease(t))),BODY.fa));
    return {face,J:{...st,S,E,W,head:headOf(S,st.H)},props:[{t:'plate',p:W,r:.07}],forces:[{p:W,d:v(0,-1),m:1,k:'load',main:true}]};
  },
  analyze(P,p){const {S,E,W}=P.J,F=[P.forces[0]],el=demand(E,W,S,F),sh=shoulderDemand(S,F,P.face);
    return {loads:{biceps:el.close?0:el.M*.8*(1-.4*p.swing),forearms:el.close?0:el.M*.2,frontdelt:sh.M*.12,erectors:p.swing*.1},arms:[{J:E,F:F[0],m:'biceps'}]}},
  check(bot,top,p){
    const w=[];
    if(p.e>15)w.push({lv:'warn',tx:'Локти вперёд — наверху предплечье вертикально и бицепс разгружается, а работу забирает передняя дельта.'});
    if(p.e<-6)w.push({lv:'ok',tx:'Локти чуть позади корпуса — бицепс растянут внизу, как в подъёме на наклонной скамье.'});
    if(p.swing>.2)w.push({lv:'warn',tx:'Раскачка корпусом забирает нагрузку у бицепса и грузит поясницу. Сбрось вес.'});
    if(!w.length)w.push({lv:'ok',tx:'Пик нагрузки там, где предплечье горизонтально, — в середине амплитуды.'});
    return w;
  }
};

// ---------- Привязка моделей к тренажёрам без модели ----------
(()=>{
  const MAP2={pendulum:['hack',{}],beltsquat:['smith',{}],seatedcurl:['kneecurl',{pos:'seated'}],standingcurl:['kneecurl',{pos:'standing'}],ghd:['kneecurl',{pos:'ghd'}],
    glutekick:['kick',{kind:'machine'}],cablekick:['kick',{kind:'cable'}],reversehyper:['kick',{kind:'reverse'}],calfpress:['calf',{knee:0}],
    tbar:['row',{}],hammerrow:['row',{}],gravitron:['pulldown',{}],shrug:['shrug',{}],backext:['trunk',{kind:'backext'}],
    inclinehammer:['press2',{kind:'bench',incl:30}],dipmachine:['dip',{}],reversefly:['rfly',{kind:'reverse'}],facepull:['rfly',{kind:'facepull'}],
    uprightrow:['upright',{}],overheadcable:['triext',{kind:'overhead'}],tricepsmachine:['triext',{kind:'machine'}],
    abcrunch:['trunk',{kind:'machine'}],cablecrunch:['trunk',{kind:'cable'}],captain:['trunk',{kind:'captain'}],romanchair:['trunk',{kind:'roman'}]};
  for(const e of EX)if(!e.sim&&MAP2[e.id]){e.sim=MAP2[e.id][0];e.cfg=MAP2[e.id][1]}
  // наклон скамьи из cfg для наклонного жима
  const pf=SIMS.press2.paramsFor;SIMS.press2.paramsFor=function(cfg){const b=pf.call(this,cfg);if(cfg.incl!=null){const i=b.find(x=>x.id==='incl');if(i)i.def=cfg.incl}return b};
  const lf=SIMS.lateral.paramsFor;SIMS.lateral.paramsFor=function(cfg){const b=lf.call(this,cfg);if(cfg.kind==='db')b[0].def='db';return b};
})();

// ---------- Свободные веса ----------
EX.push(
 {id:'deadlift',n:'Становая тяга',aka:'классическая становая, deadlift',cat:'back',eq:'Свободный вес',mus:{glutes:3,erectors:3,hams:2,quads:2,adductors:1,traps:1,forearms:1},sim:'hinge',cfg:{kind:'conv'},
  setup:['Гриф над серединой стопы, стопы на ширине таза.','Хват чуть шире ног, руки вертикальны.','Голени касаются грифа, таз ниже плеч, спина нейтральная.'],
  steps:['Вдох животом, напряги корпус и «убери слабину» — натяни гриф, не отрывая.','Толкай пол ногами, гриф идёт вплотную к голеням и бёдрам.','Наверху выпрямись, не отклоняясь назад. Опускай тем же путём: таз назад, потом колени.'],
  err:['Гриф уходит от ног.','Округление спины под весом.','Рывок с пола, «хлыст» поясницей.','Отклонение назад наверху.'],
  focus:{glutes:'Таз средне, сильное разгибание таза наверху.',quads:'Таз ниже, колени вперёд на старте — ближе к приседу.',erectors:'Спина держит нейтраль весь подход — это и есть работа разгибателей.'}},
 {id:'rdl',n:'Румынская тяга',aka:'RDL, тяга на прямых ногах',cat:'legs',eq:'Свободный вес',mus:{hams:3,glutes:3,erectors:2,forearms:1,adductors:1},sim:'hinge',cfg:{kind:'rdl'},
  setup:['Стоя с грифом в руках, стопы на ширине таза.','Колени слегка согнуты и почти не двигаются.'],
  steps:['Отводи таз назад, гриф скользит по бёдрам.','Опускайся, пока спина ровная и чувствуешь растяжение задней поверхности.','Таз вперёд — вернись в стойку.'],
  err:['Сгибание в пояснице вместо таза.','Колени сгибаются — получается присед.','Гриф далеко от ног.'],
  focus:{hams:'Колени почти прямые, глубже — до середины голени.',glutes:'Колени чуть больше согнуты, акцент на разгибании таза наверху.'}},
 {id:'benchpress',n:'Жим штанги лёжа',aka:'жим лёжа, bench press',cat:'chest',eq:'Свободный вес',mus:{chest:3,triceps:2,frontdelt:2},sim:'press2',cfg:{kind:'bench'},
  setup:['Глаза под грифом, лопатки сведены и опущены.','Стопы упираются в пол, лёгкий прогиб в груди.','Хват чуть шире плеч, запястья над локтями.'],
  steps:['Сними гриф, выведи над плечами.','Опускай к низу груди за 2 с, локти примерно 45–70° к корпусу.','Жми вверх и чуть назад, к плечам.'],
  err:['Локти строго в стороны (90°).','Отрыв таза от скамьи.','Отбив грифа от груди.','Без страховки на тяжёлых весах.'],
  focus:{chest:'Хват шире, локти 60–70°.',triceps:'Хват на ширине плеч, локти ближе к корпусу.',frontdelt:'Наклонная скамья 30°.'}},
 {id:'dbpress',n:'Жим гантелей сидя',aka:'жим гантелей над головой',cat:'shoulders',eq:'Свободный вес',mus:{frontdelt:3,middelt:2,triceps:2},sim:'press2',cfg:{kind:'ohp'},
  setup:['Спинка скамьи 75–85°.','Гантели у плеч, предплечья вертикальны.'],
  steps:['Жми вверх, не сталкивая гантели наверху.','Опускай до уровня ушей или чуть ниже.'],
  err:['Сильный прогиб в пояснице.','Локти уходят далеко назад.'],
  focus:{frontdelt:'Локти немного вперёд, нейтральный хват.',middelt:'Локти больше в стороны.'}},
 {id:'dblateral',n:'Махи гантелями в стороны',aka:'разведения гантелей стоя',cat:'shoulders',eq:'Свободный вес',mus:{middelt:3,traps:1},sim:'lateral',cfg:{kind:'db'},
  setup:['Стоя, лёгкий наклон вперёд, локти чуть согнуты.'],
  steps:['Поднимай руки в стороны локтями до уровня плеч.','Опускай за 2–3 с.'],
  err:['Подъём плеч к ушам.','Раскачка корпусом.','Слишком тяжёлые гантели.'],
  focus:{middelt:'Плечи опущены, мизинец не выше большого пальца.'}},
 {id:'dbcurl',n:'Подъём гантелей на бицепс',aka:'сгибание рук с гантелями стоя',cat:'arms',eq:'Свободный вес',mus:{biceps:3,forearms:2},sim:'curlfree',cfg:{},
  setup:['Стоя, локти у корпуса, ладони вперёд.'],
  steps:['Сгибай руки, не двигая локтями.','Опускай медленно до прямых рук.'],
  err:['Раскачка корпусом.','Локти уходят вперёд.'],
  focus:{biceps:'Супинация — ладонь поворачивается вверх.',forearms:'Хват «молот» — ладони друг к другу.'}},
 {id:'pullup',n:'Подтягивания',aka:'подтягивания на турнике',cat:'back',eq:'Турник',mus:{lats:3,upperback:2,biceps:2,reardelt:1},sim:'pulldown',cfg:{},
  setup:['Хват чуть шире плеч, вис на прямых руках.'],
  steps:['Сведи лопатки вниз, потом тяни локти к рёбрам.','Подбородок над перекладиной, опускайся до прямых рук.'],
  err:['Рывки ногами.','Неполная амплитуда внизу.'],
  focus:{lats:'Локти к рёбрам, хват средний.',biceps:'Обратный узкий хват.'}}
);
Object.assign(ICONS,{deadlift:ICONS.rack,rdl:ICONS.hyper45||ICONS.rack,benchpress:ICONS.smithbench,dbpress:ICONS.shoulderpress,dblateral:ICONS.lateralmachine,dbcurl:ICONS.preacher,pullup:ICONS.latpull});
// ограничения для новых упражнений
CONCERNS.back.ex.deadlift=['avoid','Осевая нагрузка и большой момент на поясницу. В период боли — замени на ягодичный мост и сгибания ног.'];
CONCERNS.back.ex.rdl=['care','Только с ровной спиной и умеренным весом, амплитуда — до колен.'];
CONCERNS.back.ex.reversehyper=['care','Без прогиба вверху, ноги до горизонтали, без раскачки.'];
CONCERNS.back.ex.captain=['care','Без раскачки и прогиба поясницы, колени согнуты.'];
CONCERNS.shoulder.ex.benchpress=['care','Локти 45° к корпусу, гриф к низу груди, без отбива.'];
CONCERNS.shoulder.ex.dbpress=['care','Нейтральный хват, локти немного вперёд, амплитуда без боли.'];
CONCERNS.shoulder.ex.uprightrow=['avoid','Тяга к подбородку сужает подакромиальное пространство. Замени на махи в стороны до уровня плеч.'];
CONCERNS.knee.ex.pendulum=['care','Глубина без боли, колени по направлению носков.'];
