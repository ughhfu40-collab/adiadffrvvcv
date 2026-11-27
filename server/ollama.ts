import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { qualityIssues, qualityIssueText, type QualityIssue, TaskSchema, LessonSchema, LessonBaseSchema, formatIssues, splitSentences, type Language, type Lesson } from '../shared/lesson';

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:12b';

export class OllamaUnavailable extends Error {}
export class GenerationTimeout extends Error {}
export class GenerationCancelled extends Error {}
/** Реальные прогоны gemma3:12b на ноутбуке занимали до 234 с — запас по умолчанию 10 минут. */
export const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 600_000);

const DraftSchema = z.object({ tasks: z.array(TaskSchema).min(1) });
const OllamaChatSchema = z.object({ message: z.object({ content: z.string().trim().min(1) }) });

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

const MATCH_EXAMPLE: Record<Language, { sentences: string[]; task: object; bad: string; why: string; badWhy: string; check: string }> = {
  kk: {
    sentences: ['s1: Айгерім дүйсенбіде табиғат туралы кітап алды.', 's2: Сейсенбіде ол ғарыш туралы кітап алды.', 's3: Жұмада кітапханада көрме ашылды.'],
    task: {
      id: 't2', skill: 'match', question: 'Айгерім дүйсенбіде және сейсенбіде қандай тақырыптардағы кітаптарды алды?',
      options: [{ id: 'a', text: 'Дүйсенбіде табиғат, сейсенбіде ғарыш' }, { id: 'b', text: 'Дүйсенбіде табиғат, сейсенбіде спорт' }, { id: 'c', text: 'Дүйсенбіде өнер, сейсенбіде ғарыш' }],
      correctOptionId: 'a', evidenceSets: [['s1', 's2']], hint: 'Әр күнге қатысты сөйлемді табыңыз.',
    },
    why: 's1 бойынша a және b, s2 бойынша a және c нұсқалары сәйкес келеді. Тек екі сөйлемді бірге оқығанда a нұсқасы қалады.',
    bad: '{"question":"Айгерім сейсенбіде қандай кітап алды?","correct":"Ғарыш туралы кітап","evidence":[["s1","s2"]]}',
    badWhy: 'НЕДҰРЫС: жауап толығымен s2-де тұр, s1 артық. Бұл — дерек табу.',
    check: 'Тексеру: evidenceSets-тен кез келген бір сөйлемді алып тастасаң, жауап табылмауы керек.',
  },
  ru: {
    sentences: ['s1: В понедельник Айгерим взяла книгу о природе.', 's2: Во вторник она взяла книгу о космосе.', 's3: В пятницу в библиотеке открылась выставка.'],
    task: {
      id: 't2', skill: 'match', question: 'О чём были книги, которые Айгерим взяла в понедельник и во вторник?',
      options: [{ id: 'a', text: 'В понедельник о природе, во вторник о космосе' }, { id: 'b', text: 'В понедельник о природе, во вторник о спорте' }, { id: 'c', text: 'В понедельник об искусстве, во вторник о космосе' }],
      correctOptionId: 'a', evidenceSets: [['s1', 's2']], hint: 'Найдите предложение про каждый день.',
    },
    why: 'С s1 согласуются варианты a и b, с s2 — a и c. Только вариант a согласуется с обоими предложениями.',
    bad: '{"question":"Какую книгу Айгерим взяла во вторник?","correct":"О космосе","evidence":[["s1","s2"]]}',
    badWhy: 'НЕПРАВИЛЬНО: ответ целиком в s2, s1 лишнее. Это поиск факта.',
    check: 'Проверка: если убрать из evidenceSets любое одно предложение, ответ должен стать невозможным.',
  },
};

