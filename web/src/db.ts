import Dexie, { type Table } from 'dexie';
import type { Grade, Language, Lesson, Skill } from '../../shared/lesson';
import { BUILTIN_LESSONS } from '../../shared/builtin';
import { subjectOf, type Subject } from '../../shared/math';

export interface LessonRow { id: string; lesson: Lesson; source: 'builtin' | 'imported' | 'teacher'; addedAt: number }
export interface AttemptRow { id?: number; lessonId: string; taskId: string; skill: Skill; optionId: string | null; evidence: string[]; answerCorrect: boolean; evidenceOk: boolean; solved: boolean; at: number }
export interface DraftSource { text: string; title: string; language: Language; grade?: Grade; subject?: Subject }
export interface DraftRow { id: string; data: unknown; updatedAt: number; source?: DraftSource; revision?: string }

export class AppDB extends Dexie {
  lessons!: Table<LessonRow, string>;
  attempts!: Table<AttemptRow, number>;
  drafts!: Table<DraftRow, string>;
  constructor(name = 'oqy-reader') {
    super(name);
    this.version(1).stores({ lessons: 'id, source', attempts: '++id, lessonId, [lessonId+taskId], skill', drafts: 'id' });
  }
}

export const db = new AppDB();

export function draftRevision(row: DraftRow | undefined) {
  return row ? row.revision ?? `legacy-${row.updatedAt}` : null;
}

/** The editor saves only over the revision it last read or committed. */
export async function persistDraft(
  source: DraftSource, draft: Lesson | null, expected: () => string | null,
): Promise<string | null> {
  return db.transaction('rw', db.drafts, async () => {
    const current = await db.drafts.get('current');
    if (draftRevision(current) !== expected()) return null;
    const revision = Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-');
    await db.drafts.put({ id: 'current', data: draft, source, revision, updatedAt: Date.now() });
    return revision;
  });
}

export async function seedBuiltins(d: AppDB = db) {
  await d.transaction('rw', d.lessons, async () => {
    const existing = await d.lessons.bulkGet(BUILTIN_LESSONS.map((lesson) => lesson.id));
    const rows: LessonRow[] = BUILTIN_LESSONS.flatMap((lesson, i) =>
      !existing[i] || existing[i]?.source === 'builtin' ? [{ id: lesson.id, lesson, source: 'builtin', addedAt: 0 }] : []);
    await d.lessons.bulkPut(rows);
  });
}

export interface SkillStats { attempts: number; solved: number; errors: number }
const emptySkills = (): Record<Skill, SkillStats> => ({ find: { attempts: 0, solved: 0, errors: 0 }, match: { attempts: 0, solved: 0, errors: 0 }, infer: { attempts: 0, solved: 0, errors: 0 } });

/** Прогресс по навыкам: всего и отдельно по разделам «Чтение» и «Математика» (раздел урока берётся из таблицы уроков). */
export async function readProgress(d: AppDB = db) {
  const skills = emptySkills();
  const bySubject: Record<Subject, Record<Skill, SkillStats>> = { reading: emptySkills(), math: emptySkills() };
  const solved = new Set<string>();
  const solvedBy = new Map<string, Set<string>>();
  const subjectByLesson = new Map((await d.lessons.toArray()).map((row) => [row.id, subjectOf(row.lesson)] as const));
  for (const a of await d.attempts.toArray()) {
    const subject = subjectByLesson.get(a.lessonId) ?? 'reading';
    for (const [key, stats] of [['all', skills[a.skill]], [subject, bySubject[subject][a.skill]]] as const) {
      stats.attempts++;
      if (a.solved) {
        const k = `${a.lessonId}/${a.taskId}`;
        if (key === 'all') solved.add(k);
        const bucket = `${key}|${a.skill}`;
        if (!solvedBy.has(bucket)) solvedBy.set(bucket, new Set());
        solvedBy.get(bucket)!.add(k);
      } else stats.errors++;
    }
  }
  for (const skill of ['find', 'match', 'infer'] as const) {
    skills[skill].solved = solvedBy.get(`all|${skill}`)?.size ?? 0;
    for (const subject of ['reading', 'math'] as const) bySubject[subject][skill].solved = solvedBy.get(`${subject}|${skill}`)?.size ?? 0;
  }
  return { skills, bySubject, solved };
}

export async function solvedKeys(d: AppDB = db): Promise<Set<string>> {
  const rows = await d.attempts.filter((a) => a.solved).toArray();
  return new Set(rows.map((a) => `${a.lessonId}/${a.taskId}`));
}

export type ImportOutcome =
  | { status: 'new'; lesson: Lesson }
  | { status: 'same'; lesson: Lesson }
  | { status: 'renamed'; lesson: Lesson; originalId: string };

const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x);

/** Импорт без потерь: существующий урок (и прогресс по его ID) никогда не перезаписывается.
 *  Проверка ID и запись — одна rw-транзакция Dexie: одновременные импорты с одним ID выполняются по очереди,
 *  и второй гарантированно увидит первый. */
export function importLesson(lesson: Lesson, d: AppDB = db): Promise<ImportOutcome> {
  return storeLesson(lesson, 'imported', d);
}

export function saveTeacherLesson(lesson: Lesson, d: AppDB = db): Promise<ImportOutcome> {
  return storeLesson(lesson, 'teacher', d);
}

async function storeLesson(lesson: Lesson, source: 'imported' | 'teacher', d: AppDB): Promise<ImportOutcome> {
  return d.transaction('rw', d.lessons, async (): Promise<ImportOutcome> => {
    const existing = await d.lessons.get(lesson.id);
    if (!existing) {
      await d.lessons.add({ id: lesson.id, lesson, source, addedAt: Date.now() });
      return { status: 'new', lesson };
    }
    if (stable(existing.lesson) === stable(lesson)) return { status: 'same', lesson: existing.lesson };
    for (let n = 2; ; n++) {
      const id = `${lesson.id}-v${n}`;
      const other = await d.lessons.get(id);
      if (!other) {
        const copy: Lesson = { ...lesson, id, title: `${lesson.title} (v${n})` };
        // add, а не put: если ID внезапно занят, транзакция упадёт, а не перезапишет урок.
        await d.lessons.add({ id, lesson: copy, source, addedAt: Date.now() });
        return { status: 'renamed', lesson: copy, originalId: lesson.id };
      }
      // Копия уже есть, только если совпадает всё, включая название (с пометкой vN).
      if (stable(other.lesson) === stable({ ...lesson, id, title: `${lesson.title} (v${n})` })) return { status: 'same', lesson: other.lesson };
    }
  });
}
