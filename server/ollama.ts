import { z } from 'zod';
import { TaskSchema, LessonSchema, LessonBaseSchema, formatIssues, splitSentences, type Language, type Lesson } from '../shared/lesson';

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';

export class OllamaUnavailable extends Error {}

const DraftSchema = z.object({ tasks: z.array(TaskSchema).min(1) });

/** JSON Schema для structured outputs Ollama (format). */
export const DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          skill: { type: 'string', enum: ['find', 'match', 'infer'] },
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] },
          },
          correctOptionId: { type: 'string' },
          evidenceSets: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          hint: { type: 'string' },
        },
        required: ['id', 'skill', 'question', 'options', 'correctOptionId', 'evidenceSets', 'hint'],
      },
    },
  },
  required: ['tasks'],
} as const;

export function buildPrompt(language: Language, sentences: { id: string; text: string }[]): string {
  const langName = language === 'kk' ? 'казахском (қазақ тілі)' : 'русском';
  return [
    `Ты методист по читательской грамотности для 8 класса. Составь ровно 3 задания на ${langName} языке по тексту ниже.`,
    'Задание 1: skill="find" — найти факт, прямо названный в одном предложении.',
    'Задание 2: skill="match" — сопоставить детали из разных мест текста.',
    'Задание 3: skill="infer" — сделать вывод, который опирается минимум на два предложения.',
    'У каждого задания 3 варианта с id "a","b","c"; ровно один верный, его id в correctOptionId.',
    'evidenceSets — массив допустимых наборов ID предложений (например [["s2","s5"]]). Используй ТОЛЬКО ID из текста.',
    'hint — короткая подсказка, где искать, без прямого ответа. id заданий: "t1","t2","t3".',
    'Текст (ID: предложение):',
    ...sentences.map((s) => `${s.id}: ${s.text}`),
  ].join('\n');
}

export async function ollamaStatus(): Promise<{ ok: boolean; model: string; url: string; models?: string[]; reason?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, model: OLLAMA_MODEL, url: OLLAMA_URL, reason: `Ollama ответила ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);
    const has = models.some((m) => m === OLLAMA_MODEL || m === `${OLLAMA_MODEL}:latest`);
    return has
      ? { ok: true, model: OLLAMA_MODEL, url: OLLAMA_URL, models }
      : { ok: false, model: OLLAMA_MODEL, url: OLLAMA_URL, models, reason: `Модель ${OLLAMA_MODEL} не скачана` };
  } catch (e) {
    return { ok: false, model: OLLAMA_MODEL, url: OLLAMA_URL, reason: `Ollama недоступна по адресу ${OLLAMA_URL}: ${(e as Error).message}` };
  }
}

export type GenerateResult =
  | { ok: true; lesson: Lesson }
  /** Структура цела, но есть ошибки ссылок (ID доказательств / ответа) — черновик можно править. */
  | { ok: false; kind: 'references'; errors: string[]; draft: Lesson }
  /** Структура сломана — черновик не отдаём, клиент сохраняет предыдущий. */
  | { ok: false; kind: 'structure'; errors: string[] };

/** Собирает урок из ответа модели и проверяет общей схемой (ID предложений, ссылки на варианты). */
export function assembleDraft(raw: unknown, meta: { id: string; title: string; language: Language }, sentences: { id: string; text: string }[]): GenerateResult {
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, kind: 'structure', errors: ['Модель вернула черновик неверной структуры', ...formatIssues(parsed.error)] };
  }
  const candidate = { ...meta, grade: 8, sentences, tasks: parsed.data.tasks };
  const base = LessonBaseSchema.safeParse(candidate);
  if (!base.success) return { ok: false, kind: 'structure', errors: ['Черновик не соответствует схеме урока', ...formatIssues(base.error)] };
  const full = LessonSchema.safeParse(candidate);
  return full.success ? { ok: true, lesson: full.data } : { ok: false, kind: 'references', errors: formatIssues(full.error), draft: base.data };
}

export async function generateLesson(input: { text: string; language: Language; title: string }, fetchImpl: typeof fetch = fetch): Promise<GenerateResult> {
  const sentences = splitSentences(input.text);
  let res: Response;
  try {
    res = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: DRAFT_JSON_SCHEMA,
        options: { temperature: 0.2 },
        messages: [{ role: 'user', content: buildPrompt(input.language, sentences) }],
      }),
      signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS ?? 180000)),
    });
  } catch (e) {
    throw new OllamaUnavailable(`Ollama недоступна по адресу ${OLLAMA_URL}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new OllamaUnavailable(`Ollama вернула ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { message?: { content?: string } };
  let raw: unknown;
  try {
    raw = JSON.parse(body.message?.content ?? '');
  } catch {
    return { ok: false, kind: 'structure', errors: ['Модель вернула не JSON'] };
  }
  const slug = `gen-${input.language}-${Date.now().toString(36)}`;
  return assembleDraft(raw, { id: slug, title: input.title || 'Новый урок', language: input.language }, sentences);
}
