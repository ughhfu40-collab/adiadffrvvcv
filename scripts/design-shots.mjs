// Скриншоты для сравнения дизайна «до/после»: главная, урок, учитель; ru/kk; светлая/тёмная тема; 320/390/1440 px.
// node scripts/design-shots.mjs <url> <prefix> [outDir] [--all]
//   без --all — только набор для docs/design-v2 (home/lesson/teacher 390 и 1440, kk и тёмная тема для главной и урока);
//   с --all — ещё 320 px, полностраничные снимки и все сочетания (для ручной проверки, в .demo).
// Каждый снимок — в чистом профиле (новый service worker), поэтому он соответствует текущей сборке; ждём «Готово к офлайну».
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:4873/';
const PREFIX = process.argv[3] ?? 'after';
const OUT = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'docs/design-v2';
const ALL = process.argv.includes('--all');
mkdirSync(OUT, { recursive: true });

const LESSON = { ru: 'ru-saiga', kk: 'kk-balkhash' };
const TEACHER_TEXT = 'Сайгаки живут в степях Казахстана. Весной самки собираются в большие группы. Детёныши рождаются почти одновременно. Так хищникам труднее найти малышей. Через несколько дней телята уже бегают за матерью. Летом стада уходят на север, где больше травы. Осенью они возвращаются на юг.';

const widths = { 320: { width: 320, height: 720, mobile: true }, 390: { width: 390, height: 844, mobile: true }, 1440: { width: 1440, height: 900, mobile: false } };

function shotsToTake() {
  const list = [];
  const add = (screen, w, lang, scheme, full = false) => list.push({ screen, w, lang, scheme, full });
  for (const w of [390, 1440]) for (const s of ['home', 'lesson', 'teacher']) add(s, w, 'ru', 'light');
  for (const w of [390, 1440]) for (const s of ['home', 'lesson']) { add(s, w, 'kk', 'light'); add(s, w, 'ru', 'dark'); }
  if (ALL) {
    for (const s of ['home', 'lesson', 'teacher', 'finished']) for (const lang of ['ru', 'kk']) for (const scheme of ['light', 'dark']) add(s, 320, lang, scheme, true);
    for (const s of ['home', 'lesson', 'teacher', 'finished']) for (const w of [390, 1440]) { add(s, w, 'kk', 'dark', true); add(s, w, 'ru', 'light', true); }
  }
  return list;
}

const name = ({ screen, w, lang, scheme, full }) =>
  `${PREFIX}-${[lang === 'kk' ? 'kk' : null, scheme === 'dark' ? 'dark' : null, screen, String(w), full ? 'full' : null].filter(Boolean).join('-')}.png`;

const b = await chromium.launch();
for (const shot of shotsToTake()) {
  const v = widths[shot.w];
  const ctx = await b.newContext({
    viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.mobile ? 2 : 1, isMobile: v.mobile, hasTouch: v.mobile,
    colorScheme: shot.scheme, locale: shot.lang === 'kk' ? 'kk-KZ' : 'ru-RU', serviceWorkers: 'allow', reducedMotion: 'reduce',
  });
  const p = await ctx.newPage();
  try {
    await p.addInitScript((lang) => { try { localStorage.setItem('oqy-ui-lang', lang); } catch { /* ignore */ } }, shot.lang);
    await p.goto(URL_);
    await p.getByTestId('start-lesson').waitFor();
    await p.evaluate(() => document.fonts.ready);
    await p.locator('[data-testid="offline-status"][data-ready="true"]').waitFor({ timeout: 30_000 }).catch(() => {});
    if (shot.screen === 'lesson' || shot.screen === 'finished') {
      const lesson = JSON.parse(readFileSync(`lessons/${LESSON[shot.lang]}.json`, 'utf8'));
      await p.getByTestId(`lesson-${lesson.id}`).click();
      const solve = async (task) => {
        await p.getByTestId(`opt-${task.correctOptionId}`).check();
        for (const sid of task.evidenceSets[0]) await p.getByTestId(`sent-${sid}`).click();
        await p.getByTestId('check').click();
        await p.locator('[data-testid="feedback"][data-solved="true"]').waitFor();
      };
      if (shot.screen === 'lesson') {
        // Второе задание: верный ответ + одно предложение из двух — видны оба итога и подсказка.
        await solve(lesson.tasks[0]);
        await p.getByTestId('next').click();
        const t2 = lesson.tasks[1];
        await p.getByTestId(`opt-${t2.correctOptionId}`).check();
        await p.getByTestId(`sent-${t2.evidenceSets[0][0]}`).click();
        await p.getByTestId('check').click();
        await p.getByTestId('feedback').waitFor();
        await p.evaluate(() => window.scrollTo(0, 0));
      } else {
        for (const task of lesson.tasks) { await solve(task); await p.getByTestId('next').click(); }
        await p.getByTestId('finished').waitFor();
        await p.locator('[data-testid="recommendation"], [data-testid="no-recommendation"]').first().waitFor();
        await p.evaluate(() => window.scrollTo(0, 0));
      }
    }
    if (shot.screen === 'teacher') {
      await p.getByTestId('mode-teacher').click();
      await p.getByTestId('t-text').fill(TEACHER_TEXT);
      await p.getByTestId('t-generate').click();
      await p.getByTestId('t-draft').waitFor();
      await p.getByTestId('t-ai-summary').waitFor({ timeout: 20_000 }).catch(() => {});
      await p.evaluate(() => window.scrollTo(0, 0));
    }
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/${name(shot)}`, fullPage: shot.full || shot.screen === 'teacher' });
    console.log('✓', name(shot));
  } catch (e) {
    console.log('✗', name(shot), String(e.message).split('\n')[0]);
  }
  await ctx.close();
}
await b.close();
