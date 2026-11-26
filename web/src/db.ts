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
