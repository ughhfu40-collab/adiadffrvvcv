// «Ученик-агент»: проходит все встроенные уроки, как настоящий ученик — сначала с типичной ошибкой,
// читает обратную связь, исправляет (не выбирая ответ заново), проходит до конца, на середине уходит в офлайн.
// Проверяет, что обратная связь верная и на языке урока, прогресс сохраняется. Телефон — ЭМУЛЯЦИЯ Playwright.
// node scripts/student-agent.mjs <url> [phone|laptop|both]
import { chromium, devices, expect } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
const URL_ = process.argv[2] ?? 'http://127.0.0.1:4673/';
const which = process.argv[3] ?? 'both';
const OUT = process.env.OUT_DIR ?? '.demo/student-agent';
mkdirSync(OUT, { recursive: true });
const lessons = readdirSync('lessons').map((f) => JSON.parse(readFileSync(`lessons/${f}`, 'utf8'))).sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id));
const KK_LETTERS = /[әғқңөұүһі]/i;
const profiles = { phone: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, laptop: { viewport: { width: 1440, height: 900 } } };

/** Типичная ошибка ученика для каждого типа задания и ожидаемый ответ приложения. */
function mistake(task, lesson) {
  const ev = task.evidenceSets[0];
  const wrongOpt = task.options.find((o) => o.id !== task.correctOptionId).id;
  if (task.skill === 'find') return { name: 'неверный ответ, верная цитата', option: wrongOpt, evidence: ev, expect: { answer: false, evidence: 'correct' } };
  if (task.skill === 'match') return { name: 'верный ответ, только одна цитата', option: task.correctOptionId, evidence: [ev[0]], expect: { answer: true, evidence: 'missing' } };
  const allowed = new Set(task.evidenceSets.flat());
  const off = lesson.sentences.find((s) => !allowed.has(s.id)).id;
  return { name: 'верный ответ, неподходящая цитата', option: task.correctOptionId, evidence: [off], expect: { answer: true, evidence: 'wrong' } };
}

