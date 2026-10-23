// Dev-only screenshot harness: npx electron scripts/shoot.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'shots');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ipcMain.handle('store:get', () => null);
ipcMain.handle('store:set', () => true);
ipcMain.handle('app:info', () => ({ version: '1.0.0', platform: process.platform, electron: process.versions.electron }));
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('shell:open', () => true);

async function shoot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
  console.log('shot', name);
}

async function run(win, js) {
  try {
    return await win.webContents.executeJavaScript(js, true);
  } catch (e) {
    console.error('eval failed', e.message);
    return null;
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: Number(process.env.W || 1360),
    height: Number(process.env.H || 900),
    show: true,
    backgroundColor: '#0a0d16',
    webPreferences: {
      preload: path.join(root, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true
    }
  });

  await win.loadFile(path.join(root, 'src', 'index.html'));
  await sleep(2400);
  await shoot(win, '01-home');

  await run(win, `document.querySelector('#go-local').click()`);
  await sleep(500);
  await shoot(win, '02-setup');

  await run(win, `document.querySelector('#start-local').click()`);
  await sleep(700);
  await shoot(win, '03-handoff');

  await run(win, `document.querySelector('#handoff-ok').click()`);
  await sleep(500);
  await shoot(win, '04-spymaster');

  await run(win, `(() => {
    const i = document.querySelector('#clue-word');
    i.value = 'أكل';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#clue-send').click();
    return true;
  })()`);
  await sleep(600);
  await shoot(win, '05-handoff-guess');

  await run(win, `document.querySelector('#handoff-ok').click()`);
  await sleep(500);
  await shoot(win, '06-guess');

  // reveal two cards, one correct one whatever
  const idxs = await run(win, `(() => {
    const cards = [...document.querySelectorAll('.card')];
    const keyed = cards.map((c, i) => ({ i, cls: c.className }));
    const red = keyed.find(c => c.cls.includes('key-red'));
    const neutral = keyed.find(c => c.cls.includes('key-neutral'));
    return [red?.i, neutral?.i];
  })()`);
  if (idxs && idxs[0] != null) {
    await run(win, `document.querySelector('.card[data-i="${idxs[0]}"]').click()`);
    await sleep(700);
    await shoot(win, '07-revealed');
  }

  // force a few more reveals to show the end screen (uses the real UI)
  await run(win, `(async () => {
    for (let n = 0; n < 30; n++) {
      const btn = document.querySelector('.card:not(.rev):not(.locked)');
      if (!btn) break;
      btn.click();
      await new Promise(r => setTimeout(r, 220));
      const ok = document.querySelector('#overlay-handoff');
      if (ok && !ok.hidden) { document.querySelector('#handoff-ok').click(); await new Promise(r => setTimeout(r, 250)); return; }
      const go = document.querySelector('#overlay-gameover');
      if (go && !go.hidden) return 'over';
    }
    return 'done';
  })()`);
  await sleep(900);
  await shoot(win, '08-after-guesses');

  // rules modal
  await run(win, `document.querySelector('#exit-game').click()`);
  await sleep(400);
  await run(win, `document.querySelector('#go-rules').click()`);
  await sleep(400);
  await shoot(win, '09-rules');
  await run(win, `document.querySelector('#rules-ok').click()`);

  await run(win, `document.querySelector('#go-words').click()`);
  await sleep(400);
  await shoot(win, '10-words');

  await run(win, `document.querySelector('#go-online').click()`);
  await sleep(400);
  await shoot(win, '11-online');

  await sleep(300);
  app.quit();
}).catch(e => {
  console.error(e);
  app.quit();
});
