import { z } from 'zod';

// Русские сообщения для всех ошибок схемы (импорт JSON, /api/validate, /api/generate).
// Явные сообщения у конкретных полей важнее этой карты.
const TYPE_RU: Record<string, string> = {
  string: 'строка', number: 'число', int: 'целое число', boolean: 'да/нет', array: 'список', object: 'объект',
  undefined: 'пусто', null: 'null', nan: 'не число',
};
z.config({
  customError: (iss) => {
    const got = (v: unknown) => (Array.isArray(v) ? 'список' : v === null ? 'null' : TYPE_RU[typeof v] ?? typeof v);
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined ? 'Поле обязательно' : `Неверный тип: нужно ${TYPE_RU[iss.expected] ?? iss.expected}, получено ${got(iss.input)}`;
      case 'too_small':
        return iss.origin === 'array' ? `Слишком мало элементов: нужно не меньше ${iss.minimum}`
          : iss.origin === 'string' ? `Слишком короткое значение: нужно не меньше ${iss.minimum} символов` : `Значение должно быть не меньше ${iss.minimum}`;
      case 'too_big':
        return iss.origin === 'array' ? `Слишком много элементов: не больше ${iss.maximum}`
          : iss.origin === 'string' ? `Слишком длинное значение: не больше ${iss.maximum} символов` : `Значение должно быть не больше ${iss.maximum}`;
      case 'invalid_value':
        return `Недопустимое значение: возможно ${iss.values.map((v) => JSON.stringify(v)).join(', ')}`;
      case 'invalid_format':
        return 'Неверный формат значения';
      case 'unrecognized_keys':
        return `Лишние поля: ${iss.keys.join(', ')}`;
      default:
        return undefined;
    }
  },
});

export const LanguageSchema = z.enum(['kk', 'ru']);
export type Language = z.infer<typeof LanguageSchema>;

export const DEFAULT_LESSON_TITLE: Record<Language, string> = { kk: 'Жаңа сабақ', ru: 'Новый урок' };

export const SkillSchema = z.enum(['find', 'match', 'infer']);
export type Skill = z.infer<typeof SkillSchema>;

export const SKILL_LABELS: Record<Language, Record<Skill, string>> = {
  ru: { find: 'Найти факт', match: 'Сопоставить детали', infer: 'Сделать вывод' },
  kk: { find: 'Деректі табу', match: 'Мәліметтерді салыстыру', infer: 'Қорытынды жасау' },
};

const NonBlankText = z.string().refine((value) => value.trim().length > 0, 'Поле не должно быть пустым');

export const SentenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'ID: латиница, цифры, дефис'),
  text: NonBlankText,
});

export const OptionSchema = z.object({
  id: z.string().min(1),
  text: NonBlankText,
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  skill: SkillSchema,
  question: NonBlankText,
  options: z.array(OptionSchema).min(2).max(6),
  correctOptionId: z.string().min(1),
  /** Каждый элемент — допустимый набор ID предложений-доказательств. */
  evidenceSets: z.array(z.array(z.string().min(1)).min(1)).min(1),
  hint: NonBlankText,
});
export type Task = z.infer<typeof TaskSchema>;

/** Только структура, без ссылочной проверки — для редактируемых черновиков. */
export const LessonBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: NonBlankText,
  language: LanguageSchema,
  grade: z.number().int().min(7).max(9),
  sentences: z.array(SentenceSchema).min(2),
  tasks: z.array(TaskSchema).min(1),
});

