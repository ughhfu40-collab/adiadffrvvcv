import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { LanguageSchema, validateLesson } from '../shared/lesson';
import { GenerationCancelled, GenerationTimeout, generateLesson, ollamaStatus, OllamaUnavailable, OLLAMA_MODEL, TIMEOUT_MS } from './ollama';

const GenerateBody = z.object({ text: z.string().min(20, 'Текст слишком короткий (нужно от 20 символов)').max(6000), language: LanguageSchema, title: z.string().max(120).default('') });

export function startCommand() {
  return `ollama serve & ollama pull ${OLLAMA_MODEL}`;
}

export async function buildApp(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: true });
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  app.get('/api/health', async () => ({ server: 'ok', ollama: await ollamaStatus(), startCommand: startCommand(), timeoutSec: Math.round(timeoutMs / 1000) }));

  app.post('/api/validate', async (req, reply) => {
    const r = validateLesson(req.body);
    return r.ok ? r : reply.code(422).send(r);
  });

  app.post('/api/generate', async (req, reply) => {
    const body = GenerateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, kind: 'input', errors: body.error.issues.map((i) => i.message) });
    // Клиент закрыл соединение (кнопка «Отменить») — прерываем запрос к Ollama, чтобы не грузить ноутбук зря.
    const cancel = new AbortController();
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) cancel.abort(); });
    try {
      const r = await generateLesson(body.data, opts.fetchImpl ?? fetch, cancel.signal, timeoutMs);
      return r.ok ? r : reply.code(422).send(r);
    } catch (e) {
      if (e instanceof GenerationTimeout) return reply.code(504).send({ ok: false, kind: 'timeout', reason: e.message, timeoutSec: Math.round(timeoutMs / 1000) });
      if (e instanceof GenerationCancelled) return reply.code(499).send({ ok: false, kind: 'cancelled', reason: e.message });
      if (e instanceof OllamaUnavailable) return reply.code(503).send({ ok: false, kind: 'unavailable', reason: e.message, startCommand: startCommand() });
      throw e;
    }
  });
  return app;
}
