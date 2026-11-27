import { z } from 'zod';

export const LanguageSchema = z.enum(['kk', 'ru']);
export type Language = z.infer<typeof LanguageSchema>;

export const SkillSchema = z.enum(['find', 'match', 'infer']);
export type Skill = z.infer<typeof SkillSchema>;

export const SKILL_LABELS: Record<Language, Record<Skill, string>> = {
  ru: { find: 'Найти факт', match: 'Сопоставить детали', infer: 'Сделать вывод' },
  kk: { find: 'Деректі табу', match: 'Мәліметтерді салыстыру', infer: 'Қорытынды жасау' },
};

export const SentenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'ID: латиница, цифры, дефис'),
  text: z.string().min(1),
});

export const OptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  skill: SkillSchema,
  question: z.string().min(1),
  options: z.array(OptionSchema).min(2).max(6),
  correctOptionId: z.string().min(1),
  /** Каждый элемент — допустимый набор ID предложений-доказательств. */
  evidenceSets: z.array(z.array(z.string().min(1)).min(1)).min(1),
  hint: z.string().min(1),
});
export type Task = z.infer<typeof TaskSchema>;

/** Только структура, без ссылочной проверки — для редактируемых черновиков. */
export const LessonBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
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
  if (!normalized) return [];
  const parts = normalized.match(/[^.!?…]+(?:[.!?…]+["»”)]*|$)/g) ?? [normalized];
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p, i) => ({ id: `s${i + 1}`, text: p }));
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

const FEEDBACK: Record<Language, Record<EvidenceVerdict | 'answerWrong' | 'solved', string>> = {
  ru: {
    solved: 'Верно! И ответ, и доказательство найдены.',
    answerWrong: 'Ответ пока неверный. Перечитайте отмеченные предложения.',
    correct: 'Доказательство выбрано верно.',
    empty: 'Отметьте в тексте предложение, которое подтверждает ответ.',
    missing: 'Ответ верный, но доказательства не хватает: найдите ещё одно предложение, которое нужно для вывода.',
    extra: 'Ответ верный, но отмечено лишнее. Оставьте только предложения, которые прямо подтверждают ответ.',
    wrong: 'Ответ верный, но выбранная цитата его не подтверждает. Уточните: в каком предложении об этом сказано?',
  },
  kk: {
    solved: 'Дұрыс! Жауап та, дәлел де табылды.',
    answerWrong: 'Жауап әзірге қате. Мәтінді қайта оқып көріңіз.',
    correct: 'Дәлел дұрыс таңдалды.',
    empty: 'Жауапты дәлелдейтін сөйлемді мәтіннен белгілеңіз.',
    missing: 'Жауап дұрыс, бірақ дәлел жеткіліксіз: қорытындыға қажет тағы бір сөйлемді табыңыз.',
    extra: 'Жауап дұрыс, бірақ артық сөйлем белгіленген. Жауапты тікелей дәлелдейтін сөйлемдерді ғана қалдырыңыз.',
    wrong: 'Жауап дұрыс, бірақ таңдалған үзінді оны дәлелдемейді. Нақтылаңыз: бұл туралы қай сөйлемде айтылған?',
  },
};

export function feedbackText(lang: Language, r: CheckResult): string {
  const f = FEEDBACK[lang];
  if (r.solved) return f.solved;
  if (!r.answerCorrect) return f.answerWrong;
  return f[r.evidence];
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
  | { code: 'too-few-evidence'; skill: Skill; taskIndex: number; setIndex: number };

/** По одному заданию каждого типа; у сопоставления и вывода каждый набор — минимум два разных предложения. */
export function qualityIssues(lesson: Pick<Lesson, 'tasks'>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<Skill>();
  lesson.tasks.forEach((t, i) => {
    if (seen.has(t.skill)) issues.push({ code: 'duplicate-skill', skill: t.skill, taskIndex: i });
    seen.add(t.skill);
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
    return `${n}-тапсырма (${skill}): ${q.setIndex + 1}-жиында кемінде екі түрлі сөйлем болуы керек`;
  }
  if (q.code === 'missing-skill') return `Нет задания типа «${skill}»`;
  if (q.code === 'duplicate-skill') return `Задание ${n}: тип «${skill}» повторяется — нужно по одному заданию каждого типа`;
  return `Задание ${n} (${skill}): в наборе ${q.setIndex + 1} нужно минимум два разных предложения`;
}
