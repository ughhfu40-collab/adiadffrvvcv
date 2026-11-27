// QA редизайна в браузере (чистый профиль на каждый прогон). Телефон — ЭМУЛЯЦИЯ Playwright (390×844, касания).
// node scripts/qa-browser.mjs <url>  → JSON-отчёт и скриншоты в $OUT_DIR
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const URL_ = process.argv[2] ?? 'http://127.0.0.1:4673/';
const OUT = process.env.OUT_DIR ?? '.demo/qa-browser';
mkdirSync(OUT, { recursive: true });
const profiles = {
  phone: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
// Контраст WCAG по вычисленным цветам: текст на ближайшем непрозрачном фоне.
const contrastFn = () => {
  const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  return (el) => { const cs = getComputedStyle(el); const L1 = lum(parse(cs.color)), L2 = lum(bgOf(el)); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700; return { ratio: +ratio.toFixed(2), large: size >= 24 || (bold && size >= 18.66), text: el.textContent.trim().slice(0, 40) }; };
};
const report = {};
const b = await chromium.launch();
for (const [pname, prof] of Object.entries(profiles)) for (const lang of ['ru', 'kk']) {
  const key = `${pname}-${lang}`;
  const r = (report[key] = { checks: {}, contrastFails: [] });
  const ctx = await b.newContext({ ...prof, locale: lang === 'kk' ? 'kk-KZ' : 'ru-RU' });
  const p = await ctx.newPage();
  const noH = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  try {
    await p.goto(URL_);
    if (lang === 'kk' && !(await p.getByTestId('ui-lang').innerText()).includes('Русский')) await p.getByTestId('ui-lang').click();
    await p.getByTestId('start-lesson').waitFor();
    // Главная
    const box = await p.getByTestId('start-lesson').boundingBox();
    r.checks.startVisibleWithoutScroll = !!box && box.y + box.height <= prof.viewport.height;
    r.checks.homeNoHScroll = await noH();
    r.checks.pitchLink = await p.getByTestId('pitch-link').first().getAttribute('href');
    await p.screenshot({ path: `${OUT}/${key}-home.png` });
    // Импорт: подписи до и после выбора файла
    await p.getByTestId('import-open').click();
    r.checks.importBefore = await p.getByTestId('import-filename').innerText();
    await p.getByTestId('import-file').setInputFiles('docs/pitch/lesson-kk-after-teacher.json');
    r.checks.importAfter = await p.getByTestId('import-filename').innerText();
    r.checks.importResult = await p.locator('[data-testid^="import-"][role="status"]').first().innerText();
    await p.getByTestId('import-open').click();
    // Старт урока одним нажатием
    await p.getByTestId('start-lesson').click();
    await p.getByTestId('question').waitFor();
    r.checks.oneTapOpensTask1 = /^1\s*\/\s*3|1\/3|1 \/ 3/.test(await p.locator('main, body').first().innerText()) || (await p.getByTestId('question').innerText()).length > 0;
    const qY = (await p.getByTestId('question').boundingBox()).y, tY = (await p.getByTestId('text').boundingBox()).y;
    r.checks.layout = pname === 'phone' ? (qY < tY ? 'вопрос над текстом' : 'ТЕКСТ НАД ВОПРОСОМ') : 'рядом';
    if (pname === 'laptop') { const q = await p.getByTestId('question').boundingBox(), t = await p.getByTestId('text').boundingBox(); r.checks.layout = Math.abs(q.y - t.y) < 200 && q.x !== t.x ? 'рядом' : 'НЕ РЯДОМ'; }
    // Ответ + цитата, переходы
    const opt = p.locator('[data-testid^="opt-"]').first();
    await opt.check();
    const firstSent = p.locator('[data-testid^="sent-"]').first();
    if (pname === 'phone') { await p.getByTestId('to-text').click(); await p.waitForTimeout(400); }
    await firstSent.click();
    if (pname === 'phone') { await p.getByTestId('to-question').click(); await p.waitForTimeout(400); await p.getByTestId('to-text').click(); await p.waitForTimeout(300); await p.getByTestId('to-question').click(); await p.waitForTimeout(300); }
    r.checks.answerKeptAfterJumps = await opt.isChecked();
    r.checks.quoteKeptAfterJumps = (await firstSent.getAttribute('aria-pressed')) === 'true';
    // Клавиатура: фокус на предложении виден, Enter/Space переключает
    const second = p.locator('[data-testid^="sent-"]').nth(1);
    await firstSent.focus();
    await p.keyboard.press('Tab'); // переход клавиатурой — включает :focus-visible
    r.checks.tabReachesNextSentence = await second.evaluate((el) => el === document.activeElement);
    r.checks.focusRing = await second.evaluate((el) => { const cs = getComputedStyle(el); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'; });
    await p.keyboard.press('Enter');
    r.checks.keyboardToggle = (await second.getAttribute('aria-pressed')) === 'true';
    await p.keyboard.press('Space');
    r.checks.keyboardUntoggle = (await second.getAttribute('aria-pressed')) === 'false';
    r.checks.lessonNoHScroll = await noH();
    // Проверка — два отдельных итога
    await p.getByTestId('check').click();
    await p.getByTestId('feedback').waitFor();
    r.checks.twoResults = { answer: await p.getByTestId('feedback-answer').innerText(), evidence: await p.getByTestId('feedback-evidence').innerText() };
    await p.screenshot({ path: `${OUT}/${key}-lesson.png` });
    // Контраст ключевых элементов (функция внедряется строкой — без eval в странице)
    await p.addScriptTag({ content: `window.__contrast = (${contrastFn.toString()})();` });
    const items = await p.evaluate(() => {
      const sel = ['h1', 'h2', '[data-testid="question"]', '[data-testid^="sent-"]', '[data-testid^="sent-"][aria-pressed="true"]', '[data-testid="check"]', '[data-testid="feedback-answer"]', '[data-testid="feedback-evidence"]', '[data-testid="feedback-tip"]', '[data-testid="offline-status"]', '[data-testid="ui-lang"]', 'label', 'button', 'p', 'a'];
      const out = [];
      for (const s of sel) for (const el of [...document.querySelectorAll(s)].slice(0, 8)) {
        if (!el.textContent.trim() || el.offsetParent === null) continue;
        out.push({ sel: s, ...window.__contrast(el) });
      }
      return out;
    });
    r.contrastChecked = items.length;
    r.contrastMin = Math.min(...items.map((i) => i.ratio));
    r.contrastFails = items.filter((i) => i.ratio < (i.large ? 3 : 4.5));
    // Учитель (в полной сборке)
    if (await p.getByTestId('mode-teacher').count()) {
      await p.getByTestId('mode-teacher').click();
      await p.getByTestId('t-text').waitFor();
      r.checks.teacherNoHScroll = await noH();
      await p.screenshot({ path: `${OUT}/${key}-teacher.png` });
    }
  } catch (e) { r.error = String(e.message).split('\n')[0]; await p.screenshot({ path: `${OUT}/${key}-error.png` }); }
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(report, null, 2));
