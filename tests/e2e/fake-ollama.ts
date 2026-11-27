// Поддельная Ollama для e2e: отвечает по маркерам в тексте, чтобы воспроизводить ответы модели.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_OLLAMA_PORT ?? 11535);
const jitter = Number(process.env.FAKE_DELAY_MS ?? 0);
/** Счётчики для стресс-теста: сколько раз вызвана модель и сколько запросов оборвал клиент (сервер Oqy). */
const stats = { chat: 0, aborted: 0, completed: 0 };
const task = (id: string, skill: string, evidence: string[][], extra: Record<string, unknown> = {}) => ({
  id, skill, question: `Вопрос ${id}`, options: [{ id: 'a', text: 'Да' }, { id: 'b', text: 'Нет' }], correctOptionId: 'a', evidenceSets: evidence, hint: 'Подсказка', ...extra,
});

/** Вторая проверка ИИ и исправление одного задания (server/review.ts). */
function reviewOrRepair(full: string): unknown | null {
  const textPart = full.slice(full.lastIndexOf('Текст (ID: предложение):'));
  const bad = textPart.includes('МАРКЕР-REVIEW-BAD') || full.includes('МАРКЕР-REVIEW-BAD');
  if (full.startsWith('Ты внимательный ученик')) {
    // Каждый вариант против текста: при МАРКЕР-REVIEW-BAD во втором задании подтверждаются два варианта.
    const tasks = [...full.matchAll(/^Задание (t\d+): /gm)].map((m) => m[1]!);
    return { tasks: tasks.map((id, i) => ({ id, options: ['a', 'b'].map((o) => ({ id: o, verdict: o === 'a' || (bad && i === 1) ? 'supported' : 'contradicted', sentenceIds: [] })) })) };
  }
  if (full.startsWith('Ты ученик')) {
    return { probes: [...full.matchAll(/Проверка (t\d+:s\d+)/g)].map((m) => ({ key: m[1], answer: 'NONE' })) };
  }
  if (full.startsWith('Ты корректор')) return { errors: [] };
  if (full.startsWith('Исправь ОДНО задание')) {
    const current = JSON.parse(full.trim().split('\n').pop()!) as { id: string; skill: string };
    const broken = textPart.includes('МАРКЕР-REPAIR-BAD');
    return { id: current.id, skill: current.skill, question: 'Исправленный вопрос ИИ', options: [{ id: 'a', text: 'Верно' }, { id: 'b', text: 'Неверно' }, { id: 'c', text: 'Тоже неверно' }],
      correctOptionId: 'a', evidenceSets: broken ? [['s99', 's1']] : current.skill === 'find' ? [['s1']] : [['s1', 's2']], hint: 'Исправленная подсказка' };
  }
  return null;
}

/** Математика: задача с формулами для проверки кодом; МАРКЕР-CALC-BAD — верный вариант не совпадает с расчётом. */
function mathDraft(full: string): unknown | null {
  if (!full.includes('математической (функциональной) грамотности')) return null;
  const text = full.slice(full.lastIndexOf('Условие (ID: строка):'));
  const bad = text.includes('МАРКЕР-CALC-BAD');
  const opt = (a: string, b: string, c: string) => [{ id: 'a', text: a }, { id: 'b', text: b }, { id: 'c', text: c }];
  return { tasks: [
    { id: 't1', skill: 'find', question: 'Сколько стоит билет?', options: opt('600 ₸', '500 ₸', '700 ₸'), correctOptionId: 'a', evidenceSets: [['s1']], hint: 'Найди строку про билет.', solution: 'Билет — 600 ₸.', calc: { kind: 'value', expr: '600', unit: '₸' } },
    { id: 't2', skill: 'match', question: 'Сколько стоят билеты на всех?', options: opt(bad ? '9 000 ₸' : '6 000 ₸', '5 400 ₸', '600 ₸'), correctOptionId: 'a', evidenceSets: [['s1', 's2']], hint: 'Нужны цена билета и число учеников.', solution: '10 × 600 ₸ = 6 000 ₸.', calc: { kind: 'value', expr: '10*600', unit: '₸' } },
    { id: 't3', skill: 'infer', question: 'Как дешевле?', options: opt('Автобус — 6 000 ₸', 'Такси — 8 000 ₸', 'Одинаково'), correctOptionId: 'a', evidenceSets: [['s2', 's3']], hint: 'Сравни полную стоимость.', solution: 'Автобус 6 000 ₸ < такси 8 000 ₸.', calc: { kind: 'choose', pick: 'min', values: { a: '6000', b: '2*4000' }, unit: '₸' } },
  ] };
}

