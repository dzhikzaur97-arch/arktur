// Собирает www/ для Capacitor из исходников приложения в src/
// Адрес сервера для тренера и распознавания фото: RYCHAG_API=https://... (и RYCHAG_APP_KEY) — см. README
const fs=require('fs'),path=require('path');
const R=p=>path.join(__dirname,'..',p), www=R('www');
fs.rmSync(www,{recursive:true,force:true});fs.mkdirSync(path.join(www,'fonts','files'),{recursive:true});
// шрифты — локально, приложение работает без интернета
const FONTS=[['golos-text',[400,500,600]],['jetbrains-mono',[500,600]],['unbounded',[500,700]]];
let css='';
for(const [f,ws] of FONTS)for(const w of ws){
  const dir=R(`node_modules/@fontsource/${f}`);let c=fs.readFileSync(path.join(dir,`${w}.css`),'utf8');
  c=c.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g,'');
  for(const m of c.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g))fs.copyFileSync(path.join(dir,'files',m[1]),path.join(www,'fonts','files',m[1]));
  css+=c.replace(/url\(\.\/files\//g,'url(files/')+'\n';
}
fs.writeFileSync(path.join(www,'fonts','fonts.css'),css);
let head=fs.readFileSync(R('src/head.html'),'utf8').split('\n').filter(l=>!/fonts\.(googleapis|gstatic)\.com/.test(l)).join('\n');
const cfg={api:process.env.RYCHAG_API||'',appKey:process.env.RYCHAG_APP_KEY||''};
const order=['platform.js','data.js','sims.js','extra.js','plusdata.js','store.js','no3d.js','ui.js','plus.js','boot.js'];
const js=order.map(f=>fs.readFileSync(R('src/'+f),'utf8')).join('\n');
new Function(js); // проверка синтаксиса
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0c0d12"><meta name="format-detection" content="telephone=no"><link rel="stylesheet" href="fonts/fonts.css"><style>html,body{margin:0;overscroll-behavior:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}[hidden]{display:none!important}</style><script>window.RYCHAG_CFG=${JSON.stringify(cfg)}</script></head><body>
${head}
<script>
${js}
</script>
</body></html>`;
fs.writeFileSync(path.join(www,'index.html'),html);
console.log('www готов:',(html.length/1024).toFixed(0)+' КБ', cfg.api?'· сервер ИИ: '+cfg.api:'· без сервера ИИ (тренер и фото скрыты)');
