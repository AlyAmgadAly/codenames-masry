// Dev-only layout audit: visits each screen and reports overflow / clipping.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

ipcMain.handle('store:get', () => null);
ipcMain.handle('store:set', () => true);
ipcMain.handle('app:info', () => ({ version: '1.0.0', platform: process.platform, electron: process.versions.electron }));
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('shell:open', () => true);

const AUDIT = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const issues = [];
  const active = document.querySelector('.screen.active');
  for (const el of document.querySelectorAll('.screen.active *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) {
      issues.push({ el: label, out: { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } });
    }
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible' && el.children.length === 0) {
      issues.push({ el: label, textOverflow: el.scrollWidth - el.clientWidth });
    }
  }
  return { screen: active && active.id, vw, vh, docH: document.documentElement.scrollHeight, issues: issues.slice(0, 20) };
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 900, show: true, offscreen: true, backgroundColor: '#070a12',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, offscreen: true, sandbox: false }
  });
  await win.loadFile(path.join(root, 'src/index.html'));
  await sleep(2200);
  const run = js => win.webContents.executeJavaScript(js, true);
  const audit = async (name) => {
    await sleep(350);
    const r = await run(AUDIT);
    console.log(name + ' => ' + JSON.stringify(r));
  };

  await audit('home');
  await run(`document.querySelector('#go-local').click()`); await audit('setup');
  await run(`document.querySelector('[data-back="home"]').click()`); await sleep(250);
  await run(`document.querySelector('#go-online').click()`); await audit('online');
  await run(`document.querySelector('[data-back="home"]').click()`); await sleep(250);
  await run(`document.querySelector('#go-words').click()`); await audit('words');
  await run(`document.querySelector('[data-back="home"]').click()`); await sleep(250);
  await run(`document.querySelector('#go-rules').click()`); await audit('rules-modal');
  await run(`document.querySelector('#rules-ok').click()`); await sleep(250);
  await run(`document.querySelector('#go-local').click()`); await sleep(300);
  await run(`document.querySelector('#start-local').click()`); await audit('handoff');
  await run(`document.querySelector('#handoff-ok').click()`); await audit('spymaster');
  await run(`(() => { const i = document.querySelector('#clue-word'); i.value='أكل'; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#clue-send').click(); })()`);
  await sleep(300);
  await run(`document.querySelector('#handoff-ok').click()`); await audit('guess');
  app.quit();
}).catch(e => { console.error(e); app.quit(); });
