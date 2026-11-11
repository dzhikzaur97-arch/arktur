// ARKTUR: Космический рубеж — приложение для ПК (Electron). Вся игра лежит внутри приложения (папка app/, собирается
// tools/build-release.js) и открывается по собственному безопасному адресу app://arktur/ — без сервера и без интернета.
// Безопасность: nodeIntegration выключен, contextIsolation и sandbox включены, переход на другие адреса и новые окна запрещены,
// все сетевые запросы (http/https/ws) блокируются, разрешения — только полноэкранный режим, захват мыши и «не гасить экран».
// Сохранения: localStorage источника app://arktur — постоянная папка данных приложения (%APPDATA%\ARKTUR на Windows).
'use strict';
const { app, BrowserWindow, protocol, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const SCHEME = 'app', HOST = 'arktur', ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = path.join(__dirname, 'app');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };
const ALLOWED_PERMS = new Set(['fullscreen', 'pointerLock', 'screen-wake-lock', 'keyboardLock']);

// постоянная папка сохранений с понятным именем; до готовности приложения
app.setPath('userData', path.join(app.getPath('appData'), 'ARKTUR'));
// своя схема как обычный защищённый источник: работают модули ES, fetch и localStorage
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit(); // два окна одной игры писали бы одни сохранения

let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function serveFile(request) {
  let u;
  try { u = new URL(request.url); } catch { return new Response('Bad request', { status: 400 }); }
  if (u.host !== HOST || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('Not found', { status: 404 });
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 }); // никаких ../ за пределы игры
  return fs.promises.readFile(file).then(
    (buf) => new Response(buf, { status: 200, headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } }),
    () => new Response('Not found', { status: 404 }));
}

function lockDown(contents) {
  // только страницы игры: ни перехода на другие адреса, ни новых окон, ни встроенных webview
  contents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });
  contents.on('will-redirect', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // единственный внешний адрес — страница отзывов проекта на GitHub: открывается в системном браузере, не в приложении
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\/dzhikzaur97-arch\/arktur\/issues(\/new)?(\?|$)/.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 600, show: false, backgroundColor: '#02040a',
    title: 'ARKTUR: Space Frontier', icon: path.join(ROOT, 'icons', 'icon-512.png'), autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false, spellcheck: false, devTools: !app.isPackaged || process.env.ARKTUR_DEVTOOLS === '1' }
  });
  lockDown(win.webContents);
  win.once('ready-to-show', () => win.show());
  // F11 и Alt+Enter — полноэкранный режим (меню приложения скрыто)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.loadURL(ORIGIN + '/index.html');
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, serveFile);
  const ses = session.defaultSession;
  // игра полностью офлайн: любые сетевые запросы отменяются
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => cb({ cancel: true }));
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED_PERMS.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => ALLOWED_PERMS.has(perm));
  app.on('web-contents-created', (e, contents) => lockDown(contents));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
