// Вторая проверка ИИ: модель перечитывает каждое задание по тексту и называет проблемы; по запросу учителя — исправляет одно задание.
// Решение всегда за учителем: замечания ИИ не блокируют сохранение, исправление проходит ту же автоматическую проверку.
import { z } from 'zod';
import { answerOverlap, LessonSchema, qualityIssues, qualityIssueText, TaskSchema, formatIssues, type Language, type Lesson, type Task } from '../shared/lesson';
import { subjectOf } from '../shared/math';
import { callModelJson, MATH_DRAFT_JSON_SCHEMA, TIMEOUT_MS } from './ollama';

export interface TaskReview {
  taskId: string;
  /** Правильный вариант следует из текста. */
  answerFromText: boolean;
  /** Остальные варианты неверны — правильный ровно один. */
  onlyOneCorrect: boolean;
  /** Цитат достаточно, и (для сопоставления/вывода) нужна каждая. */
  evidenceOk: boolean;
  /** Нет орфографических ошибок, несуществующих и искажённых слов. */
  languageOk: boolean;
  problems: string[];
  ok: boolean;
}

/** Порог дословного совпадения ответа с одним предложением для сигнала «второе предложение не нужно». */
export const ONE_SENTENCE_OVERLAP = 0.75;

const SKILL_NAME = { find: 'найти факт', match: 'сопоставить детали', infer: 'сделать вывод' } as const;
const langName = (l: Language) => (l === 'kk' ? 'казахском (қазақ тілі)' : 'русском');

// Проверка «моделью-учеником»: модель не оценивает задание («хорошее ли оно?» — на это она почти всегда отвечает «да»),
// а решает его сама. Дефекты выводятся механически из её ответов.

const OptionProbe = z.object({ tasks: z.array(z.object({ id: z.string(), options: z.array(z.object({ id: z.string(), verdict: z.enum(['supported', 'contradicted', 'not_in_text']), sentenceIds: z.array(z.string()).default([]) })) })) });
const OPTION_PROBE_SCHEMA = {
  type: 'object', required: ['tasks'],
  properties: { tasks: { type: 'array', items: { type: 'object', required: ['id', 'options'], properties: {
    id: { type: 'string' },
    options: { type: 'array', items: { type: 'object', required: ['id', 'verdict', 'sentenceIds'], properties: {
      id: { type: 'string' }, verdict: { type: 'string', enum: ['supported', 'contradicted', 'not_in_text'] }, sentenceIds: { type: 'array', items: { type: 'string' } } } } },
  } } } },
} as const;

const AblationProbe = z.object({ probes: z.array(z.object({ key: z.string(), answer: z.string() })) });
const ABLATION_SCHEMA = {
  type: 'object', required: ['probes'],
  properties: { probes: { type: 'array', items: { type: 'object', required: ['key', 'answer'], properties: { key: { type: 'string' }, answer: { type: 'string' } } } } },
} as const;

const LanguageProbe = z.object({ errors: z.array(z.object({ taskId: z.string(), fragment: z.string(), fix: z.string().default('') })) });
const LANGUAGE_SCHEMA = {
  type: 'object', required: ['errors'],
  properties: { errors: { type: 'array', items: { type: 'object', required: ['taskId', 'fragment', 'fix'], properties: { taskId: { type: 'string' }, fragment: { type: 'string' }, fix: { type: 'string' } } } } },
} as const;

const textBlock = (lesson: Lesson) => ['Текст (ID: предложение):', ...lesson.sentences.map((s) => `${s.id}: ${s.text}`)];

export function buildOptionProbePrompt(lesson: Lesson): string {
  return [
    `Ты внимательный ученик ${lesson.grade} класса. Язык текста — ${langName(lesson.language)}. Ниже текст и задания; какой вариант задумывался верным, тебе НЕ сообщают.`,
    'Для КАЖДОГО варианта каждого задания определи по тексту:',
    '- supported — утверждение варианта полностью подтверждается текстом (все его части), укажи ID подтверждающих предложений;',
    '- contradicted — текст ему противоречит;',
    '- not_in_text — в тексте об этом не сказано или сказано только частично.',
    'Смотри на точный смысл слов: «оқытушы» (учитель) и «оқушы» (ученик) — разные слова; лишняя деталь, которой нет в тексте, делает вариант not_in_text.',
    '',
    ...textBlock(lesson),
    '',
    ...lesson.tasks.map((t) => [`Задание ${t.id}: ${t.question}`, ...t.options.map((o) => `  ${o.id}) ${o.text}`)].join('\n')),
  ].join('\n');
}

