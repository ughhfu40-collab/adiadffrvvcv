import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { DEFAULT_GRADE, GradeSchema, hasEnoughReadingText, MAX_SENTENCES, MAX_TEXT_CHARS, MIN_SENTENCES, splitSentences, validateLesson } from '../shared/lesson';
import { GenerationCancelled, GenerationTimeout, generateLesson, ollamaStatus, OllamaUnavailable, OLLAMA_MODEL, TIMEOUT_MS } from './ollama';

const GenerateBody = z.object({
  text: z.string({ error: 'Нужен текст (строка)' }).trim()
    .min(20, { error: 'Текст слишком короткий (нужно от 20 символов)', abort: true })
    .max(MAX_TEXT_CHARS, { error: `Текст слишком длинный (не больше ${MAX_TEXT_CHARS} символов)`, abort: true })
    .refine((t) => hasEnoughReadingText(splitSentences(t)), `Нужно минимум ${MIN_SENTENCES} предложения с буквами`)
    .refine((t) => splitSentences(t).length <= MAX_SENTENCES, `Слишком много предложений (не больше ${MAX_SENTENCES})`),
  language: z.enum(['kk', 'ru'], { error: 'Язык урока: kk или ru' }),
  grade: GradeSchema.default(DEFAULT_GRADE),
  title: z.string({ error: 'Название — строка' }).trim().max(120, 'Название слишком длинное (не больше 120 символов)').default(''),
});

const HTTP_INPUT_ERRORS: Record<number, string> = {
  400: 'Некорректный запрос: нужен JSON с полями text и language',
  413: 'Запрос слишком большой: текст урока — не больше 6000 символов',
  415: 'Неподдерживаемый формат: отправьте JSON (content-type: application/json)',
};

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
        // Сообщения Fastify на английском и техничны — учителю показываем понятный текст.
        return reply.code(status).send({ ok: false, kind: 'input', errors: [HTTP_INPUT_ERRORS[status]!] });
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
    if (!body.success) {
      // Одно сообщение на поле: первое и самое точное (например, «Нужен текст», а не ещё и «слишком короткий»).
      const seen = new Set<string>();
      const errors = body.error.issues.filter((i) => { const k = i.path.join('.'); if (seen.has(k)) return false; seen.add(k); return true; }).map((i) => i.message);
      return reply.code(400).send({ ok: false, kind: 'input', errors });
    }
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
