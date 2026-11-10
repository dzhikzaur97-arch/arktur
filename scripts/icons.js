// Рисует иконку и заставку из логотипа «Рычаг» (рычаг, опора и груз)
const {chromium}=require('playwright');const path=require('path');
const logo=(s,bg)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 26 26">${bg?`<rect width="26" height="26" fill="#0c0d12"/><circle cx="13" cy="13" r="12" fill="url(#g)"/><defs><radialGradient id="g" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#232838"/><stop offset="1" stop-color="#0c0d12"/></radialGradient></defs>`:''}
<g transform="translate(13 13.4) scale(.62) translate(-13 -14)"><line x1="3" y1="19" x2="23" y2="9" stroke="#eef0f6" stroke-width="2.4" stroke-linecap="round"/><path d="M10 21.4l3-6.2 3 6.2z" fill="#ff7a2f" stroke="#ff7a2f" stroke-width=".6" stroke-linejoin="round"/><circle cx="23" cy="9" r="2.9" fill="#ff47b5"/><circle cx="23" cy="9" r="4.6" fill="#ff47b5" opacity=".18"/></g></svg>`;
(async()=>{const b=await chromium.launch();const p=await b.newPage();
 const shot=async(file,w,h,html)=>{await p.setViewportSize({width:w,height:h});await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);await p.screenshot({path:path.join(__dirname,'..','assets',file),omitBackground:true})};
 await shot('icon-only.png',1024,1024,logo(1024,true));
 await shot('icon-foreground.png',1024,1024,`<div style="width:1024px;height:1024px;display:grid;place-items:center">${logo(700,false)}</div>`);
 await shot('icon-background.png',1024,1024,'<div style="width:1024px;height:1024px;background:#0c0d12"></div>');
 const splash=(w,h)=>`<div style="width:${w}px;height:${h}px;background:#0c0d12;display:grid;place-items:center"><div style="text-align:center">${logo(560,false)}<div style="font:700 120px system-ui;color:#eef0f6;letter-spacing:4px;margin-top:-40px">Рычаг</div></div></div>`;
 await shot('splash.png',2732,2732,splash(2732,2732));await shot('splash-dark.png',2732,2732,splash(2732,2732));
 await b.close();console.log('ok')})();
