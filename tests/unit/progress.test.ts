import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB, readProgress, seedBuiltins } from '../../web/src/db';

describe('сохранение прогресса в IndexedDB', () => {
  it('попытки переживают переоткрытие базы', async () => {
    const name = `t-${Math.random()}`;
    const a = new AppDB(name);
    await seedBuiltins(a);
    await a.attempts.add({ lessonId: 'ru-saiga', taskId: 't1', skill: 'find', optionId: 'b', evidence: ['s3'], answerCorrect: true, evidenceOk: false, solved: false, at: 1 });
    await a.attempts.add({ lessonId: 'ru-saiga', taskId: 't1', skill: 'find', optionId: 'b', evidence: ['s1'], answerCorrect: true, evidenceOk: true, solved: true, at: 2 });
    a.close();
    const b = new AppDB(name);
    expect(await b.lessons.count()).toBe(BUILTIN_LESSONS.length);
    const p = await readProgress(b);
    expect(p.skills.find).toEqual({ attempts: 2, solved: 1, errors: 1 });
    expect(p.skills.infer.attempts).toBe(0);
    expect(p.solved).toEqual(new Set(['ru-saiga/t1']));
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
    expect(await d.lessons.count()).toBe(BUILTIN_LESSONS.length + 1);
  });
});

it('новый встроенный ID не перезаписывает ранее импортированный урок и его прогресс', async () => {
  const d = new AppDB(`upgrade-${Math.random()}`);
  const builtin = BUILTIN_LESSONS.find((l) => l.id === 'ru-garden')!;
  const original = { ...builtin, title: 'Прежний урок ученика' };
  expect((await importLesson(original, d)).status).toBe('new');
  await d.attempts.add({ lessonId: original.id, taskId: 't1', skill: 'find', optionId: 'b', evidence: ['s1'], answerCorrect: true, evidenceOk: true, solved: true, at: 1 });
  await seedBuiltins(d);
  expect(await d.lessons.get(original.id)).toMatchObject({ source: 'imported', lesson: original });
  expect((await readProgress(d)).solved.has(`${original.id}/t1`)).toBe(true);
  expect((await importLesson(original, d)).status).toBe('same');
  await d.delete();
});

describe('качество новых черновиков не ломает старые уроки', () => {
  it('встроенные уроки валидны по схеме независимо от правил качества', async () => {
    const { validateLesson } = await import('../../shared/lesson');
    for (const l of BUILTIN_LESSONS) expect(validateLesson(l).ok).toBe(true);
  });
});

describe('одновременный импорт двух разных уроков с одним ID', () => {
  it('оба урока сохраняются: один под исходным ID, второй как -v2; ничего не перезаписано', async () => {
    const d = new AppDB(`conc-${Math.random()}`);
    const base = structuredClone(BUILTIN_LESSONS[0]!);
    const a = { ...base, id: 'conc-x', title: 'Версия A' };
    const b = { ...base, id: 'conc-x', title: 'Версия B' };
    const [ra, rb] = await Promise.all([importLesson(a, d), importLesson(b, d)]);
    expect([ra.status, rb.status].sort()).toEqual(['new', 'renamed']);
    const rows = await d.lessons.where('id').startsWith('conc-x').toArray();
    expect(rows.map((r) => r.id).sort()).toEqual(['conc-x', 'conc-x-v2']);
    const titles = rows.map((r) => r.lesson.title).sort();
    expect(titles.some((x) => x.startsWith('Версия A'))).toBe(true);
    expect(titles.some((x) => x.startsWith('Версия B'))).toBe(true);
  });
  it('десять одновременных импортов разных версий — десять уроков без потерь', async () => {
    const d = new AppDB(`conc10-${Math.random()}`);
    const base = structuredClone(BUILTIN_LESSONS[1]!);
    const versions = Array.from({ length: 10 }, (_, i) => ({ ...base, id: 'many', title: `V${i}` }));
    const res = await Promise.all(versions.map((v) => importLesson(v, d)));
    expect(res.filter((r) => r.status === 'new')).toHaveLength(1);
    expect(await d.lessons.where('id').startsWith('many').count()).toBe(10);
  });
});
