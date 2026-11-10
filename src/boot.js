// ---------- Старт ----------
store.onChange=what=>{
  const h=location.hash.slice(1)||store.tab;
  if(what==='mode'){const m=$('#smode');if(m)m.textContent='Данные сохраняются '+HERE+'.';return}
  renderTopConcerns();
  if(TABS.includes(h))route();
};
window.addEventListener('hashchange',route);
document.querySelector('.nav').addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.getAttribute('href')===location.hash){e.preventDefault();route()}});
syncRx();
route();
connectStore();
initVoice();
