import { useEffect, useMemo, useRef, useState } from 'react';
import { isEditableDraft, qualityIssues, qualityIssueText, splitSentences, validateLesson, type Language, type Lesson, type QualityIssue, type Skill, type Task } from '../../shared/lesson';
import { API_URL, getHealth, type Health } from './api';
import { db } from './db';
import { useI18n } from './i18n';

const emptyTask = (n: number, skill: Skill): Task => ({ id: `t${n}`, skill, question: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }], correctOptionId: 'a', evidenceSets: [[]], hint: '' });
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

type GenMessage =
  | { kind: 'cancelled' }
  | { kind: 'timeout'; sec: number }
  | { kind: 'unavailable'; reason: string; command: string }
  | { kind: 'server-down'; reason: string }
  | { kind: 'input'; errors: string[] };

interface GenerateResponse { ok: boolean; kind?: string; lesson?: unknown; draft?: unknown; errors?: string[]; reason?: string; startCommand?: string; timeoutSec?: number }

export function Teacher() {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<Language>('ru');
  const [title, setTitle] = useState('');
  const [health, setHealth] = useState<Health | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState<Lesson | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [structErrors, setStructErrors] = useState<string[]>([]);
  const [genMsg, setGenMsg] = useState<GenMessage | null>(null);
  const [saved, setSaved] = useState('');
  /** Ревизия загруженного черновика: меняется при каждой загрузке извне и пересоздаёт поля редактора. */
  const [rev, setRev] = useState(0);
  const loadDraft = (d: Lesson) => { setDraft(d); setRev((r) => r + 1); };
  const sentences = useMemo(() => splitSentences(text), [text]);

  useEffect(() => {
    void getHealth().then(setHealth);
    void db.drafts.get('current').then((d) => { if (d && isEditableDraft(d.data)) loadDraft(d.data); });
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => { if (draft) void db.drafts.put({ id: 'current', data: draft, updatedAt: Date.now() }); }, [draft]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const validation = draft ? validateLesson(draft) : null;
  const issues: QualityIssue[] = validation?.ok ? qualityIssues(validation.lesson) : [];
  const canSave = !!validation?.ok && issues.length === 0;
  const ollamaOk = health && 'ollama' in health && health.ollama.ok;
  const limitSec = health && 'timeoutSec' in health && health.timeoutSec ? health.timeoutSec : 600;

  async function generate() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true); setGenMsg(null); setServerErrors([]); setStructErrors([]); setSaved('');
    try {
      const r = await fetch(`${API_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, language, title }), signal: ctrl.signal });
      const body = (await r.json()) as GenerateResponse;
      // Черновик меняется только при успешном или редактируемом ответе; во всех остальных случаях правки учителя остаются.
      if (body.ok && isEditableDraft(body.lesson)) loadDraft(body.lesson);
      else if ((body.kind === 'references' || body.kind === 'quality') && isEditableDraft(body.draft)) {
        loadDraft(body.draft);
        if (body.kind === 'references') setServerErrors(body.errors ?? []);
      } else if (body.kind === 'timeout') setGenMsg({ kind: 'timeout', sec: body.timeoutSec ?? limitSec });
      else if (body.kind === 'unavailable') setGenMsg({ kind: 'unavailable', reason: body.reason ?? '', command: body.startCommand ?? '' });
      else if (body.kind === 'input' || r.status === 400) setGenMsg({ kind: 'input', errors: body.errors ?? [] });
      else if (body.kind === 'cancelled') setGenMsg({ kind: 'cancelled' });
      else setStructErrors(body.errors?.length ? body.errors : ['—']);
    } catch (e) {
      if (ctrl.signal.aborted) setGenMsg({ kind: 'cancelled' });
      else setGenMsg({ kind: 'server-down', reason: (e as Error).message });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function manualDraft() {
    loadDraft({ id: `manual-${Date.now().toString(36)}`, title: title || t('tNewLesson'), language, grade: 8, sentences, tasks: [emptyTask(1, 'find'), emptyTask(2, 'match'), emptyTask(3, 'infer')] });
  }

  const updTask = (i: number, patch: Partial<Task>) => setDraft((d) => d && { ...d, tasks: d.tasks.map((x, k) => (k === i ? { ...x, ...patch } : x)) });

  async function save() {
    if (!canSave || !validation?.ok) return;
    await db.lessons.put({ id: validation.lesson.id, lesson: validation.lesson, source: 'teacher', addedAt: Date.now() });
    setSaved(t('tSaved'));
  }
  function exportJson() {
    if (!canSave || !validation?.ok) return;
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
        <h2 className="h2">{t('tText')}</h2>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1" placeholder={t('tTitle')} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="t-title" />
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as Language)} data-testid="t-lang">
            <option value="ru">Русский</option><option value="kk">Қазақша</option>
          </select>
        </div>
        <textarea className="input h-40 w-full" placeholder={t('tPaste')} value={text} onChange={(e) => setText(e.target.value)} data-testid="t-text" />
        {sentences.length > 0 && (
          <ol className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800" data-testid="t-preview">
            {sentences.map((s) => <li key={s.id}><span className="mr-2 font-mono text-xs text-indigo-600">{s.id}</span>{s.text}</li>)}
          </ol>
        )}
        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="t-health">
          {!health ? t('tChecking') : 'error' in health ? <span className="text-rose-700 dark:text-rose-300">{health.error}</span>
            : health.ollama.ok ? <span className="text-emerald-700 dark:text-emerald-400">{t('tReady', { model: health.ollama.model })}</span>
            : <span className="text-amber-800 dark:text-amber-300">{health.ollama.reason}. {t('tStart')} <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{health.startCommand}</code></span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={busy || sentences.length < 3} onClick={() => void generate()} data-testid="t-generate">{busy ? t('tGenerating') : t('tGenerate')}</button>
          {busy && <button className="btn-ghost" onClick={() => abortRef.current?.abort()} data-testid="t-cancel">{t('tCancel')}</button>}
          {!busy && <button className="btn-ghost" disabled={sentences.length < 2} onClick={manualDraft}>{t('tManual')}</button>}
          {!ollamaOk && !busy && <span className="text-xs text-slate-500">{t('tNoModel')}</span>}
        </div>
        {busy && <p className="text-sm text-slate-600 dark:text-slate-300" role="status" data-testid="t-elapsed">{t('tElapsed', { time: mmss(elapsed), limit: mmss(limitSec) })}</p>}
        {genMsg && (
          <div role="alert" data-testid={`t-msg-${genMsg.kind}`}
            className={`rounded-lg p-3 text-sm ${genMsg.kind === 'cancelled' ? 'bg-slate-100 dark:bg-slate-800' : 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200'}`}>
            {genMsg.kind === 'cancelled' && t('tCancelled')}
            {genMsg.kind === 'timeout' && t('tTimeout', { sec: genMsg.sec })}
            {genMsg.kind === 'unavailable' && t('tUnavailable', { reason: genMsg.reason, command: genMsg.command })}
            {genMsg.kind === 'server-down' && t('tServerDown', { reason: genMsg.reason })}
            {genMsg.kind === 'input' && t('tInputRejected', { errors: genMsg.errors.join('; ') })}
          </div>
        )}
        {structErrors.length > 0 && (
          <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200" data-testid="t-struct-error">
            <b>{t('tStructTitle')}</b> {draft ? t('tStructKept') : ''} {t('tStructRetry')}
            <ul className="list-disc pl-5">{structErrors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
      </section>

      {draft && (
        <section className="card space-y-4" data-testid="t-draft">
          <h2 className="h2">{t('tDraftTitle')}</h2>
          {serverErrors.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950" role="alert"><b>{t('tRefErrors')}</b><ul className="list-disc pl-5">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
          {issues.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" role="alert" data-testid="t-quality">
              <b>{t('tQualityTitle')}</b>
              <ul className="list-disc pl-5">{issues.map((q, k) => <li key={k}>{qualityIssueText(lang, q)}</li>)}</ul>
            </div>
          )}
          <input className="input w-full" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          {draft.tasks.map((task, i) => {
            const taskIssues = issues.filter((q) => q.taskIndex === i);
            return (
              <fieldset key={`${rev}-${i}`} data-testid={`t-task-${i}`} data-issue={taskIssues.length > 0}
                className={`min-w-0 space-y-2 rounded-lg border p-3 ${taskIssues.length ? 'border-amber-400 ring-2 ring-amber-300 dark:ring-amber-700' : 'border-slate-200 dark:border-slate-700'}`}>
                {taskIssues.length > 0 && <ul className="text-sm text-amber-800 dark:text-amber-300" data-testid={`t-task-issue-${i}`}>{taskIssues.map((q, k) => <li key={k}>⚠ {qualityIssueText(lang, q)}</li>)}</ul>}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select className="input max-w-full" value={task.skill} onChange={(e) => updTask(i, { skill: e.target.value as Skill })}>
                    <option value="find">{t('tSkillFind')}</option><option value="match">{t('tSkillMatch')}</option><option value="infer">{t('tSkillInfer')}</option>
                  </select>
                  <input className="input min-w-0 flex-1" placeholder={t('tQuestion')} value={task.question} onChange={(e) => updTask(i, { question: e.target.value })} />
                </div>
                {task.options.map((o, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input type="radio" name={`correct-${rev}-${i}`} checked={task.correctOptionId === o.id} onChange={() => updTask(i, { correctOptionId: o.id })} title={t('tCorrect')} />
                    <span className="font-mono text-xs">{o.id}</span>
                    <input className="input min-w-0 flex-1" value={o.text} onChange={(e) => updTask(i, { options: task.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
                  </div>
                ))}
                <EvidenceEditor index={i} sentences={draft.sentences} sets={task.evidenceSets} onChange={(evidenceSets) => updTask(i, { evidenceSets })} />
                <input className="input w-full" placeholder={t('tHint')} value={task.hint} onChange={(e) => updTask(i, { hint: e.target.value })} />
              </fieldset>
            );
          })}
          {validation && !validation.ok && <ul className="list-disc pl-5 text-sm text-rose-700 dark:text-rose-300" data-testid="t-errors">{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!canSave} onClick={() => void save()} data-testid="t-save">{t('tSave')}</button>
            <button className="btn-ghost" disabled={!canSave} onClick={exportJson} data-testid="t-export">{t('tExport')}</button>
            <button className="btn-ghost" onClick={() => { setDraft(null); void db.drafts.delete('current'); }}>{t('tDelete')}</button>
          </div>
          {saved && <p className="text-emerald-700 dark:text-emerald-400" data-testid="t-saved">{saved}</p>}
        </section>
      )}
    </div>
  );
}

const fmtEvidence = (sets: string[][]) => sets.map((x) => x.join(',')).join('; ');
const parseEvidence = (v: string) => v.split(';').map((x) => x.split(',').map((y) => y.trim()).filter(Boolean)).filter((x) => x.length);

/** Доказательства: наборы-вкладки, предложения переключаются нажатием; текстовое поле — для опытных, синхронизировано. */
function EvidenceEditor({ index, sentences, sets, onChange }: { index: number; sentences: { id: string; text: string }[]; sets: string[][]; onChange: (v: string[][]) => void }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const [text, setText] = useState(() => fmtEvidence(sets));
  const order = new Map(sentences.map((s, k) => [s.id, k]));
  const safeSets = sets.length ? sets : [[]];
  const cur = Math.min(active, safeSets.length - 1);

  // Внешние изменения (нажатия на предложения) отражаются в текстовом поле, не мешая вводу.
  useEffect(() => {
    if (fmtEvidence(parseEvidence(text)) !== fmtEvidence(sets)) setText(fmtEvidence(sets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmtEvidence(sets)]);

  const toggle = (sid: string) => {
    const set = safeSets[cur] ?? [];
    const next = set.includes(sid) ? set.filter((x) => x !== sid) : [...set, sid].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    onChange(safeSets.map((s, k) => (k === cur ? next : s)).filter((s, k) => s.length || k === cur));
  };

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60" data-testid={`t-ev-${index}`}>
      <div className="text-sm font-medium">{t('tEvidence')}</div>
      <div className="flex flex-wrap items-center gap-1" role="tablist">
        {safeSets.map((s, k) => (
          <span key={k} className="inline-flex items-center">
            <button type="button" role="tab" aria-selected={k === cur} data-testid={`t-ev-${index}-set-${k}`} onClick={() => setActive(k)}
              className={`rounded-l-md px-2 py-1 text-xs ${k === cur ? 'bg-indigo-600 text-white' : 'bg-white ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-slate-700'}`}>
              {t('tSet', { n: k + 1 })}: {s.join(', ') || '—'}
            </button>
            {safeSets.length > 1 && (
              <button type="button" aria-label={t('tRemoveSet', { n: k + 1 })} data-testid={`t-ev-${index}-del-${k}`}
                onClick={() => { onChange(safeSets.filter((_, j) => j !== k)); setActive(0); }}
                className="rounded-r-md bg-white px-2 py-1 text-xs ring-1 ring-slate-300 hover:bg-rose-50 dark:bg-slate-900 dark:ring-slate-700">×</button>
            )}
          </span>
        ))}
        <button type="button" className="rounded-md px-2 py-1 text-xs text-indigo-700 ring-1 ring-indigo-300 dark:text-indigo-300" data-testid={`t-ev-${index}-add`}
          onClick={() => { onChange([...safeSets.filter((s) => s.length), []]); setActive(safeSets.filter((s) => s.length).length); }}>{t('tAddSet')}</button>
      </div>
      <div className="space-y-1">
        {sentences.map((s) => {
          const on = (safeSets[cur] ?? []).includes(s.id);
          return (
            <button key={s.id} type="button" aria-pressed={on} data-testid={`t-ev-${index}-${s.id}`} onClick={() => toggle(s.id)}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${on ? 'bg-amber-200 dark:bg-amber-700/60' : 'hover:bg-white dark:hover:bg-slate-900'}`}>
              <span className="mr-1 font-mono text-xs text-indigo-600">{s.id}</span>{s.text}
            </button>
          );
        })}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500">{t('tEvidenceText')}</summary>
        <input className="input mt-1 w-full font-mono" data-testid={`t-evidence-${index}`} value={text}
          onChange={(e) => { setText(e.target.value); onChange(parseEvidence(e.target.value)); }} />
      </details>
    </div>
  );
}
