// Запись питч-сценария: реальная генерация (Ollama) → правка учителем → сохранение → экспорт JSON
// → импорт в публичное демо ученика → решение задания. Кадры снимаются через CDP-screencast,
// ожидание генерации ускоряется (с пометкой на экране), видео кодируется ffmpeg из Playwright.
// Запуск: npm run server; npm run build && npm run preview; node scripts/record-pitch.mjs
import { chromium, expect } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const LOCAL = process.env.LOCAL_URL ?? 'http://127.0.0.1:4173/';
const DEMO = process.env.DEMO_URL ?? 'https://ughhfu40-collab.github.io/adiadffrvvcv/';
const OUT = process.env.OUT_DIR ?? '.demo';
const FPS = 12;
const W = 1280, H = 720;
mkdirSync(OUT, { recursive: true });
const TEXT = JSON.parse(readFileSync(process.env.TEXTS ?? 'docs/pitch/source-texts.json', 'utf8')).kk;

const frames = []; // { t, buf, speed }
let speed = 1;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true });
await ctx.addInitScript(() => {
  window.__cap = (text) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div'); el.id = '__cap';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;max-width:90%;padding:12px 20px;border-radius:12px;background:rgba(15,23,42,.88);color:#fff;font:600 20px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.3)';
      document.documentElement.appendChild(el);
    }
    el.textContent = text; el.style.display = text ? 'block' : 'none';
  };
});

