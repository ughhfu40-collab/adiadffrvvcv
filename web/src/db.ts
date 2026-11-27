import Dexie, { type Table } from 'dexie';
import type { Lesson, Skill } from '../../shared/lesson';
import { BUILTIN_LESSONS } from '../../shared/builtin';

export interface LessonRow { id: string; lesson: Lesson; source: 'builtin' | 'imported' | 'teacher'; addedAt: number }
export interface AttemptRow { id?: number; lessonId: string; taskId: string; skill: Skill; optionId: string | null; evidence: string[]; answerCorrect: boolean; evidenceOk: boolean; solved: boolean; at: number }
export interface DraftRow { id: string; data: unknown; updatedAt: number }

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

export async function seedBuiltins(d: AppDB = db) {
  await d.lessons.bulkPut(BUILTIN_LESSONS.map((lesson) => ({ id: lesson.id, lesson, source: 'builtin' as const, addedAt: 0 })));
}

export interface SkillStats { attempts: number; solved: number; errors: number }
export async function skillProgress(d: AppDB = db): Promise<Record<Skill, SkillStats>> {
  const out: Record<Skill, SkillStats> = { find: { attempts: 0, solved: 0, errors: 0 }, match: { attempts: 0, solved: 0, errors: 0 }, infer: { attempts: 0, solved: 0, errors: 0 } };
  const solvedTasks = new Set<string>();
  for (const a of await d.attempts.toArray()) {
    const s = out[a.skill];
    s.attempts++;
    if (a.solved) solvedTasks.add(`${a.skill}|${a.lessonId}/${a.taskId}`);
    else s.errors++;
  }
  for (const k of solvedTasks) out[k.split('|')[0] as Skill].solved++;
  return out;
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
export async function importLesson(lesson: Lesson, d: AppDB = db): Promise<ImportOutcome> {
  return d.transaction('rw', d.lessons, async (): Promise<ImportOutcome> => {
    const existing = await d.lessons.get(lesson.id);
    if (!existing) {
      await d.lessons.add({ id: lesson.id, lesson, source: 'imported', addedAt: Date.now() });
      return { status: 'new', lesson };
    }
    if (stable(existing.lesson) === stable(lesson)) return { status: 'same', lesson: existing.lesson };
    for (let n = 2; ; n++) {
      const id = `${lesson.id}-v${n}`;
      const other = await d.lessons.get(id);
      if (!other) {
        const copy: Lesson = { ...lesson, id, title: `${lesson.title} (v${n})` };
        // add, а не put: если ID внезапно занят, транзакция упадёт, а не перезапишет урок.
        await d.lessons.add({ id, lesson: copy, source: 'imported', addedAt: Date.now() });
        return { status: 'renamed', lesson: copy, originalId: lesson.id };
      }
      // Копия уже есть, только если совпадает всё, включая название (с пометкой vN).
      if (stable(other.lesson) === stable({ ...lesson, id, title: `${lesson.title} (v${n})` })) return { status: 'same', lesson: other.lesson };
    }
  });
}
