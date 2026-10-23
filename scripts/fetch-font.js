const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'fonts');
const css = fs.readFileSync(path.join(dir, 'cairo.css'), 'utf8');
const blocks = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map(m => m[1]);

const out = [];
const seen = new Set();
let pending = 0;

function download(url, file) {
  return new Promise((resolve, reject) => {
    pending++;
    const https = require('https');
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(file, Buffer.concat(chunks));
        resolve();
      });
    }).on('error', reject);
  });
}

(async () => {
  for (const b of blocks) {
    const weight = (b.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const url = (b.match(/url\((https:[^)]+)\)/) || [])[1];
    if (!url) continue;
    const range = (b.match(/unicode-range:\s*([^;]+)/) || [])[1] || '';
    const subset = /0600-06FF/.test(range) ? 'arabic' : 'latin';
    const name = `cairo-${weight}-${subset}`;
    if (seen.has(name + url)) continue;
    seen.add(name + url);
    const file = path.join(dir, name + '.woff2');
    if (!fs.existsSync(file)) {
      await download(url, file);
      console.log('downloaded', name, fs.statSync(file).size);
    }
    out.push(`@font-face{font-family:'Cairo';font-style:normal;font-weight:${weight};font-display:swap;src:url('./${name}.woff2') format('woff2');unicode-range:${range.trim()};}`);
  }
  fs.writeFileSync(path.join(dir, 'cairo-local.css'), out.join('\n'), 'utf8');
  console.log('faces:', out.length);
})().catch(e => { console.error(e); process.exit(1); });
