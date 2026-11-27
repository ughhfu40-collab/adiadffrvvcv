// Поддельная Ollama для e2e: отвечает по маркерам в тексте, чтобы воспроизводить ответы модели.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_OLLAMA_PORT ?? 11535);
const jitter = Number(process.env.FAKE_DELAY_MS ?? 0);
/** Счётчики для стресс-теста: сколько раз вызвана модель и сколько запросов оборвал клиент (сервер Oqy). */
const stats = { chat: 0, aborted: 0, completed: 0 };
const task = (id: string, skill: string, evidence: string[][], extra: Record<string, unknown> = {}) => ({
  id, skill, question: `Вопрос ${id}`, options: [{ id: 'a', text: 'Да' }, { id: 'b', text: 'Нет' }], correctOptionId: 'a', evidenceSets: evidence, hint: 'Подсказка', ...extra,
});

function reply(full: string): unknown {
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
