import { z } from 'zod';
import { splitBySubject, type Subject } from '../shared/math';
import { randomUUID } from 'node:crypto';
import { DEFAULT_GRADE, DEFAULT_LESSON_TITLE, qualityIssues, qualityIssueText, type QualityIssue, TaskSchema, LessonSchema, LessonBaseSchema, formatIssues, splitSentences, type Language, type Grade, type Lesson } from '../shared/lesson';

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:12b';

export class OllamaUnavailable extends Error {}
export class GenerationTimeout extends Error {}
export class GenerationCancelled extends Error {}
/** Реальные прогоны gemma3:12b на ноутбуке занимали до 234 с — запас по умолчанию 10 минут. */
export const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 600_000);

const DraftSchema = z.object({ tasks: z.array(TaskSchema).min(1) });
export const MathDraftTaskSchema = TaskSchema.required({ calc: true }).extend({ solution: z.string().trim().min(1) });
const MathDraftSchema = DraftSchema.extend({ tasks: z.array(MathDraftTaskSchema).min(1) });
const OllamaChatSchema = z.object({ message: z.object({ content: z.string().trim().min(1) }) });

/** JSON Schema для structured outputs Ollama (format). */
const CALC_JSON = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['value', 'choose'] },
    expr: { type: 'string' },
    pick: { type: 'string', enum: ['min', 'max'] },
    values: { type: 'object', additionalProperties: { type: 'string' } },
    unit: { type: 'string' },
  },
  required: ['kind', 'unit'],
} as const;

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

/** Схема черновика математики: те же поля плюс объяснение расчёта и формула, которую проверит код. */
export const MATH_DRAFT_JSON_SCHEMA = {
  ...DRAFT_JSON_SCHEMA,
  properties: { tasks: { ...DRAFT_JSON_SCHEMA.properties.tasks, items: {
    ...DRAFT_JSON_SCHEMA.properties.tasks.items,
    properties: { ...DRAFT_JSON_SCHEMA.properties.tasks.items.properties, solution: { type: 'string' }, calc: CALC_JSON },
    required: [...DRAFT_JSON_SCHEMA.properties.tasks.items.required, 'solution', 'calc'],
  } } },
} as const;

const MATH_EXAMPLE: Record<Language, string> = {
  ru: [
    'Пример (другая ситуация, только для образца):',
    's1: В классе 25 учеников.',
    's2: Тетрадь стоит 150 ₸, а пачка из 5 тетрадей — 600 ₸.',
    's3: Класс собрал 4 000 ₸.',
    JSON.stringify({ id: 't2', skill: 'match', question: 'Сколько стоят тетради на весь класс, если покупать пачками?', options: [{ id: 'a', text: '3 000 ₸' }, { id: 'b', text: '3 750 ₸' }, { id: 'c', text: '600 ₸' }], correctOptionId: 'a', evidenceSets: [['s1', 's2']], hint: 'Узнай, сколько пачек нужно на 25 учеников.', solution: '25 : 5 = 5 пачек; 5 × 600 ₸ = 3 000 ₸.', calc: { kind: 'value', expr: '25/5*600', unit: '₸' } }),
  ].join('\n'),
  kk: [
    'Мысал (басқа жағдай, тек үлгі үшін):',
    's1: Сыныпта 25 оқушы бар.',
    's2: Дәптер 150 ₸, ал 5 дәптерден тұратын бума — 600 ₸.',
    's3: Сынып 4 000 ₸ жинады.',
    JSON.stringify({ id: 't2', skill: 'match', question: 'Бумамен алса, бүкіл сыныпқа дәптер қанша тұрады?', options: [{ id: 'a', text: '3 000 ₸' }, { id: 'b', text: '3 750 ₸' }, { id: 'c', text: '600 ₸' }], correctOptionId: 'a', evidenceSets: [['s1', 's2']], hint: '25 оқушыға неше бума керек екенін тап.', solution: '25 : 5 = 5 бума; 5 × 600 ₸ = 3 000 ₸.', calc: { kind: 'value', expr: '25/5*600', unit: '₸' } }),
  ].join('\n'),
};

/** Промпт математики: бытовая задача по условиям учителя, исходные данные — строки s1…sN. */
export function buildMathPrompt(language: Language, lines: { id: string; text: string }[], grade: Grade = DEFAULT_GRADE): string {
  const langName = language === 'kk' ? 'казахском (қазақ тілі)' : 'русском';
  return [
    `Ты методист по математической (функциональной) грамотности для ${grade} класса. Составь ровно 3 задания на ${langName} языке по бытовой ситуации ниже — по одному каждого типа.`,
    'Задание t1: skill="find" — найти одно исходное данное из одной строки (evidenceSets — одна строка).',
    'Задание t2: skill="match" — посчитать результат по данным минимум из ДВУХ разных строк.',
    'Задание t3: skill="infer" — выбрать лучший вариант (дешевле, выгоднее, хватит ли) и обосновать расчётом; минимум ДВЕ строки данных.',
    'У каждого задания 3 варианта ответа с id "a","b","c", ровно один верный. Числа в ответах — с единицами измерения (₸, ГБ, л, кг, шт.).',
    'Неверные варианты — типичные ошибки расчёта (забыли условие скидки, не учли доставку, посчитали не всех), но с ДРУГИМ числом, чем верный.',
    'evidenceSets — ID строк с исходными данными, без которых ответ не получить. Используй ТОЛЬКО ID из условия.',
    'hint — какую величину нужно найти, без готового ответа. solution — короткий расчёт с единицами.',
    'calc — формула для проверки кодом, ТОЛЬКО числа, + - * / и скобки:',
    '  {"kind":"value","expr":"25/5*600","unit":"₸"} — число результата должно быть в тексте верного варианта;',
    '  {"kind":"choose","pick":"min","values":{"a":"…","b":"…"},"unit":"₸"} — для выбора: формула каждого сравниваемого варианта, верный — с минимумом (или максимумом).',
    '',
    MATH_EXAMPLE[language],
    '',
    'Условие (ID: строка):',
    ...lines.map((s) => `${s.id}: ${s.text}`),
  ].join('\n');
}



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