const b = await chromium.launch();
const report = {};
for (const [pname, prof] of Object.entries(profiles)) {
  if (which !== 'both' && which !== pname) continue;
  const ctx = await b.newContext(prof);
  const p = await ctx.newPage();
  const tap = (loc) => (prof.hasTouch ? loc.tap() : loc.click());
  const issues = [];
  const log = [];
  const R = (report[pname] = { lessons: [], issues, offlineFrom: null });
  await p.goto(URL_);
  await p.locator('[data-testid="offline-status"][data-ready="true"]').waitFor({ timeout: 60_000 });
  for (const [li, lesson] of lessons.entries()) {
    if (li === Math.floor(lessons.length / 2)) {
      await ctx.setOffline(true); await p.reload(); R.offlineFrom = lesson.id;
      const blocked = await p.evaluate(() => fetch(`${location.origin}/__probe?${Date.now()}`, { cache: 'no-store' }).then(() => false, () => true));
      if (!blocked) issues.push('сеть не отключилась');
    }
    const t0 = Date.now();
    const card = p.getByTestId(`lesson-${lesson.id}`);
    if (!(await card.isVisible())) { await p.getByTestId('grade-all').click().catch(() => {}); }
    await tap(card);
    const L = { id: lesson.id, grade: lesson.grade, lang: lesson.language, tasks: [] };
    for (const task of lesson.tasks) {
      await p.getByTestId('question').waitFor();
      const q = await p.getByTestId('question').innerText();
      if (!q.includes(task.question.slice(0, 15))) issues.push(`${lesson.id}/${task.id}: на экране другой вопрос`);
      if (prof.isMobile) {
        const qy = (await p.getByTestId('question').boundingBox()).y, ty = (await p.getByTestId('text').boundingBox()).y;
        if (qy > ty) issues.push(`${lesson.id}/${task.id}: на телефоне текст выше вопроса`);
      }
      // Попытка 1 — типичная ошибка
      const m = mistake(task, lesson);
      await tap(p.getByTestId(`opt-${m.option}`));
      for (const sid of m.evidence) await tap(p.getByTestId(`sent-${sid}`));
      await tap(p.getByTestId('check'));
      const fb = p.getByTestId('feedback');
      await fb.waitFor();
      const got = { answer: (await fb.getAttribute('data-answer')) === 'true', evidence: await fb.getAttribute('data-evidence') };
      const texts = [await p.getByTestId('feedback-answer').innerText(), await p.getByTestId('feedback-evidence').innerText(), (await p.getByTestId('feedback-tip').count()) ? await p.getByTestId('feedback-tip').innerText() : ''];
      const text = texts.join(' | ');
      if (got.answer !== m.expect.answer || got.evidence !== m.expect.evidence) issues.push(`${lesson.id}/${task.id}: «${m.name}» → ${JSON.stringify(got)}, ожидалось ${JSON.stringify(m.expect)}`);
      if ((lesson.language === 'kk') !== KK_LETTERS.test(text)) issues.push(`${lesson.id}/${task.id}: обратная связь не на языке урока: ${text}`);
      if (task.skill === 'match' && !/втор|Екінші/i.test(text)) issues.push(`${lesson.id}/${task.id}: для сопоставления нет подсказки про вторую деталь: ${text}`);
      // Попытка 2 — исправление
      const answerKept = await p.getByTestId(`opt-${m.option}`).isChecked();
      if (!answerKept) issues.push(`${lesson.id}/${task.id}: выбранный ответ сбросился после проверки`);
      if (m.option !== task.correctOptionId) await tap(p.getByTestId(`opt-${task.correctOptionId}`));
      const target = new Set(task.evidenceSets[0]);
      for (const sid of m.evidence) if (!target.has(sid)) await tap(p.getByTestId(`sent-${sid}`));
      for (const sid of target) if (!m.evidence.includes(sid)) await tap(p.getByTestId(`sent-${sid}`));
      await tap(p.getByTestId('check'));
      const ok = await p.locator('[data-testid="feedback"][data-solved="true"]').waitFor({ timeout: 5000 }).then(() => true, () => false);
      if (!ok) issues.push(`${lesson.id}/${task.id}: верный ответ с верной цитатой не засчитан`);
      L.tasks.push({ id: task.id, skill: task.skill, mistake: m.name, feedback: text, answerKept, solvedAfterFix: ok });
      await tap(p.getByTestId('next'));
    }
    const finished = await p.getByTestId('finished').waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!finished) issues.push(`${lesson.id}: нет экрана завершения`);
    // Рекомендация считается асинхронно, экран завершения на телефоне плавно прокручивается — ждём и то, и другое.
    const recShown = await p.locator('[data-testid="recommendation"], [data-testid="no-recommendation"]').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
    const rec = (await p.getByTestId('recommendation').count()) ? await p.getByTestId('recommendation').innerText() : null;
    const hasPeer = lessons.some((item) => item.id !== lesson.id && item.grade === lesson.grade && item.language === lesson.language);
    if (!recShown || (hasPeer && !rec)) issues.push(`${lesson.id}: после урока с ошибками нет рекомендации`);
    else if (!hasPeer && rec) issues.push(`${lesson.id}: рекомендован урок другого класса или языка`);
    else if (rec && !lessons.some((item) => item.id !== lesson.id && item.grade === lesson.grade && item.language === lesson.language && rec.includes(item.title))) {
      issues.push(`${lesson.id}: рекомендация не соответствует классу и языку`);
    }
    await p.waitForFunction(() => { const e = document.querySelector('[data-testid="finished"]'); const r = e?.getBoundingClientRect(); return !!r && r.top < innerHeight && r.bottom > 0; }, null, { timeout: 3000 }).catch(() => issues.push(`${lesson.id}: экран завершения не в видимой области`));
    L.recommendation = rec; L.seconds = +((Date.now() - t0) / 1000).toFixed(1);
    R.lessons.push(L);
    await p.screenshot({ path: `${OUT}/${pname}-${lesson.id}-finished.png` });
    await tap(p.locator('button', { hasText: /←/ }).first());
  }
  // Финальная перезагрузка без сети — всё пройдено
  await p.reload();
  await p.getByTestId('grade-all').click().catch(() => {});
  for (const lesson of lessons) {
    await expect(p.getByTestId(`lesson-${lesson.id}`)).toContainText(/3 из 3|3 тапсырманың 3/)
      .catch(() => issues.push(`${lesson.id}: после офлайн-перезагрузки прогресс не 3 из 3`));
  }
  R.skills = await p.getByTestId('progress').innerText().then((s) => s.replace(/\s+/g, ' '));
  R.noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await ctx.close();
}
await b.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
for (const [k, r] of Object.entries(report)) {
  console.log(`== ${k}: уроков ${r.lessons.length}, заданий ${r.lessons.reduce((s, l) => s + l.tasks.length, 0)}, офлайн с ${r.offlineFrom}, проблем ${r.issues.length}`);
  for (const i of r.issues) console.log('  ✗', i);
  console.log('  навыки:', r.skills, '| без гориз. прокрутки:', r.noHScroll);
}
process.exit(Object.values(report).every((r) => r.issues.length === 0) ? 0 : 1);