/** Задания для абляции: каждое предложение из первого набора доказательств сопоставления/вывода — по отдельности. */
function ablationProbes(lesson: Lesson) {
  const text = new Map(lesson.sentences.map((s) => [s.id, s.text]));
  return lesson.tasks.filter((t) => t.skill !== 'find' && (t.evidenceSets[0]?.length ?? 0) >= 2)
    .flatMap((t) => t.evidenceSets[0]!.map((sid) => ({ key: `${t.id}:${sid}`, task: t, sid, sentence: text.get(sid) ?? '' })));
}

export function buildAblationPrompt(lesson: Lesson): string {
  return [
    `Ты ученик ${lesson.grade} класса. Язык — ${langName(lesson.language)}.`,
    'Для каждой проверки ниже тебе дано ОДНО предложение и вопрос с вариантами. Отвечай, используя ТОЛЬКО это одно предложение — никаких других знаний и никакого другого текста.',
    'Выбирай вариант, только если это одно предложение САМО отвечает на ВОПРОС: в нём говорится именно о том, о чём спрашивают, и из него следует ВЕСЬ вариант целиком.',
    'Совпадение слов с вариантом — ещё не ответ. Если предложение говорит о другом событии, о другом времени или о другом участнике, чем вопрос, или если для ответа нужна связь с другим предложением, — ответь NONE.',
    'Если сомневаешься — NONE.',
    '',
    ...ablationProbes(lesson).map((p) => [`Проверка ${p.key}`, `Предложение: «${p.sentence}»`, `Вопрос: ${p.task.question}`, ...p.task.options.map((o) => `  ${o.id}) ${o.text}`)].join('\n')),
  ].join('\n\n');
}

export function buildLanguagePrompt(lesson: Lesson): string {
  return [
    `Ты корректор, носитель языка: ${langName(lesson.language)}.`,
    'Проверь вопросы, варианты и подсказки заданий. Найди: несуществующие слова, опечатки (в том числе в числах), неверные формы слов, нескладные или бессмысленные фразы.',
    'Для каждой ошибки верни taskId, точную цитату ошибочного фрагмента (fragment) и исправление (fix). Если ошибок нет — пустой список. Не придумывай ошибок.',
    '',
    ...lesson.tasks.map((t) => [`${t.id}. Вопрос: ${t.question}`, ...t.options.map((o) => `   Вариант ${o.id}: ${o.text}`), `   Подсказка: ${t.hint}`].join('\n')),
  ].join('\n');
}

const MSG = {
  ru: {
    answer: (o: string) => `Верный вариант ${o} не подтверждается текстом полностью — проверьте, нет ли в нём лишних или искажённых слов.`,
    two: (o: string, s: string) => `Вариант ${o} тоже подтверждается текстом${s ? ` (${s})` : ''} — получается два верных ответа.`,
    one: (sid: string) => `Ответ выбирается по одному предложению ${sid} — второе предложение в доказательстве не нужно.`,
    lang: (f: string, fix: string) => `Язык: «${f}»${fix ? ` → «${fix}»` : ''}.`,
    skipped: 'ИИ не проверил это задание',
    partialOptions: 'ИИ не проверил все варианты ответа. Запустите проверку ещё раз.',
    partialEvidence: 'ИИ не проверил все доказательства. Запустите проверку ещё раз.',
  },
  kk: {
    answer: (o: string) => `${o} дұрыс нұсқасы мәтінмен толық расталмайды — артық немесе бұрмаланған сөз жоқ па, тексеріңіз.`,
    two: (o: string, s: string) => `${o} нұсқасы да мәтінмен расталады${s ? ` (${s})` : ''} — екі дұрыс жауап шығады.`,
    one: (sid: string) => `Жауапты бір ғана ${sid} сөйлемі бойынша таңдауға болады — дәлелдегі екінші сөйлем қажет емес.`,
    lang: (f: string, fix: string) => `Тіл: «${f}»${fix ? ` → «${fix}»` : ''}.`,
    skipped: 'ЖИ бұл тапсырманы тексермеді',
    partialOptions: 'ЖИ барлық жауап нұсқаларын тексермеді. Тексеруді қайта іске қосыңыз.',
    partialEvidence: 'ЖИ барлық дәлелдерді тексермеді. Тексеруді қайта іске қосыңыз.',
  },
} as const;