export function buildPrompt(language: Language, sentences: { id: string; text: string }[]): string {
  const langName = language === 'kk' ? 'казахском (қазақ тілі)' : 'русском';
  const ex = MATCH_EXAMPLE[language];
  return [
    `Ты методист по читательской грамотности для 8 класса. Составь ровно 3 задания на ${langName} языке по тексту ниже — по одному каждого типа.`,
    'Задание t1: skill="find" — найти факт, прямо названный в ОДНОМ предложении. evidenceSets — одно предложение.',
    'Задание t2: skill="match" — сопоставить детали из ДВУХ РАЗНЫХ предложений. Ответ должен получаться только из их связи: ни одно предложение по отдельности не содержит полного ответа. Вопрос не должен содержать ответ или подсказывать его.',
    `Самопроверка для t2: ${ex.check} Если ответ целиком есть в одном предложении — перепиши вопрос так, чтобы он спрашивал о связи двух фактов (что было тогда / что изменилось / кто и когда).`,
    'Задание t3: skill="infer" — вывод, которого нет в тексте дословно; опирается минимум на ДВА разных предложения. Варианты должны различаться по сути; не начинай все варианты одной и той же фразой.',
    'У каждого задания 3 варианта с id "a","b","c"; ровно один верный, его id в correctOptionId.',
    'Правильный вариант не добавляет фактов, которых нет в тексте. Бери слова из текста без замен: не меняй, кто что сделал (например, «оқытушыдан» нельзя заменять на «оқушыдан», «учитель» на «ученик»). Проверь орфографию чисел и слов.',
    'Неверные варианты должны явно противоречить тексту или не следовать из него.',
    'evidenceSets — массив допустимых наборов ID предложений. Для match и infer в КАЖДОМ наборе минимум два разных ID. Используй ТОЛЬКО ID из текста.',
    'hint — короткая подсказка, где искать, без прямого ответа.',
    '',
    'Пример ПРАВИЛЬНОГО задания match (другой текст, только для образца):',
    ...ex.sentences,
    JSON.stringify(ex.task),
    ex.why,
    'Пример ПЛОХОГО задания match по тому же тексту — так делать нельзя:',
    ex.bad,
    ex.badWhy,
    '',
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
  | { ok: false; kind: 'structure'; errors: string[] }
  /** Структура и ссылки целы, но нарушены правила качества (типы заданий, число доказательств) — черновик для правки. */
  | { ok: false; kind: 'quality'; errors: string[]; issues: QualityIssue[]; draft: Lesson };

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
  if (!full.success) return { ok: false, kind: 'references', errors: formatIssues(full.error), draft: base.data };
  const issues = qualityIssues(full.data);
  return issues.length ? { ok: false, kind: 'quality', issues, errors: issues.map((q) => qualityIssueText('ru', q)), draft: full.data } : { ok: true, lesson: full.data };
}

export async function generateLesson(input: { text: string; language: Language; title: string }, fetchImpl: typeof fetch = fetch, cancel?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<GenerateResult> {
  const sentences = splitSentences(input.text);
  const signal = cancel ? AbortSignal.any([cancel, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let body: unknown;
  try {
    const res = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: DRAFT_JSON_SCHEMA,
        options: { temperature: 0.2 },
        messages: [{ role: 'user', content: buildPrompt(input.language, sentences) }],
      }),
      signal,
    });
    if (!res.ok) throw new OllamaUnavailable(`Ollama вернула ${res.status}: ${await res.text()}`);
    body = await res.json();
  } catch (e) {
    if (e instanceof OllamaUnavailable) throw e;
    if (cancel?.aborted) throw new GenerationCancelled('Генерация отменена');
    if (signal.aborted || (e as Error).name === 'TimeoutError') throw new GenerationTimeout(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с`);
    if (e instanceof SyntaxError) return { ok: false, kind: 'structure', errors: ['Ollama вернула ответ в неверном формате'] };
    throw new OllamaUnavailable(`Ollama недоступна по адресу ${OLLAMA_URL}: ${(e as Error).message}`);
  }
  const chat = OllamaChatSchema.safeParse(body);
  if (!chat.success) return { ok: false, kind: 'structure', errors: ['В ответе Ollama нет текста черновика'] };
  let raw: unknown;
  try {
    raw = JSON.parse(chat.data.message.content);
  } catch {
    return { ok: false, kind: 'structure', errors: ['Модель вернула не JSON'] };
  }
  // Время + случайный суффикс: параллельные запросы в одну миллисекунду получают разные ID.
  const slug = `gen-${input.language}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  return assembleDraft(raw, { id: slug, title: input.title || 'Новый урок', language: input.language }, sentences);
}