const GRADE_GUIDANCE: Record<Grade, string> = {
  7: 'Пиши короткие вопросы и варианты знакомыми словами. Вывод должен следовать из двух конкретных деталей в понятной ситуации.',
  8: 'Сопоставляй детали из разных частей текста. Для вывода предложи связать причину с наблюдаемым результатом.',
  9: 'Если текст позволяет, предложи сопоставить разные условия, данные или точки зрения. В выводе проверь, где заканчиваются данные текста и начинается необоснованное обобщение.',
};

export function buildPrompt(language: Language, sentences: { id: string; text: string }[], grade: Grade = DEFAULT_GRADE): string {
  const langName = language === 'kk' ? 'казахском (қазақ тілі)' : 'русском';
  const ex = MATCH_EXAMPLE[language];
  return [
    `Ты методист по читательской грамотности для ${grade} класса. Составь ровно 3 задания на ${langName} языке по тексту ниже — по одному каждого типа.`,
    GRADE_GUIDANCE[grade],
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
export function assembleDraft(raw: unknown, meta: { id: string; title: string; language: Language; grade?: Grade; subject?: Subject }, sentences: { id: string; text: string }[]): GenerateResult {
  const parsed = (meta.subject === 'math' ? MathDraftSchema : DraftSchema).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, kind: 'structure', errors: ['Модель вернула черновик неверной структуры', ...formatIssues(parsed.error)] };
  }
  const { subject, ...rest } = meta;
  // Поле subject пишется только для математики: старые читательские уроки остаются как были.
  const candidate = { ...rest, ...(subject === 'math' ? { subject } : {}), grade: meta.grade ?? DEFAULT_GRADE, sentences, tasks: parsed.data.tasks };
  const base = LessonBaseSchema.safeParse(candidate);
  if (!base.success) return { ok: false, kind: 'structure', errors: ['Черновик не соответствует схеме урока', ...formatIssues(base.error)] };
  const full = LessonSchema.safeParse(candidate);
  if (!full.success) return { ok: false, kind: 'references', errors: formatIssues(full.error), draft: base.data };
  const issues = qualityIssues(full.data);
  return issues.length ? { ok: false, kind: 'quality', issues, errors: issues.map((q) => qualityIssueText(meta.language, q)), draft: full.data } : { ok: true, lesson: full.data };
}

export type ModelJson = { ok: true; data: unknown } | { ok: false; kind: 'structure'; errors: string[] };

/** Один вызов модели со структурированным ответом: общий таймаут, отмена и разбор ошибок для генерации, проверки и исправления. */
export async function callModelJson(prompt: string, format: object, fetchImpl: typeof fetch = fetch, cancel?: AbortSignal, timeoutMs = TIMEOUT_MS, temperature = 0.2): Promise<ModelJson> {
  const signal = cancel ? AbortSignal.any([cancel, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let body: unknown;
  try {
    const res = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, format, options: { temperature }, messages: [{ role: 'user', content: prompt }] }),
      signal,
    });
    if (!res.ok) throw new OllamaUnavailable(`Ollama вернула ${res.status}: ${await res.text()}`);
    body = await res.json();
  } catch (e) {
    if (e instanceof OllamaUnavailable) throw e;
    if (cancel?.aborted) throw new GenerationCancelled('Запрос к модели отменён');
    if (signal.aborted || (e as Error).name === 'TimeoutError') throw new GenerationTimeout(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с`);
    if (e instanceof SyntaxError) return { ok: false, kind: 'structure', errors: ['Ollama вернула ответ в неверном формате'] };
    throw new OllamaUnavailable(`Ollama недоступна по адресу ${OLLAMA_URL}: ${(e as Error).message}`);
  }
  const chat = OllamaChatSchema.safeParse(body);
  if (!chat.success) return { ok: false, kind: 'structure', errors: ['В ответе Ollama нет текста'] };
  try {
    return { ok: true, data: JSON.parse(chat.data.message.content) };
  } catch {
    return { ok: false, kind: 'structure', errors: ['Модель вернула не JSON'] };
  }
}

export async function generateLesson(input: { text: string; language: Language; title: string; grade?: Grade; subject?: Subject }, fetchImpl: typeof fetch = fetch, cancel?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<GenerateResult> {
  const subject = input.subject ?? 'reading';
  const sentences = splitBySubject(subject, input.text, splitSentences);
  const grade = input.grade ?? DEFAULT_GRADE;
  const prompt = subject === 'math' ? buildMathPrompt(input.language, sentences, grade) : buildPrompt(input.language, sentences, grade);
  const r = await callModelJson(prompt, subject === 'math' ? MATH_DRAFT_JSON_SCHEMA : DRAFT_JSON_SCHEMA, fetchImpl, cancel, timeoutMs);
  if (!r.ok) return r;
  // Время + случайный суффикс: параллельные запросы в одну миллисекунду получают разные ID.
  const slug = `gen-${subject === 'math' ? 'math-' : ''}${input.language}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  return assembleDraft(r.data, { id: slug, title: input.title.trim() || DEFAULT_LESSON_TITLE[input.language], language: input.language, grade, subject }, sentences);
}