function reply(full: string): unknown {
  const special = reviewOrRepair(full) ?? mathDraft(full);
  if (special) return special;
  const prompt = full.slice(full.lastIndexOf('Текст (ID: предложение):'));
  const ids = [...prompt.matchAll(/^(s\d+): /gm)].map((m) => m[1]!);
  const last = ids[ids.length - 1] ?? 's1';
  if (prompt.includes('МАРКЕР-TASKS')) return { tasks: {} };
  if (prompt.includes('МАРКЕР-MISSING')) return { tasks: [{ id: 't1', skill: 'find', options: [{ id: 'a', text: 'Да' }], correctOptionId: 'a' }] };
  if (prompt.includes('МАРКЕР-OPTIONS')) return { tasks: [task('t1', 'find', [['s1']], { options: null })] };
  if (prompt.includes('МАРКЕР-ПОВТОР-ID')) return {
    tasks: [
      task('t1', 'find', [['s1']], { options: [{ id: 'a', text: 'Первый вариант' }, { id: 'a', text: 'Второй вариант' }] }),
      task('t1', 'match', [['s1', 's2']]),
      task('t3', 'infer', [['s2', last]]),
    ],
  };
  if (prompt.includes('МАРКЕР-ID')) return { tasks: [task('t1', 'find', [['s99']]), task('t2', 'match', [['s1', 's2']], { correctOptionId: 'z' }), task('t3', 'infer', [['s2', last]])] };
  if (prompt.includes('МАРКЕР-QUALITY')) return { tasks: [task('t1', 'find', [['s1']]), task('t2', 'match', [['s2']]), task('t3', 'infer', [['s1', 's2']])] };
  if (prompt.includes('МАРКЕР-ДУБЛЬ')) return { tasks: [task('t1', 'find', [['s1']]), task('t2', 'match', [['s1', 's2']]), task('t3', 'match', [['s2', 's3']])] };
  // Корректный черновик: доказательства зависят от числа предложений, чтобы два черновика различались.
  return { tasks: [task('t1', 'find', [[last]]), task('t2', 'match', [['s1', last]]), task('t3', 'infer', [['s1', 's2'], ['s2', last]])] };
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'fake:latest' }] }));
    if (req.url === '/__stats') return res.end(JSON.stringify(stats));
    if (req.url === '/api/chat') {
      stats.chat++;
      const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[0]!.content;
      res.on('close', () => { if (!res.writableFinished) stats.aborted++; });
      const content = prompt.includes('МАРКЕР-BADJSON') ? '{"tasks": [ {"id": "t1", ' : JSON.stringify(reply(prompt));
      const send = () => { if (!res.destroyed) { stats.completed++; res.end(JSON.stringify({ message: { content } })); } };
      // МАРКЕР-SLOW: отвечаем дольше таймаута e2e-сервера (OLLAMA_TIMEOUT_MS=5000).
      const delay = prompt.includes('МАРКЕР-SLOW') ? 9000 : jitter ? Math.round(Math.random() * jitter) : 0;
      return delay ? void setTimeout(send, delay) : send();
    }
    res.statusCode = 404; res.end('{}');
  });
}).listen(port, '127.0.0.1', () => console.log(`fake ollama on ${port}`));