/** Единая валидация: структура + ссылочная целостность (ID предложений и вариантов). */
export const LessonSchema = LessonBaseSchema.superRefine((lesson, ctx) => {
  const sentenceIds = new Set<string>();
  lesson.sentences.forEach((s, i) => {
    if (sentenceIds.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sentences', i, 'id'], message: `Повтор ID предложения «${s.id}»` });
    sentenceIds.add(s.id);
  });
  const taskIds = new Set<string>();
  lesson.tasks.forEach((t, ti) => {
    if (taskIds.has(t.id)) ctx.addIssue({ code: 'custom', path: ['tasks', ti, 'id'], message: `Повтор ID задания «${t.id}»` });
    taskIds.add(t.id);
    const optionIds = new Set(t.options.map((o) => o.id));
    if (optionIds.size !== t.options.length) ctx.addIssue({ code: 'custom', path: ['tasks', ti, 'options'], message: 'Повтор ID варианта' });
    if (!optionIds.has(t.correctOptionId)) {
      ctx.addIssue({ code: 'custom', path: ['tasks', ti, 'correctOptionId'], message: `Правильный ответ «${t.correctOptionId}» не найден среди вариантов` });
    }
    t.evidenceSets.forEach((set, si) => {
      set.forEach((sid, k) => {
        if (!sentenceIds.has(sid)) ctx.addIssue({ code: 'custom', path: ['tasks', ti, 'evidenceSets', si, k], message: `Предложение «${sid}» не существует` });
      });
      if (new Set(set).size !== set.length) ctx.addIssue({ code: 'custom', path: ['tasks', ti, 'evidenceSets', si], message: 'Повтор предложения в наборе' });
    });
  });
});
export type Lesson = z.infer<typeof LessonSchema>;

/** Структурно корректный черновик (можно открыть в редакторе). */
export function isEditableDraft(data: unknown): data is Lesson {
  return LessonBaseSchema.safeParse(data).success;
}

const StoredDraftSchema = LessonBaseSchema.extend({
  title: z.string(),
  tasks: z.array(TaskSchema.extend({
    question: z.string(),
    options: z.array(OptionSchema.extend({ text: z.string() })).min(2).max(6),
    correctOptionId: z.string(),
    evidenceSets: z.array(z.array(z.string().min(1))),
    hint: z.string(),
  })).min(1),
});

/** A draft can be reopened while it still has blanks or incomplete evidence. */
export function readStoredDraft(data: unknown): Lesson | null {
  const parsed = StoredDraftSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export type ValidationResult = { ok: true; lesson: Lesson } | { ok: false; errors: string[] };

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`);
}

export function validateLesson(data: unknown): ValidationResult {
  const r = LessonSchema.safeParse(data);
  return r.success ? { ok: true, lesson: r.data } : { ok: false, errors: formatIssues(r.error) };
}

/** Импорт JSON-строки: синтаксис + та же схема. */
export function parseLessonJson(raw: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`Некорректный JSON: ${(e as Error).message}`] };
  }
  return validateLesson(data);
}

/** Разбивка текста на пронумерованные предложения со стабильными ID s1, s2, ... */
export function splitSentences(text: string): { id: string; text: string }[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  let start = 0;
  for (const { 0: punctuation, index } of normalized.matchAll(/[.!?…]+["»”)]*/g)) {
    if (punctuation === '.' && /\d/.test(normalized[index - 1] ?? '') && /\d/.test(normalized[index + 1] ?? '')) continue;
    const end = index + punctuation.length;
    parts.push(normalized.slice(start, end));
    start = end;
  }
  parts.push(normalized.slice(start));
  return parts
    .map((p) => p.trim())
    // Фрагменты без букв и цифр («...», « . ») — не предложения.
    .filter((p) => /[\p{L}\p{N}]/u.test(p))
    .map((p, i) => ({ id: `s${i + 1}`, text: p }));
}

/** Минимум для генерации: три предложения с буквами. Проверяется и в интерфейсе, и на сервере до вызова модели. */
export const MIN_SENTENCES = 3;
/** Верхние границы текста для генерации: длинный промпт может не поместиться в контекст модели. */
export const MAX_SENTENCES = 40;
export const MAX_TEXT_CHARS = 6000;

export function hasEnoughReadingText(sentences: { text: string }[]): boolean {
  return sentences.filter(({ text }) => /\p{L}/u.test(text)).length >= MIN_SENTENCES;
}

// ---------- Проверка ответа ----------

export type EvidenceVerdict = 'correct' | 'missing' | 'extra' | 'wrong' | 'empty';
export interface CheckResult {
  answerCorrect: boolean;
  evidence: EvidenceVerdict;
  solved: boolean;
}

export function checkAnswer(task: Task, optionId: string | null, evidence: string[]): CheckResult {
  const answerCorrect = optionId === task.correctOptionId;
  const chosen = new Set(evidence);
  let verdict: EvidenceVerdict;
  if (chosen.size === 0) verdict = 'empty';
  else if (task.evidenceSets.some((set) => set.length === chosen.size && set.every((id) => chosen.has(id)))) verdict = 'correct';
  else if (task.evidenceSets.some((set) => [...chosen].every((id) => set.includes(id)))) verdict = 'missing';
  else if (task.evidenceSets.some((set) => set.every((id) => chosen.has(id)))) verdict = 'extra';
  else verdict = 'wrong';
  return { answerCorrect, evidence: verdict, solved: answerCorrect && verdict === 'correct' };
}

/** Что сказать, когда доказательства не хватает, — зависит от типа задания. */
const MISSING: Record<Language, Record<Skill, string>> = {
  ru: {
    find: 'Отметь все предложения, в которых об этом сказано.',
    match: 'Найди вторую деталь — ещё одно предложение, с которым нужно сопоставить.',
    infer: 'Для вывода нужна ещё одна опора — найди предложение, из которого вместе с отмеченным следует ответ.',
  },
  kk: {
    find: 'Бұл туралы айтылған барлық сөйлемді белгіле.',
    match: 'Екінші деректі тап — салыстыруға керек тағы бір сөйлем.',
    infer: 'Қорытындыға тағы бір тірек керек — белгіленгенмен бірге жауапқа әкелетін сөйлемді тап.',
  },
};

const FEEDBACK: Record<Language, Record<Exclude<EvidenceVerdict, 'missing'> | 'answerWrong' | 'solved' | 'answerRight', string>> = {
  ru: {
    solved: 'Верно! И ответ, и доказательство найдены.',
    answerWrong: 'Ответ пока неверный. Перечитайте отмеченные предложения.',
    answerRight: 'Ответ верный.',
    correct: 'Доказательство выбрано верно.',
    empty: 'Отметьте в тексте предложение, которое подтверждает ответ.',
    extra: 'Ответ верный, но отмечено лишнее. Оставьте только предложения, которые прямо подтверждают ответ.',
    wrong: 'Ответ верный, но выбранная цитата его не подтверждает. Уточните: в каком предложении об этом сказано?',
  },
  kk: {
    solved: 'Дұрыс! Жауап та, дәлел де табылды.',
    answerWrong: 'Жауап әзірге қате. Мәтінді қайта оқып көріңіз.',
    answerRight: 'Жауап дұрыс.',
    correct: 'Дәлел дұрыс таңдалды.',
    empty: 'Жауапты дәлелдейтін сөйлемді мәтіннен белгілеңіз.',
    extra: 'Жауап дұрыс, бірақ артық сөйлем белгіленген. Жауапты тікелей дәлелдейтін сөйлемдерді ғана қалдырыңыз.',
    wrong: 'Жауап дұрыс, бірақ таңдалған үзінді оны дәлелдемейді. Нақтылаңыз: бұл туралы қай сөйлемде айтылған?',
  },
};

type SkillRef = Skill | Pick<Task, 'skill'>;
const skillOf = (s: SkillRef): Skill => (typeof s === 'string' ? s : s.skill);

/** Одна строка обратной связи. Подсказка о недостающем доказательстве зависит от типа задания (task или skill). */
export function feedbackText(lang: Language, r: CheckResult, task: SkillRef): string {
  const f = FEEDBACK[lang];
  if (r.solved) return f.solved;
  if (!r.answerCorrect) return f.answerWrong;
  if (r.evidence === 'missing') return `${f.answerRight} ${MISSING[lang][skillOf(task)]}`;
  return f[r.evidence];
}

/** Два отдельных итога проверки — ответ и доказательство — и совет, что делать дальше. */
export interface FeedbackParts { answer: string; evidence: string; tip: string | null }

const PARTS: Record<Language, {
  answer: Record<'yes' | 'no', string>;
  evidence: Record<EvidenceVerdict, string>;
  tip: Record<Exclude<EvidenceVerdict, 'missing'> | 'answerWrong', string>;
}> = {
  ru: {
    answer: { yes: 'Ответ верный', no: 'Ответ неверный' },
    evidence: {
      correct: 'Доказательство верное',
      missing: 'Доказательства пока не хватает',
      extra: 'Лишнее предложение',
      wrong: 'Цитата не подтверждает ответ',
      empty: 'Предложение не отмечено',
    },
    tip: {
      answerWrong: 'Перечитай текст и выбери другой ответ. Отмеченные предложения сохранятся.',
      correct: '',
      extra: 'Сними выделение с предложения, которое не подтверждает ответ напрямую.',
      wrong: 'В каком предложении об этом сказано? Сними отметку и выбери другое.',
      empty: 'Нажми в тексте на предложение, которое подтверждает ответ.',
    },
  },
  kk: {
    answer: { yes: 'Жауап дұрыс', no: 'Жауап қате' },
    evidence: {
      correct: 'Дәлел дұрыс',
      missing: 'Дәлел әзірге жеткіліксіз',
      extra: 'Артық сөйлем белгіленген',
      wrong: 'Үзінді жауапты дәлелдемейді',
      empty: 'Сөйлем белгіленбеген',
    },
    tip: {
      answerWrong: 'Мәтінді қайта оқып, басқа жауапты таңда. Белгіленген сөйлемдер сақталады.',
      correct: '',
      extra: 'Жауапты тікелей дәлелдемейтін сөйлемнің белгісін алып таста.',
      wrong: 'Бұл туралы қай сөйлемде айтылған? Белгіні алып, басқасын таңда.',
      empty: 'Мәтіннен жауапты дәлелдейтін сөйлемді бас.',
    },
  },
};

export function feedbackParts(lang: Language, r: CheckResult, task: SkillRef): FeedbackParts {
  const p = PARTS[lang];
  const evTip = r.evidence === 'correct' ? '' : r.evidence === 'missing' ? MISSING[lang][skillOf(task)] : p.tip[r.evidence];
  // Если неверны и ответ, и цитата — сначала про ответ, затем подсказка про цитату.
  const tip = [r.answerCorrect ? '' : p.tip.answerWrong, evTip].filter(Boolean).join(' ');
  return { answer: r.answerCorrect ? p.answer.yes : p.answer.no, evidence: p.evidence[r.evidence], tip: tip || null };
}

// ---------- Рекомендация ----------

export interface AttemptLike {
  lessonId: string;
  taskId: string;
  skill: Skill;
  solved: boolean;
}

/** Навык с наибольшим числом ошибок в уроке → задание того же языка и навыка из другого урока (сначала нерешённые). */
export function recommendNext(
  lessons: Lesson[],
  current: Lesson,
  attempts: AttemptLike[],
  solvedKeys: Set<string>,
): { lesson: Lesson; task: Task; skill: Skill } | null {
  const errors: Record<Skill, number> = { find: 0, match: 0, infer: 0 };
  for (const a of attempts) if (a.lessonId === current.id && !a.solved) errors[a.skill]++;
  const ranked = (Object.keys(errors) as Skill[]).filter((s) => errors[s] > 0).sort((a, b) => errors[b] - errors[a]);
  for (const skill of ranked) {
    const candidates = lessons
      .filter((l) => l.language === current.language && l.id !== current.id)
      .flatMap((l) => l.tasks.filter((t) => t.skill === skill).map((task) => ({ lesson: l, task, skill })));
    const pick = candidates.find((c) => !solvedKeys.has(`${c.lesson.id}/${c.task.id}`)) ?? candidates[0];
    if (pick) return pick;
  }
  return null;
}

// ---------- Качество новых черновиков ----------
// Не входит в LessonSchema: старые и импортированные уроки открываются как раньше.

export type QualityIssue =
  | { code: 'missing-skill'; skill: Skill; taskIndex: null }
  | { code: 'duplicate-skill'; skill: Skill; taskIndex: number }
  | { code: 'duplicate-option-text'; skill: Skill; taskIndex: number }
  | { code: 'too-few-evidence'; skill: Skill; taskIndex: number; setIndex: number };

/** По одному заданию каждого типа, различимые варианты, минимум два доказательства для match и infer. */
export function qualityIssues(lesson: Pick<Lesson, 'tasks'>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<Skill>();
  lesson.tasks.forEach((t, i) => {
    if (seen.has(t.skill)) issues.push({ code: 'duplicate-skill', skill: t.skill, taskIndex: i });
    seen.add(t.skill);
    const answers = t.options.map((option) => option.text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean);
    if (new Set(answers).size < answers.length) issues.push({ code: 'duplicate-option-text', skill: t.skill, taskIndex: i });
    if (t.skill === 'match' || t.skill === 'infer') {
      t.evidenceSets.forEach((set, si) => {
        if (new Set(set).size < 2) issues.push({ code: 'too-few-evidence', skill: t.skill, taskIndex: i, setIndex: si });
      });
    }
  });
  for (const s of ['find', 'match', 'infer'] as Skill[]) if (!seen.has(s)) issues.push({ code: 'missing-skill', skill: s, taskIndex: null });
  return issues;
}

export function qualityIssueText(lang: Language, q: QualityIssue): string {
  const skill = SKILL_LABELS[lang][q.skill];
  const n = q.taskIndex === null ? '' : `${q.taskIndex + 1}`;
  if (lang === 'kk') {
    if (q.code === 'missing-skill') return `«${skill}» түріндегі тапсырма жоқ`;
    if (q.code === 'duplicate-skill') return `${n}-тапсырма: «${skill}» түрі қайталанады — әр түрден бір тапсырма керек`;
    if (q.code === 'duplicate-option-text') return `${n}-тапсырмада бірдей жауап нұсқалары бар. Оларды бір-бірінен ажырататындай етіп жазыңыз.`;
    return `${n}-тапсырма (${skill}): ${q.setIndex + 1}-жиында кемінде екі түрлі сөйлем болуы керек`;
  }
  if (q.code === 'missing-skill') return `Нет задания типа «${skill}»`;
  if (q.code === 'duplicate-skill') return `Задание ${n}: тип «${skill}» повторяется — нужно по одному заданию каждого типа`;
  if (q.code === 'duplicate-option-text') return `Задание ${n} содержит одинаковые варианты ответа. Сформулируйте их по-разному.`;
  return `Задание ${n} (${skill}): в наборе ${q.setIndex + 1} нужно минимум два разных предложения`;
}

// ---------- Мягкие предупреждения для учителя (не блокируют сохранение) ----------

export interface QualityWarning { code: 'answer-in-one-sentence'; taskIndex: number; sentenceId: string; overlap: number }

/** Грубые основы слов: первые 4 символа слов от 3 букв (работает и для казахских, и для русских окончаний). */
const stems = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3).map((w) => w.slice(0, 4));

/**
 * Сопоставление, которое на деле отвечается одним предложением: почти все основы слов правильного варианта
 * есть в одном из предложений текста. Это подсказка для учителя.
 */
export function qualityWarnings(lesson: Pick<Lesson, 'tasks' | 'sentences'>, threshold = 0.8): QualityWarning[] {
  const text = new Map(lesson.sentences.map((s) => [s.id, new Set(stems(s.text))]));
  const out: QualityWarning[] = [];
  lesson.tasks.forEach((t, i) => {
    if (t.skill !== 'match') return;
    const answer = stems(t.options.find((o) => o.id === t.correctOptionId)?.text ?? '');
    if (answer.length < 2) return;
    let best: QualityWarning | null = null;
    for (const [sid, st] of text) {
      const overlap = answer.filter((w) => st.has(w)).length / answer.length;
      if (overlap >= threshold && (!best || overlap > best.overlap)) best = { code: 'answer-in-one-sentence', taskIndex: i, sentenceId: sid, overlap: +overlap.toFixed(2) };
    }
    if (best) out.push(best);
  });
  return out;
}

export function qualityWarningText(lang: Language, w: QualityWarning): string {
  return lang === 'kk'
    ? `${w.taskIndex + 1}-тапсырма: жауап толығымен ${w.sentenceId} сөйлемінде тұрған сияқты. Екінші сөйлемсіз жауап табылмайтынын тексеріңіз — әйтпесе бұл «дерек табу».`
    : `Задание ${w.taskIndex + 1}: похоже, ответ целиком есть в ${w.sentenceId}. Проверьте, что без второго предложения ответить нельзя — иначе это «найти факт», а не сопоставление.`;
}
