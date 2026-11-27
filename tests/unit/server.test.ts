import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildApp } from '../../server/app';
import { assembleDraft, buildPrompt, generateLesson, GenerationCancelled, GenerationTimeout } from '../../server/ollama';
import { splitSentences } from '../../shared/lesson';

process.env.NODE_ENV = 'test';
const text = 'Мурат посадил яблоню весной. Летом её поливали каждый день. Осенью дерево дало первые яблоки.';
const sentences = splitSentences(text);
const opt = [{ id: 'a', text: 'Да' }, { id: 'b', text: 'Нет' }];
const goodTasks = { tasks: [
  { id: 't1', skill: 'find', question: 'Когда посадили?', options: [{ id: 'a', text: 'Весной' }, { id: 'b', text: 'Зимой' }], correctOptionId: 'a', evidenceSets: [['s1']], hint: 'Время года' },
  { id: 't2', skill: 'match', question: 'Что было после посадки?', options: opt, correctOptionId: 'a', evidenceSets: [['s1', 's2']], hint: 'Весна и лето' },
  { id: 't3', skill: 'infer', question: 'Помог ли полив?', options: opt, correctOptionId: 'a', evidenceSets: [['s2', 's3']], hint: 'Лето и осень' },
] };
const meta = { id: 'x', title: 'T', language: 'ru' as const };

afterEach(() => vi.unstubAllGlobals());

describe('сервер: проверка черновика модели', () => {
  it('принимает корректный черновик', () => {
    expect(assembleDraft(goodTasks, meta, sentences).ok).toBe(true);
  });
  it('отклоняет несуществующие ID предложений и вариантов', () => {
    const bad = structuredClone(goodTasks);
    bad.tasks[0]!.evidenceSets = [['s9']];
    bad.tasks[0]!.correctOptionId = 'q';
    const r = assembleDraft(bad, meta, sentences);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(2);
  });
  it('generateLesson разбирает ответ Ollama', async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify(goodTasks) } })));
    const r = await generateLesson({ text, language: 'ru', title: 'Яблоня' }, fake as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    const body = JSON.parse((fake.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content).toContain('s3: Осенью');
    expect(body.format.properties.tasks).toBeTruthy();
  });
  it('503 с причиной и командой запуска, если Ollama недоступна', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/generate', payload: { text, language: 'ru' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().startCommand).toMatch(/ollama/);
    const h = await app.inject({ url: '/api/health' });
    expect(h.json().ollama.ok).toBe(false);
  });
  it('/api/validate использует общую схему', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/validate', payload: { id: 'x' } });
    expect(res.statusCode).toBe(422);
  });
});

describe('сервер: структурно неверные ответы модели', () => {
  it('tasks: {} → structure, без черновика', () => {
    const r = assembleDraft({ tasks: {} }, meta, sentences);
    expect(r).toMatchObject({ ok: false, kind: 'structure' });
    expect('draft' in r).toBe(false);
  });
  it('options: null → structure', () => {
    const bad = structuredClone(goodTasks) as { tasks: Record<string, unknown>[] };
    bad.tasks[0]!.options = null;
    expect(assembleDraft(bad, meta, sentences)).toMatchObject({ ok: false, kind: 'structure' });
  });
  it('ошибка только в ссылках → references с редактируемым черновиком', () => {
    const bad = structuredClone(goodTasks);
    bad.tasks[0]!.evidenceSets = [['s9']];
    const r = assembleDraft(bad, meta, sentences);
    expect(r).toMatchObject({ ok: false, kind: 'references' });
    if (!r.ok && r.kind === 'references') expect(r.draft.tasks[0]!.evidenceSets).toEqual([['s9']]);
  });
  it('/api/generate возвращает 422 с kind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: { content: '{"tasks":{}}' } }))));
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/generate', payload: { text, language: 'ru' } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ kind: 'structure' });
  });
});

describe('сервер: качество, таймаут, отмена', () => {
  it('сопоставление на одном предложении → quality с редактируемым черновиком', () => {
    const bad = structuredClone(goodTasks);
    bad.tasks[1]!.evidenceSets = [['s2']];
    const r = assembleDraft(bad, meta, sentences);
    expect(r).toMatchObject({ ok: false, kind: 'quality' });
    if (!r.ok && r.kind === 'quality') expect(r.issues).toEqual([{ code: 'too-few-evidence', skill: 'match', taskIndex: 1, setIndex: 0 }]);
  });
  it('нет задания на вывод → quality', () => {
    const bad = { tasks: goodTasks.tasks.slice(0, 2) };
    expect(assembleDraft(bad, meta, sentences)).toMatchObject({ kind: 'quality', issues: [{ code: 'missing-skill', skill: 'infer' }] });
  });
  it('промпт содержит пример сопоставления из двух предложений на языке урока', () => {
    const p = buildPrompt('kk', sentences);
    expect(p).toContain('Айгерім');
    expect(p).toContain('"evidenceSets":[["s2","s3"]]');
    expect(p).toContain('s3: Осенью');
  });
  const hanging = ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
    init.signal!.addEventListener('abort', () => rej(init.signal!.reason ?? new Error('aborted')));
  })) as unknown as typeof fetch;
  it('таймаут → GenerationTimeout и 504 kind=timeout', async () => {
    await expect(generateLesson({ text, language: 'ru', title: '' }, hanging, undefined, 30)).rejects.toBeInstanceOf(GenerationTimeout);
    const app = await buildApp({ timeoutMs: 30, fetchImpl: hanging });
    const res = await app.inject({ method: 'POST', url: '/api/generate', payload: { text, language: 'ru' } });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toMatchObject({ kind: 'timeout' });
  });
  it('отмена → GenerationCancelled', async () => {
    const c = new AbortController();
    const p = generateLesson({ text, language: 'ru', title: '' }, hanging, c.signal, 60_000);
    c.abort();
    await expect(p).rejects.toBeInstanceOf(GenerationCancelled);
  });
  it('таймаут по умолчанию — не меньше 10 минут', async () => {
    const { TIMEOUT_MS } = await import('../../server/ollama');
    expect(TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
  });
});
