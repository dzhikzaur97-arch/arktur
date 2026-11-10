// Сервер-посредник «Рычага» для Cloudflare Workers: принимает вопросы тренеру и фото тренажёров,
// передаёт их в Claude API. Ключ Anthropic хранится только здесь (секрет ANTHROPIC_API_KEY), в приложении его нет.
// Переменные: ANTHROPIC_API_KEY (секрет), APP_KEY (секрет, тот же, что RYCHAG_APP_KEY при сборке), MODEL (необязательно).
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-app-key','access-control-allow-methods':'POST,OPTIONS'};
const bad=(s,t)=>new Response(t,{status:s,headers:CORS});
export default {
  async fetch(req,env){
    if(req.method==='OPTIONS')return new Response(null,{headers:CORS});
    const url=new URL(req.url);
    if(req.method!=='POST'||url.pathname!=='/chat')return bad(404,'not found');
    if(env.APP_KEY&&req.headers.get('x-app-key')!==env.APP_KEY)return bad(401,'unauthorized');
    let body;try{body=await req.json()}catch(e){return bad(400,'bad json')}
    let msgs=(Array.isArray(body.messages)?body.messages:[]).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').slice(-14);
    while(msgs.length&&msgs[0].role!=='user')msgs.shift();
    if(!msgs.length||msgs[msgs.length-1].role!=='user')return bad(400,'no question');
    if(JSON.stringify(msgs).length>60000)return bad(413,'too long');
    const images=(Array.isArray(body.images)?body.images:[]).slice(0,1).filter(i=>i&&typeof i.data==='string'&&i.data.length<7e6);
    const messages=msgs.map((m,i)=>i===msgs.length-1&&images.length?{role:'user',content:[...images.map(im=>({type:'image',source:{type:'base64',media_type:im.type||'image/jpeg',data:im.data}})),{type:'text',text:m.content}]}:m);
    const stream=!!body.stream;
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:env.MODEL||'claude-haiku-5-5',max_tokens:1200,messages,stream})});
    if(r.status===429)return bad(429,'rate limited');
    if(!r.ok)return bad(502,'upstream '+r.status);
    if(!stream){const j=await r.json();return new Response((j.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''),{headers:{...CORS,'content-type':'text/plain; charset=utf-8'}})}
    // SSE Anthropic → простой поток текста
    const {readable,writable}=new TransformStream();const w=writable.getWriter(),enc=new TextEncoder();
    (async()=>{const rd=r.body.getReader(),dec=new TextDecoder();let buf='';
      try{for(;;){const {done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
        while((i=buf.indexOf('\n\n'))>=0){const ev=buf.slice(0,i);buf=buf.slice(i+2);const line=ev.split('\n').find(l=>l.startsWith('data:'));if(!line)continue;
          try{const d=JSON.parse(line.slice(5));if(d.type==='content_block_delta'&&d.delta&&d.delta.type==='text_delta')await w.write(enc.encode(d.delta.text))}catch(e){}}}}
      finally{await w.close().catch(()=>{})}})();
    return new Response(readable,{headers:{...CORS,'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
  }
};
