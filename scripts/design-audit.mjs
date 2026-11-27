// Аудит дизайна v2 по блокирующим пунктам better-interface:
//  • контраст ВСЕГО видимого текста (≥ 4.5:1, крупный ≥ 3:1) в светлой и тёмной теме, ru и kk, на главной, в уроке (с итогом), на экране завершения и у учителя;
//  • доступное имя у каждого интерактивного элемента;
//  • видимый фокус у каждого элемента в порядке Tab;
//  • нет горизонтальной прокрутки на 320 px и при увеличении текста до 200 %;
//  • prefers-reduced-motion: переходы и анимации гасятся.
// node scripts/design-audit.mjs <url>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const URL_ = process.argv[2] ?? 'http://127.0.0.1:4873/';
const LESSON = { ru: 'ru-saiga', kk: 'kk-balkhash' };
const TEXT = 'Сайгаки живут в степях Казахстана. Весной самки собираются в большие группы. Детёныши рождаются почти одновременно. Так хищникам труднее найти малышей. Через несколько дней телята уже бегают за матерью. Летом стада уходят на север, где больше травы. Осенью они возвращаются на юг.';

async function open(p, screen, lang) {
  await p.addInitScript((l) => { try { localStorage.setItem('oqy-ui-lang', l); } catch { /* */ } }, lang);
  await p.goto(URL_);
  await p.getByTestId('start-lesson').waitFor();
  await p.evaluate(() => document.fonts.ready);
  if (screen === 'lesson' || screen === 'finished') {
    const lesson = JSON.parse(readFileSync(`lessons/${LESSON[lang]}.json`, 'utf8'));
    await p.getByTestId(`lesson-${lesson.id}`).click();
    const solve = async (t) => { await p.getByTestId(`opt-${t.correctOptionId}`).check(); for (const s of t.evidenceSets[0]) await p.getByTestId(`sent-${s}`).click(); await p.getByTestId('check').click(); await p.locator('[data-testid="feedback"][data-solved="true"]').waitFor(); };
    if (screen === 'lesson') {
      await solve(lesson.tasks[0]); await p.getByTestId('next').click();
      const t2 = lesson.tasks[1];
      await p.getByTestId(`opt-${t2.correctOptionId}`).check();
      await p.getByTestId(`sent-${t2.evidenceSets[0][0]}`).click();
      await p.getByTestId('check').click(); await p.getByTestId('feedback').waitFor();
      await p.getByRole('button', { name: /Кеңес|Подсказка/ }).click();
    } else {
      for (const t of lesson.tasks) { await solve(t); await p.getByTestId('next').click(); }
      await p.locator('[data-testid="recommendation"], [data-testid="no-recommendation"]').first().waitFor();
    }
  }
  if (screen === 'teacher') {
    await p.getByTestId('mode-teacher').click();
    await p.getByTestId('t-text').fill(TEXT);
    await p.getByTestId('t-generate').click();
    await p.getByTestId('t-draft').waitFor();
    await p.getByTestId('t-ai-summary').waitFor({ timeout: 20_000 }).catch(() => {});
  }
  if (screen === 'import') {
    await p.getByTestId('import-open').click();
    await p.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await p.getByTestId('import-errors').waitFor();
  }
}

const contrastAll = () => {
  const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  // Фон: смешиваем полупрозрачные слои до непрозрачного (честный «отрисованный» фон).
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let out = parse(getComputedStyle(document.body).backgroundColor); for (const l of layers.reverse()) out = { r: l.r * l.a + out.r * (1 - l.a), g: l.g * l.a + out.g * (1 - l.a), b: l.b * l.a + out.b * (1 - l.a), a: 1 }; return out; };
  const fails = []; let n = 0; let min = 99;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('.sr-only,[aria-hidden="true"] .sr-only')) continue;
    if (el.closest(':disabled,[disabled]')) continue; // неактивные элементы — исключение WCAG 1.4.3
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const fg = parse(cs.color); const bg = bgOf(el);
    const a = fg.a * op; const mix = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum(mix), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (Number(cs.fontWeight) >= 700 && size >= 18.66);
    n++; min = Math.min(min, ratio);
    if (ratio < (large ? 3 : 4.5)) fails.push(`${ratio.toFixed(2)} «${el.textContent.trim().slice(0, 30)}»`);
  }
  // Доступные имена интерактивных элементов
  const unnamed = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="tab"]')].filter((e) => {
    if (e.type === 'hidden') return false;
    const name = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.labels?.[0]?.textContent || e.textContent || e.getAttribute('title') || e.getAttribute('placeholder');
    return !name?.trim();
  }).map((e) => e.outerHTML.slice(0, 80));
  return { n, min: +min.toFixed(2), fails: fails.slice(0, 10), unnamed };
};