async function record(page) {
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: Date.now(), buf: Buffer.from(f.data, 'base64'), speed });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: W, maxHeight: H });
  return cdp;
}
function saveSegment(name) {
  if (STUDENT_ONLY && name === 'teacher') return;
  const dir = join(OUT, `seg-${name}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const seg = frames.splice(0);
  seg.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), f.buf));
  writeFileSync(join(dir, 'index.json'), JSON.stringify(seg.map((f, i) => ({ t: f.t, speed: f.speed, file: `${String(i).padStart(5, '0')}.jpg` }))));
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const cap = async (page, text, ms = 2200) => { await page.evaluate((t) => window.__cap(t), text); await pause(ms); };
async function slowFill(loc, text) { await loc.click(); await loc.fill(''); await loc.pressSequentially(text, { delay: 8 }); }
async function fillEvidence(page, index, value) {
  const field = page.getByTestId(`t-evidence-${index}`);
  const summary = page.getByTestId(`t-ev-${index}`).locator('summary');
  if (!(await field.isVisible()) && (await summary.count())) await summary.click();
  await slowFill(field, value);
}

// ---------- Учитель (локально) ----------
const STUDENT_ONLY = process.env.STUDENT_ONLY === '1';
const TEACHER_ONLY = process.env.TEACHER_ONLY === '1';
let genSecs = 0, reviewSecs = 0;
const file = join(OUT, 'pitch-lesson-kk.json');
if (!STUDENT_ONLY) {
const t = await ctx.newPage();
await t.goto(LOCAL);
const cdpT = await record(t);
await t.getByTestId('mode-teacher').click();
await cap(t, 'Учитель вставляет свой текст на казахском — 8 класс', 1500);
await t.getByPlaceholder('Название урока').fill(TEXT.title);
await t.getByTestId('t-lang').selectOption('kk');
await t.getByTestId('t-text').fill(TEXT.text);
await t.getByTestId('t-preview').scrollIntoViewIfNeeded();
await cap(t, 'Предложения пронумерованы до запроса: s1…s7 — это ID для доказательств', 3000);
await t.getByTestId('t-health').scrollIntoViewIfNeeded();
await cap(t, 'Локальная модель gemma3:12b в Ollama — без интернета', 2200);
const g0 = Date.now();
await t.getByTestId('t-generate').click();
await cap(t, 'Генерация идёт на ноутбуке…', 1500);
speed = 40;
const timer = setInterval(() => {
  const sec = Math.round((Date.now() - g0) / 1000);
  t.evaluate((x) => window.__cap(x), `⏩ Ускорено ×40 · реальное время генерации: ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`).catch(() => {});
}, 1000);
await t.getByTestId('t-generate').filter({ hasText: 'Сгенерировать' }).waitFor({ timeout: 900_000 });
clearInterval(timer);
genSecs = Math.round((Date.now() - g0) / 1000);
speed = 1;
if (await t.getByTestId('t-struct-error').count()) throw new Error('Модель вернула неверную структуру — перезапустите запись');
const draft = await t.evaluate(async () => {
  const r = indexedDB.open('oqy-reader'); await new Promise((ok) => (r.onsuccess = ok));
  const q = r.result.transaction('drafts').objectStore('drafts').get('current');
  await new Promise((ok) => (q.onsuccess = ok)); return q.result?.data;
});
writeFileSync(join(OUT, 'pitch-model-draft.json'), JSON.stringify({ genSecs, draft }, null, 2));
await t.getByTestId('t-draft').scrollIntoViewIfNeeded();
await cap(t, `Черновик готов: ${Math.floor(genSecs / 60)} мин ${genSecs % 60} с реального времени. Формат и ID проверены сервером автоматически`, 3200);

// Показываем исходный t2 модели как есть, ждём решения проверяющего (файл verdict.json).
const fs2 = t.getByTestId('t-task-1');
await fs2.scrollIntoViewIfNeeded();
await fs2.evaluate(f => { f.style.outline = '4px solid #f59e0b'; f.style.outlineOffset = '4px'; });
await cap(t, 'Задание t2 — ровно так, как его сгенерировала модель. Учитель сверяет его с текстом', 3500);
const verdictFile = join(OUT, 'verdict.json');
rmSync(verdictFile, { force: true });
speed = 40;
const v0 = Date.now();
await t.evaluate((x) => window.__cap(x), '⏩ Ускорено: учитель сверяет вопрос, ответ и цитаты с текстом');
let verdict;
while (!verdict) { try { verdict = JSON.parse(readFileSync(verdictFile, 'utf8')); } catch { await pause(1000); } }
reviewSecs = Math.round((Date.now() - v0) / 1000);
speed = 1;
await cap(t, verdict.t2.problem, 4500);
if (verdict.t2.edits) {
  const e = verdict.t2.edits;
  if (e.question) await slowFill(fs2.getByPlaceholder('Вопрос'), e.question);
  const options = fs2.getByRole('textbox', { name: /^Вариант / });
  for (let k = 0; k < (e.options ?? []).length; k++) await slowFill(options.nth(k), e.options[k]);
  if (e.correctIndex !== undefined) await fs2.getByRole('radio').nth(e.correctIndex).check();
  if (e.evidence) await fillEvidence(t, 1, e.evidence);
  if (e.hint) await slowFill(fs2.getByPlaceholder('Подсказка'), e.hint);
  await cap(t, verdict.t2.after ?? 't2 исправлено учителем', 3000);
}
await fs2.evaluate(f => { f.style.outline = ''; });
for (const [idx, key] of [[0, 't1'], [2, 't3']]) {
  const v = verdict[key]; if (!v?.edits) continue;
  const fs = t.getByTestId(`t-task-${idx}`);
  await fs.scrollIntoViewIfNeeded();
  await cap(t, v.problem, 3000);
  if (v.edits.evidence) await fillEvidence(t, idx, v.edits.evidence);
  if (v.edits.hint) await slowFill(fs.getByPlaceholder('Подсказка'), v.edits.hint);
  if (v.edits.question) await slowFill(fs.getByPlaceholder('Вопрос'), v.edits.question);
}
await t.getByRole('button', { name: 'Сохранить урок' }).scrollIntoViewIfNeeded();
await cap(t, 'Валидация пройдена → сохраняем и экспортируем JSON', 1500);
await t.getByRole('button', { name: 'Сохранить урок' }).click();
await t.getByTestId('t-saved').waitFor();
const dl = t.waitForEvent('download');
await t.getByTestId('t-export').click();
await (await dl).saveAs(file);
await pause(1200);
await cdpT.send('Page.stopScreencast');
await t.close();
}

saveSegment('teacher');
if (TEACHER_ONLY) { await b.close(); console.log(JSON.stringify({ genSecs, reviewSecs, segment: 'teacher', frames: frames.length })); process.exit(0); }
// ---------- Ученик (публичное демо) ----------
const lesson = JSON.parse(readFileSync(file, 'utf8'));
const [t1, t2] = lesson.tasks;
await ctx.tracing.start({ screenshots: true, snapshots: true });
let step = 'открытие демо';
const s = await ctx.newPage();
const checks = {};
try {
  await s.goto(DEMO);
  const cdpS0 = await record(s);
  step = 'ожидание «Готово к офлайну»';
  await s.getByTestId('offline-status').and(s.locator('[data-ready="true"]')).waitFor({ timeout: 60_000 });
  await cap(s, 'Публичное демо ученика на GitHub Pages: «Готово к офлайну»', 2500);
  step = 'импорт JSON (онлайн)';
  const openImport = s.getByTestId('import-open');
  if (await openImport.count()) await openImport.click();
  await cap(s, 'Импортируем JSON, который экспортировал учитель, — та же схема проверки', 1800);
  await s.getByTestId('import-file').setInputFiles(file);
  await s.getByTestId('import-ok').waitFor();
  checks.imported = true;
  await pause(1500);
  step = 'отключение сети и перезагрузка';
  await ctx.setOffline(true);
  await s.reload();
  const lessonCard = s.getByTestId(`lesson-${lesson.id}`);
  await lessonCard.waitFor();
  // Доказательство отключения: запрос мимо кеша должен упасть.
  checks.networkBlocked = await s.evaluate(() => fetch(`${location.origin}/__probe?${Date.now()}`, { cache: 'no-store' }).then(() => false, () => true));
  if (!checks.networkBlocked) throw new Error('сеть не отключилась');
  checks.importedLessonAfterOfflineReload = true;
  await cap(s, 'Сеть отключена в Playwright, страница перезагружена — импортированный урок на месте', 3000);
  step = 'задание t1';
  await s.getByTestId(`lesson-${lesson.id}`).scrollIntoViewIfNeeded();
  await pause(600);
  await s.getByTestId(`lesson-${lesson.id}`).click();
  await cap(s, 'Задание 1: выбрать ответ и отметить предложение-доказательство', 1500);
  await s.getByTestId(`opt-${t1.correctOptionId}`).check();
  for (const id of t1.evidenceSets[0]) { await s.getByTestId(`sent-${id}`).click(); await pause(400); }
  await s.getByTestId('check').click();
  await s.getByTestId('feedback').and(s.locator('[data-solved="true"]')).waitFor();
  await pause(1500);
  await s.getByTestId('next').click();
  step = 'задание t2 (исправленное учителем)';
  await cap(s, 'Задание 2 — исправленное учителем: верный ответ и только s3…', 1500);
  await s.getByTestId(`opt-${t2.correctOptionId}`).check();
  await s.getByTestId('sent-s3').click(); await pause(500);
  await s.getByTestId('check').click();
  await s.getByTestId('feedback').and(s.locator('[data-evidence="missing"]')).waitFor();
  checks.t2PartialEvidence = 'missing';
  await cap(s, 'Ответ верный, но одной цитаты мало — система просит уточнить', 3000);
  await s.getByTestId('sent-s4').click(); await pause(500);
  await s.getByTestId('check').click();
  await s.getByTestId('feedback').and(s.locator('[data-solved="true"]')).waitFor();
  checks.t2SolvedWithS3S4 = true;
  await cap(s, 'Ответ + s3 и s4 = засчитано, без сети', 2500);
  step = 'повторная перезагрузка и прогресс';
  await s.getByText('← Сабақтарға').click();
  await s.reload();
  await s.getByTestId(`lesson-${lesson.id}`).waitFor();
  checks.stillOffline = await s.evaluate(() => fetch(`${location.origin}/__probe?${Date.now()}`, { cache: 'no-store' }).then(() => false, () => true));
  await expect(lessonCard).toContainText('Выполнено 2 из 3');
  checks.lessonProgressAfterReload = 'Выполнено 2 из 3';
  checks.matchSkillAfterReload = (await s.getByTestId('progress-match').innerText()).replace(/\n/g, ' ');
  await s.getByTestId('progress').scrollIntoViewIfNeeded();
  await cap(s, 'Ещё одна перезагрузка без сети — прогресс сохранён: 2 из 3', 3000);
  await cap(s, 'Oqy: читать и понимать — офлайн, на казахском и русском', 2500);
  await ctx.tracing.stop();
  var cdpS = cdpS0;
} catch (e) {
  await ctx.tracing.stop({ path: join(OUT, 'student-trace.zip') });
  console.log(JSON.stringify({ failedStep: step, error: String(e.message ?? e).split('\n')[0], trace: join(OUT, 'student-trace.zip'), checks }));
  process.exit(1);
}
await cdpS.send('Page.stopScreencast');
saveSegment('student');
await b.close();

// ---------- Сборка видео: сегменты учителя и ученика по порядку ----------
const macCache = join(homedir(), 'Library/Caches/ms-playwright');
const bundled = process.platform === 'darwin' && existsSync(macCache)
  ? readdirSync(macCache).find((name) => name.startsWith('ffmpeg') && existsSync(join(macCache, name, 'ffmpeg-mac')))
  : undefined;
const ff = process.env.FFMPEG ?? (bundled ? join(macCache, bundled, 'ffmpeg-mac') : 'ffmpeg');
let vt = 0; const timeline = [];
for (const name of ['teacher', 'student']) {
  const dir = join(OUT, `seg-${name}`);
  let idx; try { idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')); } catch { continue; }
  idx.forEach((f, i) => {
    const dt = i ? Math.min(f.t - idx[i - 1].t, 4000) / idx[i - 1].speed : 0;
    vt += dt; timeline.push({ vt, buf: readFileSync(join(dir, f.file)) });
  });
  vt += 300;
}
const total = vt + 500;
if (!timeline.length) throw new Error('Нет кадров для записи видео.');
const proc = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
  '-vf', `scale=${W}:${H}`, '-c:v', 'libvpx-vp9', '-b:v', '1500k', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', join(OUT, 'pitch.webm')], { stdio: ['pipe', 'inherit', 'inherit'] });
function* timedFrames() {
  let index = 0;
  for (let ms = 0; ms < total; ms += 1000 / FPS) {
    while (index + 1 < timeline.length && timeline[index + 1].vt <= ms) index++;
    yield timeline[index].buf;
  }
}
const [, [encodeStatus]] = await Promise.all([pipeline(Readable.from(timedFrames()), proc.stdin), once(proc, 'close')]);
if (encodeStatus !== 0) throw new Error(`FFmpeg завершился с кодом ${encodeStatus}.`);
console.log(JSON.stringify({ checks, genSecs, reviewSecs, frames: frames.length, videoSeconds: Math.round(total / 1000), out: join(OUT, 'pitch.webm'), lesson: file }));
