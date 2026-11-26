import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildApp } from '../../server/app';
import { assembleDraft, generateLesson } from '../../server/ollama';
import { splitSentences } from '../../shared/lesson';

process.env.NODE_ENV = 'test';
const text = 'Мурат посадил яблоню весной. Летом её поливали каждый день. Осенью дерево дало первые яблоки.';
const sentences = splitSentences(text);
const goodTasks = { tasks: [
  { id: 't1', skill: 'find', question: 'Когда посадили?', options: [{ id: 'a', text: 'Весной' }, { id: 'b', text: 'Зимой' }], correctOptionId: 'a', evidenceSets: [['s1']], hint: 'Время года' },
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
