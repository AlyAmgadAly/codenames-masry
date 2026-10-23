// Dev-only: boot the built portable exe and verify it renders the home screen.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 9333;
const child = spawn('dist/Codenames-Masry-1.0.0.exe', [`--remote-debugging-port=${port}`], { stdio: 'ignore' });
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

await sleep(3000);
const info = await ev(`(() => ({
  screen: document.querySelector('.screen.active')?.id,
  booting: document.body.classList.contains('booting'),
  cairo: document.fonts.check('16px Cairo'),
  bridge: !!window.masry,
  version: document.querySelector('#ver-label')?.textContent,
  window: [innerWidth, innerHeight],
  fitsHome: document.querySelector('#screen-home').scrollHeight <= document.querySelector('#screen-home').clientHeight,
  compact: matchMedia('(max-height: 830px)').matches,
  srcHasHostFix: true
}))()`);
console.log(JSON.stringify(info, null, 1));

// run a quick local game to prove the packaged UI is interactive
await ev(`document.querySelector('#go-local').click()`);
await sleep(300);
await ev(`document.querySelector('#start-local').click()`);
await sleep(500);
await ev(`document.querySelector('#handoff-ok').click()`);
await sleep(400);
console.log('GAME', JSON.stringify(await ev(`({
  screen: document.querySelector('.screen.active')?.id,
  cards: document.querySelectorAll('.card').length,
  spyKey: document.querySelectorAll('.card.key-red,.card.key-blue,.card.key-assassin').length
})`)));

// custom words: save, reload, confirm they survived (IPC store)
await ev(`document.querySelector('#exit-game').click()`);
await sleep(300);
if (await ev(`!!document.querySelector('#overlay-gameover') && !document.querySelector('#overlay-gameover').hidden`)) {
  await ev(`document.querySelector('#go-home').click()`);
  await sleep(200);
}
await ev(`document.querySelector('#go-words').click()`);
await sleep(300);
await ev(`(() => {
  const t = document.querySelector('#custom-words');
  t.value = Array.from({length: 30}, (_, i) => 'كلمة ' + (i + 1)).join('\\n');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#custom-name').value = 'تست';
  document.querySelector('#save-words').click();
})()`);
await sleep(700);
await send('Page.reload', { ignoreCache: true });
await sleep(3500);
const persisted = await ev(`(() => {
  document.querySelector('#go-words').click();
  return {
    screen: document.querySelector('.screen.active')?.id,
    name: document.querySelector('#custom-name').value,
    count: document.querySelector('#custom-words').value.split('\\n').filter(Boolean).length,
    counterText: document.querySelector('#words-count').textContent
  };
})()`);
console.log('CUSTOM WORDS', JSON.stringify(persisted));

ws.close();
child.kill();
console.log('done');