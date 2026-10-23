// Dev-only: responsive audit at multiple window sizes (single window, DOM-based).
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

ipcMain.handle('store:get', () => null);
ipcMain.handle('store:set', () => true);
ipcMain.handle('app:info', () => ({ version: '1.0.0', platform: process.platform, electron: process.versions.electron }));
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('shell:open', () => true);

function auditJs() {
  return `(() => {
    const vw = innerWidth, vh = innerHeight;
    const bad = [];
    for (const el of document.querySelectorAll('.screen.active *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) {
        bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/)[0]) +
          ' [' + [r.left, r.top, r.right, r.bottom].map(n => Math.round(n)).join(',') + ']');
      }
    }
    const scrollers = [];
    for (const el of document.querySelectorAll('.screen.active')) {
      if (el.scrollHeight > el.clientHeight + 2) scrollers.push('screen clipped ' + el.scrollHeight + '>' + el.clientHeight);
    }
    return { vw, vh, bad: bad.slice(0, 12), scrollers };
  })()`;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 900, show: true, offscreen: true, backgroundColor: '#070a12',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, offscreen: true, sandbox: false }
  });
  await win.loadFile(path.join(root, 'src', 'index.html'));
  await sleep(2000);
  const run = js => win.webContents.executeJavaScript(js, true);

  const sizes = [[1286, 708], [1024, 640], [960, 600], [900, 560]];
  for (const [w, h] of sizes) {
    win.setContentSize(w, h);
    await sleep(400);

    const report = {};
    const visit = async (label, js) => {
      await run(js);
      await sleep(350);
      report[label] = await run(auditJs());
    };

    await visit('home', `document.querySelector('#go-home')?.click?.(); document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.querySelector('#screen-home').classList.add('active');`);
    await visit('setup', `document.querySelector('#go-local').click()`);
    await visit('online', `(()=>{document.querySelector('[data-back="home"]').click();})()`);
    await run(`document.querySelector('#go-online').click()`); await sleep(300);
    report['online'] = await run(auditJs());
    await run(`document.querySelector('[data-back="home"]').click()`); await sleep(200);
    await visit('words', `document.querySelector('#go-words').click()`);
    await run(`document.querySelector('[data-back="home"]').click()`); await sleep(200);
    await run(`document.querySelector('#go-local').click()`); await sleep(250);
    await run(`document.querySelector('#start-local').click()`); await sleep(400);
    await run(`document.querySelector('#handoff-ok').click()`); await sleep(400);
    report['game'] = await run(auditJs());

    console.log('SIZE ' + w + 'x' + h);
    for (const [k, v] of Object.entries(report)) {
      console.log('  ' + k + ' bad=' + JSON.stringify(v.bad) + ' clipped=' + JSON.stringify(v.scrollers));
    }
    await run(`document.querySelector('#exit-game')?.click?.()`);
    await sleep(300);
  }
  app.quit();
}).catch(e => { console.error(e); app.quit(); });
