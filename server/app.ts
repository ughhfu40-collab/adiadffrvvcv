import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { hasEnoughReadingText, LanguageSchema, MIN_SENTENCES, splitSentences, validateLesson } from '../shared/lesson';
import { GenerationCancelled, GenerationTimeout, generateLesson, ollamaStatus, OllamaUnavailable, OLLAMA_MODEL, TIMEOUT_MS } from './ollama';

const GenerateBody = z.object({
  text: z.string().trim()
    .min(20, 'Текст слишком короткий (нужно от 20 символов)')
    .max(6000)
    .refine((t) => hasEnoughReadingText(splitSentences(t)), `Нужно минимум ${MIN_SENTENCES} предложения с буквами`),
  language: LanguageSchema,
  title: z.string().trim().max(120).default(''),
});

export function startCommand() {
  return `ollama serve & ollama pull ${OLLAMA_MODEL}`;
}

export async function buildApp(opts: { timeoutMs?: number; fetchImpl?: typeof fetch; allowedOrigins?: string[] } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const allowedOrigins = opts.allowedOrigins ?? (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  app.addHook('onRequest', async (request, reply) => {
    const { origin, host } = request.headers;
    if (!origin || allowedOrigins.includes(origin)) return;
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) return;
    return reply.code(403).send({ ok: false, kind: 'input', errors: ['Запрос с этого сайта запрещён.'] });
  });
  if (allowedOrigins.length > 0) await app.register(cors, { origin: allowedOrigins });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && 'statusCode' in error) {
      const status = error.statusCode;
      if (status === 400 || status === 413 || status === 415) {
        return reply.code(status).send({ ok: false, kind: 'input', errors: [error.message] });
      }
    }
    return reply.send(error);
  });
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
