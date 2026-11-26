import { useEffect, useMemo, useState } from 'react';
import { isEditableDraft, splitSentences, validateLesson, type Language, type Lesson, type Skill, type Task } from '../../shared/lesson';
import { API_URL, getHealth, type Health } from './api';
import { db } from './db';

const emptyTask = (n: number, skill: Skill): Task => ({ id: `t${n}`, skill, question: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }], correctOptionId: 'a', evidenceSets: [[]], hint: '' });

export function Teacher() {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<Language>('ru');
  const [title, setTitle] = useState('');
  const [health, setHealth] = useState<Health | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Lesson | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [genError, setGenError] = useState<{ reason: string; command?: string } | null>(null);
  const [saved, setSaved] = useState('');
  const [structErrors, setStructErrors] = useState<string[]>([]);
  /** Ревизия загруженного черновика: меняется при каждой загрузке извне и пересоздаёт поля редактора. */
  const [rev, setRev] = useState(0);
  const loadDraft = (d: Lesson) => { setDraft(d); setRev((r) => r + 1); };
  const sentences = useMemo(() => splitSentences(text), [text]);

  useEffect(() => { void getHealth().then(setHealth); void db.drafts.get('current').then((d) => { if (d && isEditableDraft(d.data)) loadDraft(d.data); }); }, []);
  useEffect(() => { if (draft) void db.drafts.put({ id: 'current', data: draft, updatedAt: Date.now() }); }, [draft]);

  const validation = draft ? validateLesson(draft) : null;
  const ollamaOk = health && 'ollama' in health && health.ollama.ok;

  async function generate() {
    setBusy(true); setGenError(null); setServerErrors([]); setStructErrors([]); setSaved('');
    try {
      const r = await fetch(`${API_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, language, title }) });
      const body = (await r.json()) as { ok: boolean; kind?: string; lesson?: unknown; draft?: unknown; errors?: string[]; reason?: string; startCommand?: string };
      if (r.status === 503) setGenError({ reason: body.reason ?? 'Модель недоступна', command: body.startCommand });
      else if (r.status === 400) setGenError({ reason: `Запрос отклонён: ${(body.errors ?? []).join('; ') || 'неверные данные'}` });
      else if (body.ok && isEditableDraft(body.lesson)) loadDraft(body.lesson);
      else if (body.kind === 'references' && isEditableDraft(body.draft)) { loadDraft(body.draft); setServerErrors(body.errors ?? []); }
      else setStructErrors(body.errors?.length ? body.errors : ['Сервер вернул черновик неверной структуры']);
    } catch (e) {
      setGenError({ reason: `Сервер недоступен: ${(e as Error).message}`, command: 'npm run server' });
    } finally { setBusy(false); }
  }

  function manualDraft() {
    loadDraft({ id: `manual-${Date.now().toString(36)}`, title: title || 'Новый урок', language, grade: 8, sentences, tasks: [emptyTask(1, 'find'), emptyTask(2, 'match'), emptyTask(3, 'infer')] });
  }

  const updTask = (i: number, patch: Partial<Task>) => setDraft((d) => d && { ...d, tasks: d.tasks.map((t, k) => (k === i ? { ...t, ...patch } : t)) });

  async function save() {
    if (!validation?.ok) return;
    await db.lessons.put({ id: validation.lesson.id, lesson: validation.lesson, source: 'teacher', addedAt: Date.now() });
    setSaved('Урок сохранён и доступен в режиме ученика');
  }
  function exportJson() {
    if (!validation?.ok) return;
    const blob = new Blob([JSON.stringify(validation.lesson, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${validation.lesson.id}.json`; a.rel = 'noopener';
    // Ссылка должна быть в DOM: мобильный Chrome игнорирует click() по неприкреплённой ссылке.
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="h2">1. Текст</h2>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="Название урока" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as Language)} data-testid="t-lang">
            <option value="ru">Русский</option><option value="kk">Қазақша</option>
          </select>
        </div>
        <textarea className="input h-40 w-full" placeholder="Вставьте текст (6–12 предложений)" value={text} onChange={(e) => setText(e.target.value)} data-testid="t-text" />
        {sentences.length > 0 && (
          <ol className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800" data-testid="t-preview">
            {sentences.map((s) => <li key={s.id}><span className="mr-2 font-mono text-xs text-indigo-600">{s.id}</span>{s.text}</li>)}
          </ol>
        )}
        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="t-health">
          {!health ? 'Проверяю сервер…' : 'error' in health ? <span className="text-rose-700 dark:text-rose-300">{health.error}</span>
            : health.ollama.ok ? <span className="text-emerald-700 dark:text-emerald-400">Ollama готова · модель {health.ollama.model}</span>
            : <span className="text-amber-800 dark:text-amber-300">{health.ollama.reason}. Запустите: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{health.startCommand}</code></span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy || sentences.length < 3} onClick={() => void generate()} data-testid="t-generate">{busy ? 'Генерация…' : 'Сгенерировать черновик (Ollama)'}</button>
          <button className="btn-ghost" disabled={sentences.length < 2} onClick={manualDraft}>Составить вручную</button>
          {!ollamaOk && <span className="self-center text-xs text-slate-500">Без модели доступны ручной черновик, просмотр и импорт.</span>}
        </div>
        {structErrors.length > 0 && (
          <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200" data-testid="t-struct-error">
            <b>Черновик не загружен: модель вернула неверную структуру.</b> {draft ? 'Предыдущий черновик сохранён ниже.' : ''} Попробуйте сгенерировать ещё раз или составьте вручную.
            <ul className="list-disc pl-5">{structErrors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {genError && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200" data-testid="t-gen-error">{genError.reason}{genError.command && <> — команда: <code>{genError.command}</code></>}</div>}
      </section>

      {draft && (
        <section className="card space-y-4" data-testid="t-draft">
          <h2 className="h2">2. Черновик — проверьте и исправьте</h2>
          {serverErrors.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950" role="alert"><b>Модель ошиблась в ссылках — исправьте поля ниже:</b><ul className="list-disc pl-5">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
          <input className="input w-full" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          {draft.tasks.map((t, i) => (
            <fieldset key={`${rev}-${i}`} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex gap-2">
                <select className="input" value={t.skill} onChange={(e) => updTask(i, { skill: e.target.value as Skill })}>
                  <option value="find">find — факт</option><option value="match">match — сопоставить</option><option value="infer">infer — вывод</option>
                </select>
                <input className="input flex-1" placeholder="Вопрос" value={t.question} onChange={(e) => updTask(i, { question: e.target.value })} />
              </div>
              {t.options.map((o, k) => (
                <div key={k} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${i}`} checked={t.correctOptionId === o.id} onChange={() => updTask(i, { correctOptionId: o.id })} title="Правильный ответ" />
                  <span className="font-mono text-xs">{o.id}</span>
                  <input className="input flex-1" value={o.text} onChange={(e) => updTask(i, { options: t.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
                </div>
              ))}
              <label className="block text-sm">Доказательства (наборы через «;», ID через «,»):
                <EvidenceField key={`${rev}-${i}`} value={t.evidenceSets} testId={`t-evidence-${i}`} onChange={(evidenceSets) => updTask(i, { evidenceSets })} />
              </label>
              <input className="input w-full" placeholder="Подсказка" value={t.hint} onChange={(e) => updTask(i, { hint: e.target.value })} />
            </fieldset>
          ))}
          {validation && !validation.ok && <ul className="list-disc pl-5 text-sm text-rose-700 dark:text-rose-300" data-testid="t-errors">{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!validation?.ok} onClick={() => void save()}>Сохранить урок</button>
            <button className="btn-ghost" disabled={!validation?.ok} onClick={exportJson} data-testid="t-export">Экспорт JSON</button>
            <button className="btn-ghost" onClick={() => { setDraft(null); void db.drafts.delete('current'); }}>Удалить черновик</button>
          </div>
          {saved && <p className="text-emerald-700 dark:text-emerald-400">{saved}</p>}
        </section>
      )}
    </div>
  );
}

const fmtEvidence = (sets: string[][]) => sets.map((x) => x.join(',')).join('; ');
const parseEvidence = (v: string) => v.split(';').map((x) => x.split(',').map((y) => y.trim()).filter(Boolean)).filter((x) => x.length);

/** Поле наборов доказательств: локальный текст для ввода, синхронизация с черновиком на каждое изменение. */
function EvidenceField({ value, onChange, testId }: { value: string[][]; onChange: (v: string[][]) => void; testId: string }) {
  const [text, setText] = useState(() => fmtEvidence(value));
  return (
    <input className="input w-full font-mono" data-testid={testId} value={text}
      onChange={(e) => { setText(e.target.value); onChange(parseEvidence(e.target.value)); }}
      onBlur={() => setText(fmtEvidence(value))} />
  );
}
