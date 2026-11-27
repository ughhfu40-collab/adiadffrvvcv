// Оценка второй проверки ИИ на реальной модели: черновики с известными (найденными вручную) дефектами и чистые уроки.
// node scripts/ai-review-eval.mjs <api> [out-dir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const API = process.argv[2] ?? 'http://127.0.0.1:9387';
const OUT = process.argv[3] ?? 'docs/ai-review-eval';
mkdirSync(OUT, { recursive: true });
const load = (f) => { const j = JSON.parse(readFileSync(f, 'utf8')); return j.draft ?? j; };
// Ручная разметка: какие задания содержат дефекты (по docs/gemma-run*/README.md и аудиту качества).
const cases = [
  { name: 'kk-robot (новый текст)', file: 'docs/gemma-run-final/kk-robot.json', bad: { t1: 'опечатка «Мұсиқа»', t2: 'два верных варианта, нескладный вопрос', t3: 'несуществующее «су аяқтау», цитаты не по делу' } },
  { name: 'kk-bus', file: 'docs/gemma-run-qa/kk-bus.json', bad: { t1: 'опечатка «Отзық»', t2: '«оқушыдан» вместо «оқытушыдан», ответ в одном s4', t3: '«білім» вместо «үлгерім», s5 не нужен' } },
  { name: 'kk-solar', file: 'docs/gemma-run-qa/kk-solar.json', bad: { t2: 'ответ целиком в s6', t3: 'лишнее «үнемі көреді», одинаковое начало вариантов' } },
  { name: 'kk после правки учителя', file: 'docs/pitch/lesson-kk-after-teacher.json', bad: {} },
  { name: 'kk-feeder (встроенный)', file: 'lessons/kk-feeder.json', bad: {} },
  { name: 'ru-bus-library (новый текст)', file: 'docs/gemma-run-final/ru-bus-library.json', bad: { t3: 'слабая опора вывода о чувствах' } },
];
const rows = [];
for (const c of cases) {
  const lesson = load(c.file);
  const t0 = Date.now();
  const res = await fetch(`${API}/api/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lesson }) });
  const body = await res.json();
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!body.ok) { rows.push({ case: c.name, secs, error: body }); console.log(c.name, 'ошибка', JSON.stringify(body).slice(0, 200)); continue; }
  for (const r of body.review) {
    const truth = c.bad[r.taskId] ?? null;
    const verdict = truth && !r.ok ? 'поймано' : truth && r.ok ? 'ПРОПУЩЕНО' : !truth && r.ok ? 'верно: чисто' : 'ЛОЖНАЯ ТРЕВОГА';
    rows.push({ case: c.name, task: r.taskId, truth, flagged: !r.ok, verdict, checks: { answer: r.answerFromText, one: r.onlyOneCorrect, evidence: r.evidenceOk, language: r.languageOk }, problems: r.problems, secs });
    console.log(`${c.name} ${r.taskId}: ${verdict} | ${r.problems.join(' / ').slice(0, 160)}`);
  }
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
const scored = rows.filter((r) => r.verdict);
const caught = scored.filter((r) => r.verdict === 'поймано').length, missed = scored.filter((r) => r.verdict === 'ПРОПУЩЕНО').length;
const clean = scored.filter((r) => r.verdict === 'верно: чисто').length, falseAlarm = scored.filter((r) => r.verdict === 'ЛОЖНАЯ ТРЕВОГА').length;
console.log(JSON.stringify({ defectiveTasks: caught + missed, caught, missed, cleanTasks: clean + falseAlarm, cleanOk: clean, falseAlarm }));
