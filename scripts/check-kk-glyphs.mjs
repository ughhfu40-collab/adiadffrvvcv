// Проверка шрифтов: есть ли каждая казахская буква (строчная и заглавная) в файлах шрифтов, которые попадают в сборку.
// 1) Читает таблицу cmap прямо из .woff2 (zlib brotli из Node, без сторонних пакетов) — точный ответ «глиф есть/нет».
// 2) Если передан url — открывает собранное приложение и снимает образец всех букв обоими шрифтами (для проверки глазами).
// node scripts/check-kk-glyphs.mjs [url] [specimen.png]
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

const LETTERS = [...'әғқңөұүһі', ...'ӘҒҚҢӨҰҮҺІ'];
const FILES = {
  'Golos Text (интерфейс)': ['golos-text/files/golos-text-cyrillic-wght-normal.woff2', 'golos-text/files/golos-text-cyrillic-ext-wght-normal.woff2'],
  'Literata (заголовки, тексты)': ['literata/files/literata-cyrillic-opsz-normal.woff2', 'literata/files/literata-cyrillic-ext-opsz-normal.woff2'],
};
const TAGS = 'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'.match(/.{4}\s?/g).map((s) => s.slice(0, 4).trim());

function cmapOf(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${path}: не WOFF2`);
  const numTables = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  let pos = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[pos++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error('UIntBase128'); };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = buf.toString('latin1', pos, pos + 4); pos += 4; }
    const version = flags >> 6;
    const orig = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(pos, pos + compressed));
  let off = 0;
  for (const t of tables) { if (t.tag === 'cmap') return data.subarray(off, off + t.length); off += t.length; }
  throw new Error(`${path}: нет cmap`);
}

function hasCodepoint(cmap, cp) {
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const sub = cmap.subarray(cmap.readUInt32BE(4 + i * 8 + 4));
    const format = sub.readUInt16BE(0);
    if (format === 4) {
      const segX2 = sub.readUInt16BE(6);
      for (let s = 0; s < segX2; s += 2) {
        const end = sub.readUInt16BE(14 + s), start = sub.readUInt16BE(16 + segX2 + s);
        if (cp >= start && cp <= end) {
          const delta = sub.readInt16BE(16 + 2 * segX2 + s), roOff = 16 + 3 * segX2 + s, ro = sub.readUInt16BE(roOff);
          const gid = ro === 0 ? (cp + delta) & 0xffff : sub.readUInt16BE(roOff + ro + 2 * (cp - start));
          if (gid) return true;
        }
      }
    } else if (format === 12) {
      const groups = sub.readUInt32BE(12);
      for (let g = 0; g < groups; g++) { const o = 16 + g * 12; if (cp >= sub.readUInt32BE(o) && cp <= sub.readUInt32BE(o + 4)) return true; }
    }
  }
  return false;
}

const report = {};
let ok = true;
for (const [family, files] of Object.entries(FILES)) {
  const cmaps = files.map((f) => cmapOf(`node_modules/@fontsource-variable/${f}`));
  const missing = LETTERS.filter((ch) => !cmaps.some((c) => hasCodepoint(c, ch.codePointAt(0))));
  // Контроль метода: грузинской буквы «ა» в этих шрифтах нет — проверка обязана это увидеть.
  const control = cmaps.some((c) => hasCodepoint(c, 'ა'.codePointAt(0)));
  report[family] = missing.length ? `НЕТ: ${missing.join(' ')}` : `есть все ${LETTERS.length}: ${LETTERS.join('')}`;
  if (missing.length || control) ok = false;
  if (control) report[family] += ' (контроль не сработал)';
}
console.log(JSON.stringify(report, null, 2));

const [url, out] = process.argv.slice(2);
if (url) {
  const { chromium } = await import('@playwright/test');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 470 }, deviceScaleFactor: 2 });
  await p.goto(url);
  await p.getByTestId('start-lesson').waitFor();
  const loaded = await p.evaluate(async (letters) => {
    const specs = [['Golos Text Variable', 400], ['Golos Text Variable', 700], ['Literata Variable', 400], ['Literata Variable', 650]];
    for (const [f, w] of specs) await document.fonts.load(`${w} 30px "${f}"`, letters);
    document.body.innerHTML = `<div style="padding:24px;background:#fff;color:#172033">${specs.map(([f, w]) => `<p style="font:${w} 30px '${f}', monospace;margin:8px 0">${letters} Әже қаңтарда үйге оралды <small style="display:block;font:12px monospace;color:#4F586B">${f} ${w}</small></p>`).join('')}</div>`;
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i);
  }, LETTERS.join(''));
  console.log('загружены в браузере:', loaded.join(', '));
  if (out) await p.screenshot({ path: out });
  await b.close();
}
process.exit(ok ? 0 : 1);
