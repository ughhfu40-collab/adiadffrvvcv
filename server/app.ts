import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { reviewLesson, repairTask } from './review';
import { splitBySubject, SubjectSchema } from '../shared/math';
import { DEFAULT_GRADE, GradeSchema, hasEnoughReadingText, LessonSchema, MAX_SENTENCES, MAX_TEXT_CHARS, MIN_SENTENCES, splitSentences, validateLesson } from '../shared/lesson';
import { GenerationCancelled, GenerationTimeout, generateLesson, ollamaStatus, OllamaUnavailable, OLLAMA_MODEL, TIMEOUT_MS } from './ollama';

const GenerateBody = z.object({
  text: z.string({ error: 'Нужен текст (строка)' }).trim()
    .min(20, { error: 'Текст слишком короткий (нужно от 20 символов)', abort: true })
    .max(MAX_TEXT_CHARS, { error: `Текст слишком длинный (не больше ${MAX_TEXT_CHARS} символов)`, abort: true }),
  language: z.enum(['kk', 'ru'], { error: 'Язык урока: kk или ru' }),
  grade: GradeSchema.default(DEFAULT_GRADE),
  /** Раздел: чтение (по умолчанию) или математика — от него зависит разбивка текста и промпт. */
  subject: SubjectSchema.default('reading'),
  title: z.string({ error: 'Название — строка' }).trim().max(120, 'Название слишком длинное (не больше 120 символов)').default(''),
}).superRefine((b, ctx) => {
  // Чтение — предложения, математика — строки данных; минимум 3 с буквами, не больше MAX_SENTENCES.
  const parts = splitBySubject(b.subject, b.text, splitSentences);
  if (!hasEnoughReadingText(parts)) ctx.addIssue({ code: 'custom', path: ['text'], message: b.subject === 'math' ? `Нужно минимум ${MIN_SENTENCES} строки с данными` : `Нужно минимум ${MIN_SENTENCES} предложения с буквами` });
  else if (parts.length > MAX_SENTENCES) ctx.addIssue({ code: 'custom', path: ['text'], message: b.subject === 'math' ? `Слишком много строк (не больше ${MAX_SENTENCES})` : `Слишком много предложений (не больше ${MAX_SENTENCES})` });
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
    return runModel(reply, (signal) => generateLesson(body.data, opts.fetchImpl ?? fetch, signal, timeoutMs));
  });

  const ReviewBody = z.object({ lesson: LessonSchema });
  const RepairBody = z.object({ lesson: LessonSchema, taskId: z.string().min(1), problems: z.array(z.string().max(500)).max(20).default([]) });
  const badInput = (reply: FastifyReply, error: z.ZodError) =>
    reply.code(400).send({ ok: false, kind: 'input', errors: error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`) });

  // Вторая проверка ИИ: модель перечитывает задания по тексту. Замечания — подсказка учителю, не блокировка.
  app.post('/api/review', async (req, reply) => {
    const body = ReviewBody.safeParse(req.body);
    if (!body.success) return badInput(reply, body.error);
    return runModel(reply, (signal) => reviewLesson(body.data.lesson, opts.fetchImpl ?? fetch, signal, timeoutMs));
  });

  // Исправление одного задания по замечаниям; результат проходит ту же автоматическую проверку.
  app.post('/api/repair', async (req, reply) => {
    const body = RepairBody.safeParse(req.body);
    if (!body.success) return badInput(reply, body.error);
    return runModel(reply, (signal) => repairTask(body.data.lesson, body.data.taskId, body.data.problems, opts.fetchImpl ?? fetch, signal, timeoutMs));
  });

  /** Общий запуск модели: отмена при закрытии соединения, таймаут, недоступность — одинаково для генерации, проверки и исправления. */
  async function runModel(reply: FastifyReply, fn: (signal: AbortSignal) => Promise<{ ok: boolean }>) {
    // Клиент закрыл соединение (кнопка «Отменить») — прерываем запрос к Ollama, чтобы не грузить ноутбук зря.
    const cancel = new AbortController();
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) cancel.abort(); });
    try {
      const r = await fn(cancel.signal);
      return r.ok ? r : reply.code(422).send(r);
    } catch (e) {
      if (e instanceof GenerationTimeout) return reply.code(504).send({ ok: false, kind: 'timeout', reason: e.message, timeoutSec: Math.round(timeoutMs / 1000) });
      if (e instanceof GenerationCancelled) return reply.code(499).send({ ok: false, kind: 'cancelled', reason: e.message });
      if (e instanceof OllamaUnavailable) return reply.code(503).send({ ok: false, kind: 'unavailable', reason: e.message, startCommand: startCommand() });
      throw e;
    }
  }
  return app;
}
