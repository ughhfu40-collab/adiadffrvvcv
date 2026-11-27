// Цепочка учителя → ученика в браузере. Модель — ТЕСТОВАЯ (fake-ollama), телефон — ЭМУЛЯЦИЯ Playwright.
// node scripts/qa-teacher-chain.mjs <url>
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const URL_ = process.argv[2] ?? 'http://127.0.0.1:4673/';
const OUT = process.env.OUT_DIR ?? '.demo/qa-chain';
mkdirSync(OUT, { recursive: true });
const profiles = { phone: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, laptop: { viewport: { width: 1440, height: 900 } } };
const text = 'Ертең мектепте кітап көрмесі ашылады. Көрмеге оқушылар үйден кітап әкеледі. Ең көп кітап әкелген сыныпқа сыйлық беріледі. Көрме жұма күні жабылады.';
const b = await chromium.launch();
const report = {};
for (const [name, prof] of Object.entries(profiles)) {
  const r = (report[name] = { steps: {} });
  let step = 'учитель: генерация';
  const tctx = await b.newContext({ ...prof });
  await tctx.tracing.start({ screenshots: true, snapshots: true });
  let sctx;
  try {
    const t = await tctx.newPage();
    await t.addInitScript(() => { const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (x) => { if (x instanceof Blob) void x.text().then((s) => (window.__export = s)); return o(x); }; });
    await t.goto(URL_);
    await t.getByTestId('mode-teacher').click();
    r.model = (await t.getByTestId('t-health').innerText()).match(/модель (\S+)/)?.[1];
    await t.getByTestId('t-title').fill('Кітап көрмесі');
    await t.getByTestId('t-lang').selectOption('kk');
    await t.getByTestId('t-text').fill(text);
    await t.getByTestId('t-generate').click();
    await t.getByTestId('t-draft').waitFor({ timeout: 20_000 });
    r.steps.generated = true;
    step = 'учитель: правка';
    await t.getByTestId('t-task-0').getByPlaceholder(/Сұрақ|Вопрос/).fill('Көрме қашан ашылады?');
    await t.getByTestId('t-task-0').locator('input[type=radio]').nth(0).check();
    await t.getByTestId('t-ev-0-s4').click(); // снять s4
    await t.getByTestId('t-ev-0-s1').click(); // отметить s1
    await t.getByTestId('t-ev-1-add').click();
    await t.getByTestId('t-ev-1-s2').click(); await t.getByTestId('t-ev-1-s3').click();
    r.steps.edited = (await t.getByTestId('t-evidence-0').inputValue()) === 's1';
    r.teacherNoHScroll = await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    await t.screenshot({ path: `${OUT}/${name}-teacher-draft.png` });
    step = 'учитель: сохранение';
    await t.getByTestId('t-save').click();
    await t.getByTestId('t-saved').waitFor();
    r.steps.saved = true;
    step = 'учитель: экспорт JSON';
    await t.getByTestId('t-export').click();
    const json = await t.waitForFunction(() => window.__export).then((h) => h.jsonValue());
    const lesson = JSON.parse(json);
    const file = `${OUT}/${name}-exported.json`;
    writeFileSync(file, json);
    r.exported = { id: lesson.id, t1: lesson.tasks[0].question, t1ev: lesson.tasks[0].evidenceSets, t2ev: lesson.tasks[1].evidenceSets };
    r.steps.exported = lesson.tasks[0].question === 'Көрме қашан ашылады?' && JSON.stringify(lesson.tasks[1].evidenceSets).includes('"s2","s3"');
    // Ученик — отдельный чистый профиль
    step = 'ученик: импорт';
    sctx = await b.newContext({ ...prof });
    const s = await sctx.newPage();
    await s.goto(URL_);
    await s.getByTestId('import-open').click();
    await s.getByTestId('import-file').setInputFiles(file);
    await s.getByTestId('import-ok').waitFor();
    r.steps.imported = true;
    step = 'ученик: готовность к офлайну';
    await s.locator('[data-testid="offline-status"][data-ready="true"]').waitFor({ timeout: 60_000 });
    step = 'ученик: офлайн и перезагрузка';
    await sctx.setOffline(true);
    await s.reload();
    await s.getByTestId(`lesson-${lesson.id}`).waitFor();
    r.steps.bypassCacheFails = await s.evaluate(() => fetch(`${location.origin}/__probe?${Date.now()}`, { cache: 'no-store' }).then(() => false, () => true));
    step = 'ученик: решение t1';
    await s.getByTestId(`lesson-${lesson.id}`).click();
    await s.getByTestId(`opt-${lesson.tasks[0].correctOptionId}`).check();
    await s.getByTestId('sent-s1').click();
    await s.getByTestId('check').click();
    await s.locator('[data-testid="feedback"][data-solved="true"]').waitFor();
    r.steps.solvedOffline = true;
    step = 'ученик: повторная перезагрузка';
    await s.reload();
    await s.getByTestId(`lesson-${lesson.id}`).waitFor();
    r.progress = (await s.getByTestId(`lesson-${lesson.id}`).innerText()).match(/\d+ из \d+|\d+ тапсырманың \d+[^\n]*/)?.[0];
    r.steps.progressKept = /1 из 3|1-і/.test(r.progress ?? '');
    await tctx.tracing.stop();
  } catch (e) {
    r.failedStep = step; r.error = String(e.message).split('\n')[0];
    await tctx.tracing.stop({ path: `${OUT}/${name}-trace.zip` }); r.trace = `${OUT}/${name}-trace.zip`;
  }
  await tctx.close(); await sctx?.close();
}
await b.close();
console.log(JSON.stringify(report, null, 2));
process.exit(Object.values(report).every((r) => !r.failedStep && Object.values(r.steps).every(Boolean)) ? 0 : 1);
