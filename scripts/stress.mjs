// Стресс-тест API генерации через настоящий HTTP против тестовой Ollama (tests/e2e/fake-ollama.ts).
// node scripts/stress.mjs <api-url> <fake-ollama-url> [N=100] [C=20]
const API = process.argv[2] ?? 'http://127.0.0.1:9197';
const FAKE = process.argv[3] ?? 'http://127.0.0.1:11935';
const N = Number(process.argv[4] ?? 100), C = Number(process.argv[5] ?? 20);
const ru = 'Мурат посадил яблоню весной. Летом её поливали каждый день. Осенью дерево дало первые яблоки. Соседи попросили у Мурата саженцы.';
const kk = 'Мұрат көктемде алма ағашын отырғызды. Жазда оны күн сайын суарды. Күзде ағаш алғашқы алмаларын берді. Көршілер Мұраттан көшет сұрады.';
const kinds = [
  // [имя, тело запроса (строка или объект), ожидаемый код, вызывает ли модель, ожидаемый kind]
  ['valid-ru', { text: ru, language: 'ru' }, 200, true],
  ['valid-kk', { text: kk, language: 'kk', title: 'Алма' }, 200, true],
  ['input-spaces', { text: ' '.repeat(40), language: 'ru' }, 400, false, 'input'],
  ['input-spaces-dots', { text: '   .   .   .   .   .   .   ', language: 'ru' }, 400, false, 'input'],
  ['input-short', { text: 'Коротко.', language: 'ru' }, 400, false, 'input'],
  ['input-no-text', { language: 'kk' }, 400, false, 'input'],
  ['input-bad-lang', { text: ru, language: 'en' }, 400, false, 'input'],
  ['input-bad-json', '{"text": "abc", ', 400, false],
  ['model-bad-json', { text: `МАРКЕР-BADJSON. ${ru}`, language: 'ru' }, 422, true, 'structure'],
  ['model-missing-fields', { text: `МАРКЕР-MISSING. ${kk}`, language: 'kk' }, 422, true, 'structure'],
  ['model-bad-ids', { text: `МАРКЕР-ID. ${ru}`, language: 'ru' }, 422, true, 'references'],
  ['model-tasks-object', { text: `МАРКЕР-TASKS. ${kk}`, language: 'kk' }, 422, true, 'structure'],
];
// 100 запросов: 40 валидных, 30 ошибок ввода, 30 сломанных ответов модели — перемешаны.
const plan = [];
for (let i = 0; i < N; i++) {
  const r = i % 10;
  const k = (i / 10) | 0;
  plan.push(kinds[r < 4 ? r % 2 : r < 7 ? 2 + ((k * 3 + r - 4) % 6) : 8 + ((k * 3 + r - 7) % 4)]);
}
plan.sort(() => Math.random() - 0.5);
const stats0 = await (await fetch(`${FAKE}/__stats`)).json();
const results = [];
let next = 0;
async function worker() {
  while (next < plan.length) {
    const [name, body, expect, callsModel, expectKind] = plan[next++];
    const t0 = performance.now();
    let status = 0, json = null, err = null;
    try {
      const res = await fetch(`${API}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (e) { err = e.name === 'TimeoutError' ? 'hung>15s' : e.message; }
    results.push({ name, status, expect, callsModel, expectKind, kind: json?.kind, id: json?.lesson?.id ?? json?.draft?.id, ms: performance.now() - t0, err });
  }
}
const T0 = performance.now();
await Promise.all(Array.from({ length: C }, worker));
const wall = performance.now() - T0;
const stats1 = await (await fetch(`${FAKE}/__stats`)).json();
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const q = (p) => ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)];
const unexpected = results.filter((r) => r.status !== r.expect || (r.expectKind && r.kind !== r.expectKind) || r.err);
const ids = results.filter((r) => r.status === 200).map((r) => r.id);
const byName = {};
for (const r of results) { byName[r.name] ??= { n: 0, statuses: {} }; byName[r.name].n++; byName[r.name].statuses[r.status] = (byName[r.name].statuses[r.status] ?? 0) + 1; }
const modelCallsExpected = results.filter((r) => r.callsModel).length;
const report = {
  model: 'fake (тестовая Ollama)', requests: results.length, concurrency: C, wallMs: Math.round(wall),
  latencyMs: { p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(ms.at(-1)) },
  status500: results.filter((r) => r.status >= 500).length, hung: results.filter((r) => r.err === 'hung>15s').length,
  unexpected: unexpected.length, unexpectedSamples: unexpected.slice(0, 5),
  lessonIds: { total: ids.length, unique: new Set(ids).size },
  modelCalls: { observed: stats1.chat - stats0.chat, expected: modelCallsExpected },
  byKind: byName,
};
console.log(JSON.stringify(report, null, 2));
const ok = report.status500 === 0 && report.hung === 0 && report.unexpected === 0 && report.lessonIds.total === report.lessonIds.unique && report.modelCalls.observed === report.modelCalls.expected;
process.exit(ok ? 0 : 1);