export type ReviewResult = { ok: true; review: TaskReview[] } | { ok: false; kind: 'structure'; errors: string[] };

export async function reviewLesson(lesson: Lesson, fetchImpl: typeof fetch = fetch, cancel?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<ReviewResult> {
  const m = MSG[lesson.language];
  // 1. Каждый вариант против текста.
  const a = await callModelJson(buildOptionProbePrompt(lesson), OPTION_PROBE_SCHEMA, fetchImpl, cancel, timeoutMs, 0);
  if (!a.ok) return a;
  const opt = OptionProbe.safeParse(a.data);
  if (!opt.success) return { ok: false, kind: 'structure', errors: ['Проверка ИИ вернула ответ неверной структуры', ...formatIssues(opt.error)] };
  // 2. Абляция доказательств (только если есть что проверять).
  const probes = ablationProbes(lesson);
  let ablation = new Map<string, string>();
  if (probes.length) {
    const b = await callModelJson(buildAblationPrompt(lesson), ABLATION_SCHEMA, fetchImpl, cancel, timeoutMs, 0);
    if (!b.ok) return b;
    const parsed = AblationProbe.safeParse(b.data);
    if (!parsed.success) return { ok: false, kind: 'structure', errors: ['Проверка цитат ИИ вернула ответ неверной структуры'] };
    ablation = new Map(parsed.data.probes.map((p) => [p.key.trim(), p.answer.trim().toLowerCase()]));
  }
  // 3. Язык.
  const c = await callModelJson(buildLanguagePrompt(lesson), LANGUAGE_SCHEMA, fetchImpl, cancel, timeoutMs, 0);
  if (!c.ok) return c;
  const lang = LanguageProbe.safeParse(c.data);
  if (!lang.success) return { ok: false, kind: 'structure', errors: ['Проверка языка ИИ вернула ответ неверной структуры'] };

  const byTask = new Map(opt.data.tasks.map((t) => [t.id, t]));
  const review = lesson.tasks.map((t): TaskReview => {
    const probe = byTask.get(t.id);
    if (!probe) return { taskId: t.id, answerFromText: false, onlyOneCorrect: false, evidenceOk: false, languageOk: false, problems: [m.skipped], ok: false };
    const verdict = new Map(probe.options.map((o) => [o.id, o]));
    const problems: string[] = [];
    const optionsComplete = t.options.every((o) => verdict.has(o.id)) && verdict.size === probe.options.length;
    const expectedProbes = probes.filter((p) => p.task.id === t.id);
    const evidenceComplete = expectedProbes.every((p) => {
      const answer = ablation.get(p.key);
      return answer === 'none' || t.options.some((o) => o.id.toLowerCase() === answer);
    });
    if (!optionsComplete) problems.push(m.partialOptions);
    if (!evidenceComplete) problems.push(m.partialEvidence);
    const answerFromText = verdict.get(t.correctOptionId)?.verdict === 'supported';
    if (!answerFromText) problems.push(m.answer(t.correctOptionId));
    const extra = t.options.filter((o) => o.id !== t.correctOptionId && verdict.get(o.id)?.verdict === 'supported');
    for (const o of extra) problems.push(m.two(o.id, (verdict.get(o.id)?.sentenceIds ?? []).join(', ')));
    // «Хватает одного предложения» — только если и модель выбрала верный ответ по нему одному, и ответ почти дословно его повторяет:
    // одна абляция моделью давала ложные тревоги на хороших заданиях (модель цепляется за совпадение слов).
    const correctText = t.options.find((o) => o.id === t.correctOptionId)?.text ?? '';
    const sentenceText = new Map(lesson.sentences.map((x) => [x.id, x.text]));
    const solvableAlone = t.skill === 'find' ? [] : (t.evidenceSets[0] ?? []).filter((sid) =>
      ablation.get(`${t.id}:${sid}`) === t.correctOptionId.toLowerCase() && answerOverlap(correctText, sentenceText.get(sid) ?? '') >= ONE_SENTENCE_OVERLAP);
    for (const sid of solvableAlone) problems.push(m.one(sid));
    const langErrors = lang.data.errors.filter((e) => e.taskId === t.id && e.fragment.trim());
    for (const e of langErrors) problems.push(m.lang(e.fragment.trim(), e.fix.trim()));
    const r = { taskId: t.id, answerFromText, onlyOneCorrect: optionsComplete && answerFromText && extra.length === 0, evidenceOk: evidenceComplete && solvableAlone.length === 0, languageOk: langErrors.length === 0, problems };
    return { ...r, ok: problems.length === 0 };
  });
  return { ok: true, review };
}

export const REPAIR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    skill: { type: 'string', enum: ['find', 'match', 'infer'] },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
    correctOptionId: { type: 'string' },
    evidenceSets: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    hint: { type: 'string' },
  },
  required: ['id', 'skill', 'question', 'options', 'correctOptionId', 'evidenceSets', 'hint'],
} as const;

