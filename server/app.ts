import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { LanguageSchema, validateLesson } from '../shared/lesson';
import { generateLesson, ollamaStatus, OllamaUnavailable, OLLAMA_MODEL } from './ollama';

const GenerateBody = z.object({ text: z.string().min(20, 'Текст слишком короткий (нужно от 20 символов)').max(6000), language: LanguageSchema, title: z.string().max(120).default('') });

export function startCommand() {
  return `ollama serve & ollama pull ${OLLAMA_MODEL}`;
}

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({ server: 'ok', ollama: await ollamaStatus(), startCommand: startCommand() }));

  app.post('/api/validate', async (req, reply) => {
    const r = validateLesson(req.body);
    return r.ok ? r : reply.code(422).send(r);
  });

  app.post('/api/generate', async (req, reply) => {
    const body = GenerateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, errors: body.error.issues.map((i) => i.message) });
    try {
      const r = await generateLesson(body.data);
      return r.ok ? r : reply.code(422).send(r);
    } catch (e) {
      if (e instanceof OllamaUnavailable) return reply.code(503).send({ ok: false, reason: e.message, startCommand: startCommand() });
      throw e;
    }
  });
  return app;
}