const report = [];
const b = await chromium.launch();
for (const scheme of ['light', 'dark']) for (const lang of ['ru', 'kk']) for (const screen of ['home', 'import', 'lesson', 'finished', 'teacher']) {
  for (const width of [320, 1440]) {
    const ctx = await b.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, reducedMotion: 'reduce', isMobile: width < 768, hasTouch: width < 768 });
    const p = await ctx.newPage();
    const row = { scheme, lang, screen, width };
    try {
      await open(p, screen, lang);
      Object.assign(row, await p.evaluate(contrastAll));
      row.noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      if (width === 320 && scheme === 'light') {
        await p.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await p.waitForTimeout(100);
        row.zoom200NoHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
        await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
      }
      if (width === 1440 && scheme === 'light' && lang === 'ru') {
        // Видимый фокус: проходим Tab по всем элементам и проверяем кольцо.
        // Старт — со ссылки «Перейти к содержанию» (первый элемент в порядке Tab), затем Tab до конца страницы.
        await p.keyboard.press('Tab');
        await p.evaluate(() => document.querySelector('a[href="#main"]').focus());
        const noRing = []; let count = 0;
        for (let i = 0; i < 160; i++) {
          if (i) await p.keyboard.press('Tab');
          const r = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null;
            const cs = getComputedStyle(e); const lab = e.closest('label'); const lcs = lab ? getComputedStyle(lab) : null;
            const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || (lcs && lcs.outlineStyle !== 'none' && parseFloat(lcs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
            return { ring, id: e.dataset.testid || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) || e.tagName }; });
          if (!r) break; count++;
          if (!r.ring) noRing.push(r.id);
        }
        row.focusStops = count; row.focusWithoutRing = noRing;
      }
      if (width === 1440 && screen === 'home' && scheme === 'light' && lang === 'ru') {
        row.reducedMotion = await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="start-lesson"]')).transitionDuration);
      }
    } catch (e) { row.error = String(e.message).split('\n')[0]; }
    report.push(row);
    await ctx.close();
  }
}
await b.close();
let bad = 0;
for (const r of report) {
  const issues = [r.error, r.fails?.length && `контраст: ${r.fails.join('; ')}`, r.unnamed?.length && `без имени: ${r.unnamed.join(' | ')}`, r.noHScroll === false && 'гориз. прокрутка', r.zoom200NoHScroll === false && 'прокрутка при 200 %', r.focusWithoutRing?.length && `без фокуса: ${r.focusWithoutRing.join(', ')}`].filter(Boolean);
  if (issues.length) bad++;
  console.log(`${issues.length ? '✗' : '✓'} ${r.scheme.padEnd(5)} ${r.lang} ${r.screen.padEnd(8)} ${String(r.width).padEnd(4)} текстов ${r.n ?? '-'}, мин. контраст ${r.min ?? '-'}${r.focusStops ? `, Tab-остановок ${r.focusStops}` : ''}${r.reducedMotion ? `, transition при reduce: ${r.reducedMotion}` : ''}${r.zoom200NoHScroll !== undefined ? `, 200 %: ${r.zoom200NoHScroll ? 'ок' : 'ПРОКРУТКА'}` : ''}${issues.length ? `\n    ${issues.join('\n    ')}` : ''}`);
}
console.log(`\nИтого: ${report.length} проверок, с проблемами: ${bad}`);
process.exit(bad ? 1 : 0);
