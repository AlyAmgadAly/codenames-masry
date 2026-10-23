// Dev-only: boot the app in dev mode and smoke-test the powerups + traps
// modifiers against the real UI. Runs with a throwaway profile.
import { spawn } from 'node:child_process';
import path from 'node:path';

const port = 9444;
const electron = path.resolve('node_modules/electron/dist/electron.exe');
const udd = path.resolve(process.env.TEMP || '.', 'cnm-modifier-test');
const child = spawn(electron, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let page = null;
for (let i = 0; i < 60 && !page; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch { /* not ready */ }
  if (!page) await sleep(1000);
}
if (!page) { console.log('FAIL: no page'); child.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const click = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setToggle = async (sel, want) => {
  const on = await ev(`document.querySelector(${JSON.stringify(sel)}).classList.contains('on')`);
  if (on !== want) await click(sel);
};

async function openSetup() {
  await click('#go-local');
  await sleep(300);
}

async function startGame({ powerups, traps }) {
  await setToggle('#powerups-toggle', powerups);
  await setToggle('#traps-toggle', traps);
  await click('#start-local');
  await sleep(500);
  await click('#handoff-ok');
  await sleep(300);
  const state = await ev(`({
    powerupBadges: document.querySelectorAll('#board .pu-badge').length,
    trapBadges: document.querySelectorAll('#board .trap-badge').length,
    modChip: !document.querySelector('#mod-chip').hidden,
    trapChip: !document.querySelector('#trap-chip').hidden
  })`);
  // remember trap cards while the spymaster key is on screen
  const trapCards = await ev(`[...document.querySelectorAll('#board .card')]
    .map((b, i) => ({ i, trap: b.querySelector('.trap-badge')?.textContent || null }))
    .filter(x => x.trap)`);
  const powerupCards = await ev(`[...document.querySelectorAll('#board .card')]
    .map((b, i) => ({ i, pu: !!b.querySelector('.pu-badge') }))
    .filter(x => x.pu)`);
  await ev(`(() => {
    const input = document.querySelector('#clue-word');
    input.value = 'اختبار';
    document.querySelector('#clue-send').click();
  })()`);
  await sleep(400);
  await click('#handoff-ok');
  await sleep(250);
  return { state, traps: trapCards, powerups: powerupCards };
}

async function reveal(cardIndex) {
  await ev(`document.querySelectorAll('#board .card')[${cardIndex}].click()`);
  await sleep(600);
  return ev(`({
    puBanner: !document.querySelector('#pu-banner').hidden,
    puText: document.querySelector('#pu-banner').textContent.trim(),
    trapBanner: !document.querySelector('#trap-banner').hidden,
    trapText: document.querySelector('#trap-banner').textContent.trim(),
    trapClass: document.querySelector('#trap-banner').className,
    logTop: document.querySelector('#tab-body .log-row')?.textContent || '',
    logKind: document.querySelector('#tab-body .log-row')?.className || '',
    logTrap: document.querySelector('#tab-body .log-row.trap')?.textContent || '',
    logPower: document.querySelector('#tab-body .log-row.power')?.textContent || '',
    leakBadges: document.querySelectorAll('#board .leak-badge').length,
    keyCards: document.querySelectorAll('#board .card.key').length,
    leakedClass: document.querySelector('#board .card.leaked')?.className || '',
    revealed: document.querySelectorAll('#board .card.rev').length
  })`);
}

await sleep(2500);

// --- game 1: both modifiers on, step on the leak trap ---
await openSetup();
const g1 = await startGame({ powerups: true, traps: true });
const leakTrap = g1.traps.find(t => t.trap === '📢');
const trapIndex = leakTrap ? leakTrap.i : g1.traps[0]?.i;
const trapReveal = trapIndex === undefined ? null : await reveal(trapIndex);

await click('#exit-game');
await sleep(500);

// --- game 2: powerups only, pick up a powerup ---
await openSetup();
const g2 = await startGame({ powerups: true, traps: false });
const puIndex = g2.powerups[0]?.i;
const puReveal = puIndex === undefined ? null : await reveal(puIndex);

console.log(JSON.stringify({
  game1: { state: g1.state, traps: g1.traps, trapIndex, trapReveal },
  game2: { state: g2.state, powerups: g2.powerups, puIndex, puReveal }
}, null, 1));

ws.close();
child.kill();
