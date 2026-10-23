// Dev-only: boot the app in dev mode and smoke-test the powerups modifier.
import { spawn } from 'node:child_process';
import path from 'node:path';

const port = 9444;
const electron = path.resolve('node_modules/electron/dist/electron.exe');
const udd = path.resolve(process.env.TEMP || '.', 'cnm-powerup-test');
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

await sleep(2500);
await click('#go-local');
await sleep(300);
await click('#powerups-toggle');
const toggle = await ev(`document.querySelector('#powerups-toggle').classList.contains('on')`);
await click('#start-local');
await sleep(500);
const badges = await ev(`document.querySelectorAll('#board .pu-badge').length`);
const modChip = await ev(`!document.querySelector('#mod-chip').hidden`);

// spymaster handoff -> clue -> guess handoff
await click('#handoff-ok');
await sleep(250);
await ev(`(() => {
  const input = document.querySelector('#clue-word');
  input.value = 'اختبار';
  document.querySelector('#clue-send').click();
})()`);
await sleep(400);
await click('#handoff-ok');
await sleep(250);

const puCards = await ev(`[...document.querySelectorAll('#board .card')]
  .map((b, i) => ({ i, pu: !!b.querySelector('.pu-badge') }))
  .filter(x => x.pu)`);
const first = puCards[0].i;
const before = await ev(`({
  revealed: document.querySelectorAll('#board .card.rev').length,
  shields: [document.querySelector('#shield-red').hidden, document.querySelector('#shield-blue').hidden]
})`);
await ev(`document.querySelectorAll('#board .card')[${first}].click()`);
await sleep(600);

const after = await ev(`({
  banner: !document.querySelector('#pu-banner').hidden,
  bannerText: document.querySelector('#pu-banner').textContent,
  bannerClass: document.querySelector('#pu-banner').className,
  logTop: document.querySelector('#tab-body .log-row')?.textContent || '',
  logKind: document.querySelector('#tab-body .log-row')?.className || '',
  revealed: document.querySelectorAll('#board .card.rev').length,
  shields: [document.querySelector('#shield-red').hidden, document.querySelector('#shield-blue').hidden],
  left: document.querySelectorAll('#clue-box .pip.on').length,
  handoff: !document.querySelector('#overlay-handoff').hidden
})`);

console.log(JSON.stringify({ toggle, badges, modChip, puCards, first, before, after }, null, 1));
ws.close();
child.kill();