export function buildRepairPrompt(lesson: Lesson, task: Task, problems: string[]): string {
  const math = subjectOf(lesson) === 'math';
  return [
    `Исправь ОДНО задание по ${math ? 'математической' : 'читательской'} грамотности (${lesson.grade} класс) на ${langName(lesson.language)} языке.`,
    `Сохрани id "${task.id}" и тип skill="${task.skill}"${math ? '' : ` (${SKILL_NAME[task.skill]})`}. Три варианта с id "a","b","c", ровно один верный.`,
    math
      ? 'Не добавляй исходных данных. Пересчитай ответ. В solution объясни расчёт с единицами, а в calc запиши формулу из чисел условия: value с expr для числа или choose с pick и values для сравниваемых вариантов. Используй + - * / и скобки.'
      : 'Верный вариант должен полностью следовать из текста, без добавленных фактов; бери слова из текста без замен. Неверные варианты должны явно противоречить тексту.',
    task.skill === 'find'
      ? 'evidenceSets — одно предложение, где факт назван прямо.'
      : 'evidenceSets — минимум два разных предложения в каждом наборе, и ответ нельзя получить ни из одного предложения по отдельности. Вопрос не должен подсказывать ответ.',
    `Пиши грамотно на ${langName(lesson.language)} языке. Используй только ID предложений из текста.`,
    '',
    'Найденные проблемы, которые нужно устранить:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Текст (ID: предложение):',
    ...lesson.sentences.map((s) => `${s.id}: ${s.text}`),
    '',
    'Текущее задание:',
    JSON.stringify(task),
  ].join('\n');
}

export type RepairResult = { ok: true; task: Task } | { ok: false; kind: 'structure' | 'references' | 'quality'; errors: string[] };

/** Исправленное задание проходит те же проверки, что и черновик: схема, ссылки на предложения и варианты, правила качества. */
export async function repairTask(lesson: Lesson, taskId: string, problems: string[], fetchImpl: typeof fetch = fetch, cancel?: AbortSignal, timeoutMs = TIMEOUT_MS): Promise<RepairResult> {
  const index = lesson.tasks.findIndex((t) => t.id === taskId);
  const current = lesson.tasks[index];
  if (!current) return { ok: false, kind: 'references', errors: [`Задание ${taskId} не найдено`] };
  const math = subjectOf(lesson) === 'math';
  const r = await callModelJson(buildRepairPrompt(lesson, current, problems), math ? MATH_DRAFT_JSON_SCHEMA.properties.tasks.items : REPAIR_JSON_SCHEMA, fetchImpl, cancel, timeoutMs);
  if (!r.ok) return r;
  const parsed = TaskSchema.safeParse(r.data);
  if (!parsed.success) return { ok: false, kind: 'structure', errors: ['Исправление ИИ неверной структуры', ...formatIssues(parsed.error)] };
  if (math && (!parsed.data.solution?.trim() || !parsed.data.calc)) {
    return { ok: false, kind: 'structure', errors: [lesson.language === 'kk'
      ? 'Түзетілген тапсырмада есептің түсіндірмесі мен тексеру формуласы болуы керек.'
      : 'В исправленном задании должны быть объяснение расчёта и формула проверки.'] };
  }
  // id и тип задания — от учителя, не от модели.
  const task: Task = { ...parsed.data, id: current.id, skill: current.skill };
  const next = { ...lesson, tasks: lesson.tasks.map((t, i) => (i === index ? task : t)) };
  const full = LessonSchema.safeParse(next);
  if (!full.success) return { ok: false, kind: 'references', errors: formatIssues(full.error) };
  const issues = qualityIssues(full.data).filter((q) => q.taskIndex === index);
  if (issues.length) return { ok: false, kind: 'quality', errors: issues.map((q) => qualityIssueText(lesson.language, q)) };
  return { ok: true, task };
}
