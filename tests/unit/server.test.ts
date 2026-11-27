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
  it('неверный ответ Ollama возвращает 422 без черновика', async () => {
    const originals = ['null', '{"message":{"content":42}}', '<html>ошибка прокси</html>'];
    for (const response of originals) {
      const app = await buildApp({ fetchImpl: async () => new Response(response) });
      try {
        const res = await app.inject({ method: 'POST', url: '/api/generate', payload: { text, language: 'ru' } });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toMatchObject({ ok: false, kind: 'structure' });
        expect(res.json()).not.toHaveProperty('draft');
      } finally {
        await app.close();
      }
    }
  });
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

describe('сервер: запросы браузера и формат ошибок HTTP', () => {
  it('отклоняет посторонний origin до запуска модели и принимает свой или явно разрешённый', async () => {
    const model = vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify(goodTasks) } })));
    const app = await buildApp({ fetchImpl: model, allowedOrigins: ['https://school.example'] });
    const post = (origin: string) => app.inject({
      method: 'POST', url: '/api/generate', headers: { host: '127.0.0.1:4173', origin }, payload: { text, language: 'ru' },
    });
    try {
      const denied = await post('https://unlisted.example');
      expect(denied.statusCode).toBe(403);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      expect(model).not.toHaveBeenCalled();
      expect((await post('http://127.0.0.1:4173')).statusCode).toBe(200);
      const allowed = await post('https://school.example');
      expect(allowed.statusCode).toBe(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://school.example');
      expect(model).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('отдаёт один контракт ошибок для неверного JSON, слишком большого тела и неподдерживаемого типа', async () => {
    const app = await buildApp();
    try {
      for (const { status, payload, type } of [
        { status: 400, payload: '{"text":', type: 'application/json' },
        { status: 413, payload: JSON.stringify({ text: 'x'.repeat(1_048_576) }), type: 'application/json' },
        { status: 415, payload: '<lesson/>', type: 'application/xml' },
      ]) {
        const res = await app.inject({ method: 'POST', url: '/api/generate', headers: { 'content-type': type }, payload });
        expect(res.statusCode).toBe(status);
        expect(res.json()).toMatchObject({ ok: false, kind: 'input', errors: [expect.any(String)] });
      }
    } finally {
      await app.close();
    }
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
  it('одинаковые варианты с разными ID требуют редактирования перед сохранением', () => {
    const duplicate = structuredClone(goodTasks);
    duplicate.tasks[0]!.options[1]!.text = '  ВЕСНОЙ  ';
    expect(assembleDraft(duplicate, meta, sentences)).toMatchObject({
      kind: 'quality',
      issues: [{ code: 'duplicate-option-text', skill: 'find', taskIndex: 0 }],
    });
  });
  it('промпт содержит пример сопоставления из двух предложений на языке урока', () => {
    const p = buildPrompt('kk', sentences);
    expect(p).toContain('Айгерім');
    expect(p).toContain('"evidenceSets":[["s1","s2"]]');
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

describe('стресс-находки: пустой текст и уникальность ID', () => {
  it('пробелы, точки и последовательности чисел без текста отклоняются до вызова модели', async () => {
    const spy = vi.fn();
    const app = await buildApp({ fetchImpl: spy as unknown as typeof fetch });
    for (const t of [' '.repeat(40), '   .   .   .   .   .   .   ', '\n\t'.repeat(15), '1234567. 3984651. 3256179.']) {
      const res = await app.inject({ method: 'POST', url: '/api/generate', payload: { text: t, language: 'ru' } });
      expect(res.statusCode).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it('500 одновременных генераций дают 500 разных ID', async () => {
    const fake = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify(goodTasks) } }))) as unknown as typeof fetch;
    const res = await Promise.all(Array.from({ length: 500 }, () => generateLesson({ text, language: 'ru', title: '' }, fake)));
    const ids = res.map((r) => (r.ok ? r.lesson.id : ''));
    expect(new Set(ids).size).toBe(500);
  });
});
