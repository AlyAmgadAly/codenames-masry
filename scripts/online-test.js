// Dev-only: two-window P2P smoke test (host + guest) against the real UI.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const root = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

ipcMain.handle('store:get', () => null);
ipcMain.handle('store:set', () => true);
ipcMain.handle('app:info', () => ({ version: '1.0.0', platform: process.platform, electron: process.versions.electron }));
ipcMain.handle('clipboard:write', () => true);
ipcMain.handle('shell:open', () => true);

function makeWin() {
  return new BrowserWindow({
    width: 1280, height: 800, show: false, backgroundColor: '#070a12',
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
}

async function waitFor(win, expr, ms = 30000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const v = await win.webContents.executeJavaScript(expr, true);
    if (v) return v;
    await sleep(400);
  }
  return null;
}

app.whenReady().then(async () => {
  const H = makeWin();
  const G = makeWin();
  const h = js => H.webContents.executeJavaScript(js, true);
  const g = js => G.webContents.executeJavaScript(js, true);

  await Promise.all([
    H.loadFile(path.join(root, 'src', 'index.html')),
    G.loadFile(path.join(root, 'src', 'index.html'))
  ]);
  await sleep(2500);

  // host creates a room
  await h(`document.querySelector('#go-online').click()`);
  await sleep(300);
  await h(`(() => { const i = document.querySelector('#player-name'); i.value = 'هوست'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await h(`document.querySelector('#create-room').click()`);

  const lobbyH = await waitFor(H, `document.querySelector('.screen.active')?.id === 'screen-lobby' ? document.querySelector('#room-code').textContent.trim() : ''`, 30000);
  console.log('HOST lobby:', lobbyH);
  if (!lobbyH || !/^[A-Z0-9]{5}$/.test(lobbyH)) {
    console.log('HOST STATUS:', await h(`document.querySelector('#toast')?.textContent + ' | ' + (document.querySelector('#create-room')?.textContent||'')`));
    app.quit();
    return;
  }

  // guest joins
  await g(`document.querySelector('#go-join').click()`);
  await sleep(300);
  await g(`(() => { const n = document.querySelector('#player-name'); n.value = 'ضيف'; n.dispatchEvent(new Event('input',{bubbles:true})); const c = document.querySelector('#join-code'); c.value = '${lobbyH}'; c.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await g(`document.querySelector('#join-room').click()`);

  const lobbyG = await waitFor(G, `document.querySelector('.screen.active')?.id === 'screen-lobby' ? 'yes' : ''`, 35000);
  console.log('GUEST lobby:', lobbyG);
  console.log('GUEST toast:', await g(`document.querySelector('#toast')?.textContent || '(none)'`));

  await sleep(1200);
  const hostPlayers = await h(`document.querySelectorAll('#players-list .player').length`);
  const guestPlayers = await g(`document.querySelectorAll('#players-list .player').length`);
  console.log('players host/guest:', hostPlayers, guestPlayers);

  // host starts the game (with the powerups modifier on)
  console.log('HOST btn:', await h(`(() => { const b = document.querySelector('#lobby-start'); return { screen: document.querySelector('.screen.active')?.id, hidden: b.hidden, disabled: b.disabled, text: b.textContent.trim() }; })()`));
  await h(`document.querySelector('#lobby-powerups-toggle').click()`);
  console.log('POWERUPS toggle host:', await h(`document.querySelector('#lobby-powerups-toggle').classList.contains('on')`));
  await h(`document.querySelector('#lobby-start').click()`);
  await sleep(1500);
  console.log('HOST after click:', JSON.stringify(await h(`({
    screen: document.querySelector('.screen.active')?.id,
    toast: document.querySelector('#toast')?.textContent || '',
    toastHidden: document.querySelector('#toast')?.hidden,
    cards: document.querySelectorAll('.card').length
  })`)));
  const hostGame = await waitFor(H, `document.querySelector('.screen.active')?.id === 'screen-game' ? document.querySelectorAll('.card').length : 0`, 10000);
  const guestGame = await waitFor(G, `document.querySelector('.screen.active')?.id === 'screen-game' ? document.querySelectorAll('.card').length : 0`, 10000);
  console.log('cards host/guest:', hostGame, guestGame);
  console.log('powerup badges host/guest:', await h(`document.querySelectorAll('.pu-badge').length`), await g(`document.querySelectorAll('.pu-badge').length`));

  await sleep(800);
  const view = await g(`(() => {
    const cards = [...document.querySelectorAll('.card')];
    return {
      colored: cards.filter(c => /key-/.test(c.className)).length,
      role: document.querySelector('#me-badge')?.textContent?.trim(),
      hasClueBox: !!document.querySelector('#clue-word'),
      clueVisible: !document.querySelector('#clue-box')?.hidden,
      turn: document.querySelector('#turn-pill')?.textContent?.trim()
    };
  })()`);
  console.log('GUEST view:', JSON.stringify(view));

  // host sends a clue, guest should receive it
  const hostClue = await h(`(() => {
    const i = document.querySelector('#clue-word');
    if (!i) return 'no clue input';
    i.value = 'أكل'; i.dispatchEvent(new Event('input',{bubbles:true}));
    const n = document.querySelector('#clue-num'); if (n) { n.value = '2'; n.dispatchEvent(new Event('input',{bubbles:true})); }
    document.querySelector('#clue-send').click();
    return 'sent';
  })()`);
  console.log('HOST clue:', hostClue);
  await sleep(1500);
  console.log('GUEST clue box:', JSON.stringify(await g(`document.querySelector('#clue-box').innerText.replace(/\\s+/g,' ').trim()`)));

  // host reveals a powerup card; guest should mirror it and see the banner
  const puIndex = await h(`[...document.querySelectorAll('.card')].findIndex(c => c.querySelector('.pu-badge'))`);
  console.log('revealing powerup card at', puIndex);
  await h(`document.querySelectorAll('.card')[${puIndex}].click()`);
  await sleep(1600);
  const mirrored = await g(`({ revealed: document.querySelectorAll('.card.rev').length, score: document.querySelector('.scoreboard')?.innerText.replace(/\\s+/g,' ').trim(), banner: !document.querySelector('#pu-banner').hidden, bannerText: document.querySelector('#pu-banner').textContent.trim() })`);
  console.log('GUEST after host reveal:', JSON.stringify(mirrored));
  console.log('HOST after reveal:', JSON.stringify(await h(`({ revealed: document.querySelectorAll('.card.rev').length, banner: !document.querySelector('#pu-banner').hidden, turn: document.querySelector('#turn-pill').textContent.trim() })`)));

  // guest chat
  await g(`document.querySelector('#chat-tab').click()`);
  await sleep(300);
  await g(`(() => { const i = document.querySelector('#chat-text'); i.value = 'يلا بينا'; i.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#chat-send').click(); })()`);
  await sleep(1200);
  await h(`document.querySelector('#chat-tab').click()`);
  await sleep(500);
  console.log('HOST chat sees:', JSON.stringify(await h(`document.querySelector('#tab-body').innerText.includes('يلا بينا')`)));

  console.log('HOST errors screen:', await h(`document.querySelector('#toast')?.textContent || ''`));

  app.quit();
}).catch(e => { console.error('FAILED', e); app.quit(); });
