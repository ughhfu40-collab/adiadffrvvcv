import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB, seedBuiltins, skillProgress } from '../../web/src/db';

describe('сохранение прогресса в IndexedDB', () => {
  it('попытки переживают переоткрытие базы', async () => {
    const name = `t-${Math.random()}`;
    const a = new AppDB(name);
    await seedBuiltins(a);
    await a.attempts.add({ lessonId: 'ru-saiga', taskId: 't1', skill: 'find', optionId: 'b', evidence: ['s3'], answerCorrect: true, evidenceOk: false, solved: false, at: 1 });
    await a.attempts.add({ lessonId: 'ru-saiga', taskId: 't1', skill: 'find', optionId: 'b', evidence: ['s1'], answerCorrect: true, evidenceOk: true, solved: true, at: 2 });
    a.close();
    const b = new AppDB(name);
    expect(await b.lessons.count()).toBe(4);
    const p = await skillProgress(b);
    expect(p.find).toEqual({ attempts: 2, solved: 1, errors: 1 });
    expect(p.infer.attempts).toBe(0);
  });
});
