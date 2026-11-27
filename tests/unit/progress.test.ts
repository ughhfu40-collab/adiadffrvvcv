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

import { importLesson } from '../../web/src/db';
import { BUILTIN_LESSONS } from '../../shared/builtin';

describe('импорт урока с уже существующим ID', () => {
  it('тот же урок → same; другая версия → копия с новым ID, старый урок и прогресс не тронуты', async () => {
    const d = new AppDB(`imp-${Math.random()}`);
    await seedBuiltins(d);
    const original = BUILTIN_LESSONS[0]!;
    await d.attempts.add({ lessonId: original.id, taskId: 't1', skill: 'find', optionId: 'b', evidence: ['s1'], answerCorrect: true, evidenceOk: true, solved: true, at: 1 });
    expect((await importLesson(structuredClone(original), d)).status).toBe('same');
    const changed = { ...structuredClone(original), title: 'Изменённый' };
    const r = await importLesson(changed, d);
    expect(r).toMatchObject({ status: 'renamed', originalId: original.id, lesson: { id: `${original.id}-v2` } });
    expect((await d.lessons.get(original.id))!.lesson.title).toBe(original.title);
    expect(await d.attempts.where('lessonId').equals(original.id).count()).toBe(1);
    // Повторный импорт той же изменённой версии не плодит копии
    expect((await importLesson(changed, d)).status).toBe('same');
    expect(await d.lessons.count()).toBe(5);
  });
});

describe('качество новых черновиков не ломает старые уроки', () => {
  it('встроенные уроки валидны по схеме независимо от правил качества', async () => {
    const { validateLesson } = await import('../../shared/lesson');
    for (const l of BUILTIN_LESSONS) expect(validateLesson(l).ok).toBe(true);
  });
});
