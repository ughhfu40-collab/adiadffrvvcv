// Поддельная Ollama для e2e: отвечает по маркерам в тексте, чтобы воспроизводить ответы модели.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_OLLAMA_PORT ?? 11535);
const task = (id: string, skill: string, evidence: string[][], extra: Record<string, unknown> = {}) => ({
  id, skill, question: `Вопрос ${id}`, options: [{ id: 'a', text: 'Да' }, { id: 'b', text: 'Нет' }], correctOptionId: 'a', evidenceSets: evidence, hint: 'Подсказка', ...extra,
});

function reply(prompt: string): unknown {
  const ids = [...prompt.matchAll(/^(s\d+): /gm)].map((m) => m[1]!);
  const last = ids[ids.length - 1] ?? 's1';
  if (prompt.includes('МАРКЕР-TASKS')) return { tasks: {} };
  if (prompt.includes('МАРКЕР-OPTIONS')) return { tasks: [task('t1', 'find', [['s1']], { options: null })] };
  if (prompt.includes('МАРКЕР-ID')) return { tasks: [task('t1', 'find', [['s99']]), task('t2', 'infer', [['s1', 's2']], { correctOptionId: 'z' })] };
  // Корректный черновик: доказательства зависят от числа предложений, чтобы два черновика различались.
  return { tasks: [task('t1', 'find', [[last]]), task('t2', 'match', [['s1', last]]), task('t3', 'infer', [['s1', 's2'], ['s2', last]])] };
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'fake:latest' }] }));
    if (req.url === '/api/chat') {
      const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[0]!.content;
      return res.end(JSON.stringify({ message: { content: JSON.stringify(reply(prompt)) } }));
    }
    res.statusCode = 404; res.end('{}');
  });
}).listen(port, '127.0.0.1', () => console.log(`fake ollama on ${port}`));
