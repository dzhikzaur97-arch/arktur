// ===== Мобильное приложение (Capacitor): замена возможностей claude.ai нативными плагинами =====
// Подключается только в сборке для iOS/Android (rychag-mobile/scripts/build-www.js).
window.RYCHAG_APP=true;
(function(){
  const Cap=window.Capacitor, native=!!(Cap&&Cap.isNativePlatform&&Cap.isNativePlatform());
  const plug=n=>{try{return native&&Cap.registerPlugin?Cap.registerPlugin(n):null}catch(e){return null}};
  const Prefs=plug('Preferences'), Hap=plug('Haptics'), Keep=plug('KeepAwake'), TTS=plug('TextToSpeech'), SR=plug('SpeechRecognition'), SB=plug('StatusBar'), Splash=plug('SplashScreen');
  const CFG=window.RYCHAG_CFG||{};

  // --- Данные: localStorage + копия в нативном хранилище (iOS может чистить данные WebView) ---
  if(Prefs){
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){set.call(this,k,v);if(this===window.localStorage&&/^rychag/.test(k))Prefs.set({key:k,value:String(v)}).catch(()=>{})};
    if(!localStorage.getItem('rychag.v1')){
      Prefs.get({key:'rychag.v1'}).then(r=>{if(r&&r.value&&!localStorage.getItem('rychag.v1')){Prefs.keys().then(async({keys})=>{for(const k of keys){const x=await Prefs.get({key:k});if(x.value!=null)set.call(localStorage,k,x.value)}location.reload()})}}).catch(()=>{});
    }
  }
  // --- Вибрация и экран без блокировки ---
  if(Hap&&!navigator.vibrate)navigator.vibrate=p=>{const d=Array.isArray(p)?p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0):p;Hap.vibrate({duration:Math.min(600,d||60)}).catch(()=>{});return true};
  if(Keep){const wl={request:async()=>{await Keep.keepAwake();const l={released:false,addEventListener(){},release:async()=>{l.released=true;await Keep.allowSleep()}};return l}};try{Object.defineProperty(navigator,'wakeLock',{value:wl,configurable:true})}catch(e){}}
  if(SB){SB.setStyle({style:'DARK'}).catch(()=>{});SB.setBackgroundColor&&SB.setBackgroundColor({color:'#0c0d12'}).catch(()=>{})}
  if(Splash)setTimeout(()=>Splash.hide().catch(()=>{}),250);

  // --- Голос: нативный синтез речи ---
  function ttsShim(){
    if(!TTS)return null;
    const subs=new Set();let state='idle';
    const emit=(s,reason)=>{state=s;subs.forEach(f=>{try{f({state:s,reason})}catch(e){}})};
    let rate=1;
    return {
      speak(text,o={}){const t=Array.isArray(text)?text.map(x=>x.text).join(' '):String(text);emit('speaking');
        return TTS.speak({text:t.slice(0,2000),lang:'ru-RU',rate:Math.max(.5,Math.min(1.8,o.rate||rate)),pitch:1,volume:1,category:'ambient',queueStrategy:0})
          .then(()=>emit('idle','completed'),e=>{emit('idle','error');throw {code:'error',message:String(e&&e.message||e)}})},
      stop(){TTS.stop().catch(()=>{});emit('idle','viewer_stopped')},
      setRate(r){rate=r},
      onState(f){subs.add(f);return()=>subs.delete(f)}
    };
  }
  // --- Диктовка: нативное распознавание речи ---
  function dictShim(){
    if(!SR)return null;
    const P=new Set(),F=new Set(),S=new Set();let last='',on=false,silT=0,hs=[];
    const st=(state,reason)=>S.forEach(f=>f({state,reason}));
    const finish=reason=>{if(!on)return;on=false;clearTimeout(silT);hs.forEach(h=>h&&h.remove&&h.remove());hs=[];const t=last.trim();last='';if(t)F.forEach(f=>f({text:t}));st('idle',reason)};
    return {
      start(){
        st('starting');
        return (async()=>{
          const a=await SR.available().catch(()=>({available:false}));if(!a.available){st('idle','unavailable');throw {code:'unavailable'}}
          let p=await SR.checkPermissions().catch(()=>null);
          if(!p||p.speechRecognition!=='granted')p=await SR.requestPermissions().catch(()=>null);
          if(!p||p.speechRecognition!=='granted'){st('idle','not_granted');throw {code:'not_granted'}}
          on=true;last='';
          hs.push(await SR.addListener('partialResults',d=>{const m=d&&d.matches&&d.matches[0];if(!m)return;last=m;P.forEach(f=>f({text:m}));clearTimeout(silT);silT=setTimeout(()=>{SR.stop().catch(()=>{});finish('stopped')},1600)}));
          hs.push(await SR.addListener('listeningState',d=>{if(d&&d.status==='stopped')finish('stopped')}));
          st('listening');
          silT=setTimeout(()=>{SR.stop().catch(()=>{});finish('stopped')},8000);
          await SR.start({language:'ru-RU',maxResults:1,partialResults:true,popup:false}).catch(e=>{finish('error');throw {code:'error',message:String(e&&e.message||e)}});
        })();
      },
      async stop(){await SR.stop().catch(()=>{});finish('stopped')},
      onPartial(f){P.add(f);return()=>P.delete(f)},onFinal(f){F.add(f);return()=>F.delete(f)},onState(f){S.add(f);return()=>S.delete(f)}
    };
  }
  // --- ИИ (тренер и фото) через свой сервер-прокси к Claude API ---
  async function shrink(blob){
    try{const img=await createImageBitmap(blob);const k=Math.min(1,1280/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.85));return b||blob}catch(e){return blob}
  }
  const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)});
  async function call(path,body,signal){
    let r;try{r=await fetch(CFG.api.replace(/\/$/,'')+path,{method:'POST',headers:{'content-type':'application/json','x-app-key':CFG.appKey||''},body:JSON.stringify(body),signal})}
    catch(e){if(e&&e.name==='AbortError')throw {code:'aborted'};throw {code:'network',message:'Нет связи с сервером'}}
    if(r.status===429)throw {code:'rate_limited'};
    if(!r.ok)throw {code:'error',message:'Сервер ответил '+r.status};
    return r;
  }
  function sampleShim(){
    if(!CFG.api)return null;
    const norm=i=>typeof i==='string'?[{role:'user',content:i}]:i;
    const sample=async(input,o={})=>{
      const imgs=o.images&&o.images.length?await Promise.all(o.images.slice(0,1).map(async b=>({type:'image/jpeg',data:await b64(await shrink(b))}))):[];
      const r=await call('/chat',{messages:norm(input),images:imgs,stream:!!o.onText},o.signal);
      let text='';
      if(o.onText&&r.body&&r.body.getReader){const rd=r.body.getReader(),dec=new TextDecoder();
        try{for(;;){const {done,value}=await rd.read();if(done)break;const d=dec.decode(value,{stream:true});text+=d;o.onText({text,delta:d})}}catch(e){if(e&&e.name==='AbortError')throw {code:'aborted',text};throw e}}
      else text=await r.text();
      return {text,truncated:false};
    };
    sample.json=async(input,o={})=>{const r=await sample(input+'\n\nОтветь только JSON, без пояснений.',{...o,onText:null});const m=r.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);if(!m)throw {code:'invalid_json'};return JSON.parse(m[0])};
    sample.limits=async()=>({images:{maxCount:1,maxInputBytes:2e7,mediaTypes:['image/jpeg','image/png','image/webp','image/heic']}});
    return sample;
  }
  const caps={tts:ttsShim(),dictation:dictShim(),sample:sampleShim()};
  window.claude={use:async n=>caps[n]||null};
})();
