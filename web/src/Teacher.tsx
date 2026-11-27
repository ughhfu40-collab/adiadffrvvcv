import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { MAX_SENTENCES, MAX_TEXT_CHARS, DEFAULT_LESSON_TITLE, qualityWarnings, qualityWarningText, hasEnoughReadingText, isEditableDraft, qualityIssues, qualityIssueText, readStoredDraft, splitSentences, validateLesson, type Language, type Lesson, type Skill, type Task } from '../../shared/lesson';
import { API_URL, getHealth, readGenerateResponse, type Health } from './api';
import { db, draftRevision, persistDraft, saveTeacherLesson, type DraftSource } from './db';
import { useI18n } from './i18n';

const emptyTask = (n: number, skill: Skill): Task => ({ id: `t${n}`, skill, question: '', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }], correctOptionId: 'a', evidenceSets: [[]], hint: '' });
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

type GenMessage =
  | { kind: 'cancelled' }
  | { kind: 'timeout'; sec: number }
  | { kind: 'unavailable'; reason: string; command: string }
  | { kind: 'server-down'; reason: string }
  | { kind: 'input'; errors: string[] };

type SaveStatus = { draft: Lesson } & ({ kind: 'saved'; lesson: Lesson } | { kind: 'error' });
type GeneratedDraft = { draft: Lesson; errors: string[] };

function nextTaskNumber(tasks: Task[]) {
  const ids = new Set(tasks.map((task) => task.id));
  let number = 1;
  while (ids.has(`t${number}`)) number++;
  return number;
}

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
  const draftEdits = useRef(0);
  const [pendingGeneration, setPendingGeneration] = useState<GeneratedDraft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [structErrors, setStructErrors] = useState<string[]>([]);
  const [genMsg, setGenMsg] = useState<GenMessage | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [storageIssue, setStorageIssue] = useState<'error' | 'conflict' | null>(null);
  const storedRevision = useRef<string | null>(null);
  const lastQueued = useRef<{ source: DraftSource; draft: Lesson | null } | null>(null);
  const [saving, setSaving] = useState(false);
  /** Ревизия загруженного черновика: меняется при каждой загрузке извне и пересоздаёт поля редактора. */
  const [rev, setRev] = useState(0);
  const updateDraft = (value: SetStateAction<Lesson | null>) => {
    draftEdits.current++;
    setDraft(value);
  };
  const loadDraft = (d: Lesson) => { updateDraft(d); setRev((r) => r + 1); };
  const sentences = useMemo(() => splitSentences(text), [text]);
  const tooLong = text.trim().length > MAX_TEXT_CHARS || sentences.length > MAX_SENTENCES;

  useEffect(() => {
    let active = true;
    void getHealth().then((result) => { if (active) setHealth(result); });
    void db.drafts.get('current').then(
      (row) => {
        if (!active) return;
        const restored = readStoredDraft(row?.data);
        if (row && row.data !== null && !restored) setStorageIssue('error');
        const saved = row?.source;
        const source: DraftSource = saved && typeof saved.text === 'string' && typeof saved.title === 'string'
          && (saved.language === 'ru' || saved.language === 'kk') ? saved : {
          text: restored?.sentences.map((sentence) => sentence.text).join('\n') ?? '',
          title: restored?.title ?? '',
          language: restored?.language ?? 'ru',
        };
        storedRevision.current = draftRevision(row);
        lastQueued.current = { source, draft: restored };
        setText(source.text);
        setTitle(source.title);
        setLanguage(source.language);
        if (restored) loadDraft(restored);
      },
      () => { if (active) setStorageIssue('error'); },
    ).finally(() => { if (active) setLoadingDraft(false); });
    return () => { active = false; abortRef.current?.abort(); };
  }, []);
  useEffect(() => {
    if (loadingDraft) return;
    const previous = lastQueued.current;
    if (previous?.draft === draft && previous.source.text === text
      && previous.source.title === title && previous.source.language === language) return;
    if (!previous && !draft && !text && !title && language === 'ru') return;
    const source = { text, title, language };
    lastQueued.current = { source, draft };
    let active = true;
    void persistDraft(source, draft, () => storedRevision.current).then(
      (revision) => {
        if (revision) storedRevision.current = revision;
        if (active) setStorageIssue(revision ? null : 'conflict');
      },
      () => { if (active) setStorageIssue('error'); },
    );
    return () => { active = false; };
  }, [draft, language, loadingDraft, text, title]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const validation = useMemo(() => draft ? validateLesson(draft) : null, [draft]);
  const issues = useMemo(() => draft ? qualityIssues(draft) : [], [draft]);
  const warnings = useMemo(() => validation?.ok ? qualityWarnings(validation.lesson) : [], [validation]);
  const missingSkill = issues.find((issue) => issue.code === 'missing-skill');
  const canSave = !!validation?.ok && issues.length === 0;
  const ollamaOk = health && 'ollama' in health && health.ollama.ok;
  const limitSec = health && 'timeoutSec' in health && health.timeoutSec ? health.timeoutSec : 600;

  function openGeneration(generated: GeneratedDraft) {
    loadDraft(generated.draft);
    setServerErrors(generated.errors);
    setPendingGeneration(null);
  }

  async function generate() {
    if (abortRef.current) return;
    const requestedRevision = draftEdits.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true); setGenMsg(null); setStructErrors([]);
    try {
      const r = await fetch(`${API_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, language, title }), signal: ctrl.signal });
      const body = readGenerateResponse(await r.json());
      ctrl.signal.throwIfAborted();
      if (!body) {
        if (r.status >= 500) setGenMsg({ kind: 'server-down', reason: `HTTP ${r.status}` });
        else setStructErrors(['—']);
        return;
      }
      const candidate = body.ok ? body.lesson : (body.kind === 'references' || body.kind === 'quality') ? body.draft : null;
      if (isEditableDraft(candidate)) {
        const generated = { draft: candidate, errors: body.kind === 'references' ? body.errors ?? [] : [] };
        if (draftEdits.current === requestedRevision) openGeneration(generated);
        else setPendingGeneration(generated);
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
    loadDraft({ id: `manual-${Date.now().toString(36)}`, title: title.trim() || DEFAULT_LESSON_TITLE[language], language, grade: 8, sentences, tasks: [emptyTask(1, 'find'), emptyTask(2, 'match'), emptyTask(3, 'infer')] });
  }

  const updTask = (i: number, patch: Partial<Task>) => updateDraft((d) => d && { ...d, tasks: d.tasks.map((x, k) => (k === i ? { ...x, ...patch } : x)) });

  function repairIds(i: number, task: Task, duplicateTask: boolean, duplicateOptions: boolean) {
    if (!draft) return;
    const patch: Partial<Task> = {};
    if (duplicateTask) patch.id = `t${nextTaskNumber(draft.tasks)}`;
    if (duplicateOptions) {
      const oldCorrect = task.options.map((option, index) => ({ option, index })).filter(({ option }) => option.id === task.correctOptionId);
      patch.options = task.options.map((option, index) => ({ ...option, id: String.fromCharCode(97 + index) }));
      patch.correctOptionId = oldCorrect.length === 1 ? patch.options[oldCorrect[0]!.index]!.id : '';
    }
    updTask(i, patch);
  }

  function addMissingTask() {
    if (!draft || !missingSkill || draft.tasks.length >= 3) return;
    updateDraft({ ...draft, tasks: [...draft.tasks, emptyTask(nextTaskNumber(draft.tasks), missingSkill.skill)] });
  }

  async function save() {
    if (!draft || !canSave || !validation?.ok || saving) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const saved = await saveTeacherLesson(validation.lesson);
      setSaveStatus({ kind: 'saved', draft, lesson: saved.lesson });
    } catch {
      setSaveStatus({ kind: 'error', draft });
    } finally {
      setSaving(false);
    }
  }
  function exportJson() {
    if (!canSave || !validation?.ok) return;
    const lesson = saveStatus?.draft === draft && saveStatus.kind === 'saved' ? saveStatus.lesson : validation.lesson;
    const blob = new Blob([JSON.stringify(lesson, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${lesson.id}.json`; a.rel = 'noopener';
    // Ссылка должна быть в DOM: мобильный Chrome игнорирует click() по неприкреплённой ссылке.
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  // Ошибки схемы, привязанные к заданию (tasks.N.…), показываются рядом с ним; остальные — у кнопки сохранения.
  const allErrors = validation && !validation.ok ? validation.errors : [];
  const taskOf = (e: string) => { const m = /^tasks\.(\d+)\./.exec(e); return m ? Number(m[1]) : null; };
  const errText = (e: string) => e.replace(/^[^:]*: /, '');
  const liveServerErrors = serverErrors.filter((e) => allErrors.includes(e));
  const step = !draft ? 1 : canSave ? 3 : 2;
  const steps = [t('tStep1'), t('tStep2'), t('tStep3')];
  const go = (n: number) => document.getElementById(`t-step-${n}`)?.scrollIntoView({ block: 'start' });

  return (
    <div className="space-y-6 pt-6 sm:pt-10">
      <ol aria-label={t('tSteps')} className="grid grid-cols-3 gap-2 sm:gap-4" data-testid="t-steps">
        {steps.map((label, k) => {
          const n = k + 1;
          const state = n < step ? 'done' : n === step ? 'current' : 'next';
          return (
            <li key={n}>
              <button type="button" onClick={() => go(n)} aria-current={state === 'current' ? 'step' : undefined}
                className={`flex h-full w-full flex-col items-start gap-1 rounded-xl border-t-4 bg-card px-3 py-2 text-left text-sm transition sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-3 ${state === 'next' ? 'border-line text-muted' : 'border-brand'} ${state === 'current' ? 'font-semibold shadow-sm' : ''}`}>
                <span aria-hidden="true" className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-serif text-sm font-semibold ${state === 'next' ? 'border border-line' : 'bg-brand text-on-brand'}`}>{state === 'done' ? '✓' : n}</span>
                <span className="leading-tight">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {storageIssue && <p className="rounded-xl bg-bad-soft p-3 text-bad" role="alert" data-testid="t-draft-storage-error">
        {t(storageIssue === 'conflict' ? 'tDraftConflict' : 'tDraftStorageError')}
      </p>}

      <section id="t-step-1" className="card scroll-mt-4 space-y-4 p-5 sm:p-7" aria-labelledby="t-step-1-title">
        <StepTitle n={1} id="t-step-1-title">{t('tText')}</StepTitle>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1" placeholder={t('tTitle')} aria-label={t('tTitle')} value={title} disabled={loadingDraft} onChange={(e) => setTitle(e.target.value)} data-testid="t-title" />
          <select className="input" value={language} disabled={loadingDraft} onChange={(e) => setLanguage(e.target.value as Language)} data-testid="t-lang">
            <option value="ru">Русский</option><option value="kk">Қазақша</option>
          </select>
        </div>
        <textarea className="input h-44 w-full font-serif text-[1.05rem] leading-7" placeholder={t('tPaste')} aria-label={t('tPaste')} value={text} disabled={loadingDraft} onChange={(e) => setText(e.target.value)} data-testid="t-text" />
        {sentences.length > 0 && (
          <ol className="space-y-1 rounded-xl bg-paper p-3 font-serif text-[0.95rem]" data-testid="t-preview">
            {sentences.map((s) => <li key={s.id} className="flex gap-2"><span className="mt-0.5 shrink-0 font-sans text-xs font-semibold text-brand-ink">{s.id}</span><span>{s.text}</span></li>)}
          </ol>
        )}
        <div className="flex items-start gap-2 text-sm" data-testid="t-health">
          <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${!health ? 'animate-pulse bg-line' : ollamaOk ? 'bg-ok' : 'bg-warn'}`} />
          {!health ? <span className="text-muted">{t('tChecking')}</span> : 'error' in health ? <span className="text-bad">{health.error}</span>
            : health.ollama.ok ? <span className="text-ok">{t('tReady', { model: health.ollama.model })}</span>
            : <span className="text-warn">{health.ollama.reason}. {t('tStart')} <code className="rounded bg-paper px-1">{health.startCommand}</code></span>}
        </div>
        <p className="text-sm text-muted">{t('tGenerateLead')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={loadingDraft || busy || !hasEnoughReadingText(sentences) || tooLong} onClick={() => void generate()} data-testid="t-generate">{busy ? t('tGenerating') : t('tGenerate')}</button>
          {busy && <button className="btn-ghost" onClick={() => abortRef.current?.abort()} data-testid="t-cancel">{t('tCancel')}</button>}
          {busy && (
            <span className="inline-flex items-center gap-2 rounded-full bg-paper px-3 py-1.5 text-sm text-muted" role="status" data-testid="t-elapsed">
              <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              {t('tElapsed', { time: mmss(elapsed), limit: mmss(limitSec) })}
            </span>
          )}
          {!busy && <button className="btn-ghost" disabled={loadingDraft || sentences.length < 2} onClick={manualDraft}>{t('tManual')}</button>}
          {!ollamaOk && !busy && <span className="text-xs text-muted">{t('tNoModel')}</span>}
          {tooLong && <span className="text-xs text-warn" role="status" data-testid="t-too-long">{t('tTooLong', { chars: MAX_TEXT_CHARS, n: MAX_SENTENCES })}</span>}
        </div>
        {genMsg && (
          <div role="alert" data-testid={`t-msg-${genMsg.kind}`}
            className={`rounded-xl p-3 text-sm ${genMsg.kind === 'cancelled' ? 'bg-paper' : 'bg-bad-soft text-bad'}`}>
            {genMsg.kind === 'cancelled' && t('tCancelled')}
            {genMsg.kind === 'timeout' && t('tTimeout', { sec: genMsg.sec })}
            {genMsg.kind === 'unavailable' && t('tUnavailable', { reason: genMsg.reason, command: genMsg.command })}
            {genMsg.kind === 'server-down' && t('tServerDown', { reason: genMsg.reason })}
            {genMsg.kind === 'input' && t('tInputRejected', { errors: genMsg.errors.join('; ') })}
          </div>
        )}
        {structErrors.length > 0 && (
          <div role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad" data-testid="t-struct-error">
            <b>{t('tStructTitle')}</b> {draft ? t('tStructKept') : ''} {t('tStructRetry')}
            <ul className="list-disc pl-5">{structErrors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {pendingGeneration && (
          <div className="space-y-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
            <p role="status">{t('tPendingGeneration')}</p>
            <button type="button" className="btn-ghost" disabled={busy} data-testid="t-open-generated"
              onClick={() => openGeneration(pendingGeneration)}>{t('tOpenGenerated')}</button>
          </div>
        )}
      </section>

      <section id="t-step-2" className="card scroll-mt-4 space-y-4 p-5 sm:p-7" aria-labelledby="t-step-2-title" data-testid={draft ? 't-draft' : undefined}>
        <StepTitle n={2} id="t-step-2-title">{t('tDraftTitle')}</StepTitle>
        <p className="rounded-xl border-l-4 border-brand bg-brand-soft/60 p-3 text-sm" data-testid="t-autocheck">{t('tAutoCheck')}</p>
        {!draft ? <p className="text-sm text-muted">{t('tStep2Empty')}</p> : (
          <>
            {liveServerErrors.length > 0 && <div className="rounded-xl bg-warn-soft p-3 text-sm text-warn" role="alert"><b>{t('tRefErrors')}</b><ul className="list-disc pl-5">{liveServerErrors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
            {issues.length > 0 && (
              <div className="rounded-xl bg-warn-soft p-3 text-sm text-warn" role="alert" data-testid="t-quality">
                <b>{t('tQualityTitle')}</b>
                <ul className="list-disc pl-5">{issues.map((q, k) => <li key={k}>{qualityIssueText(lang, q)}</li>)}</ul>
              </div>
            )}
            <input className="input w-full font-serif text-lg font-semibold" aria-label={t('tTitle')} value={draft.title} onChange={(e) => updateDraft({ ...draft, title: e.target.value })} />
            {draft.tasks.map((task, i) => {
              const taskIssues = issues.filter((q) => q.taskIndex === i);
              const taskWarnings = warnings.filter((w) => w.taskIndex === i);
              const taskErrors = allErrors.filter((e) => taskOf(e) === i);
              const duplicateTask = draft.tasks.slice(0, i).some((item) => item.id === task.id);
              const duplicateOptions = new Set(task.options.map((option) => option.id)).size < task.options.length;
              const flagged = taskIssues.length > 0 || taskErrors.length > 0;
              return (
                <fieldset key={`${rev}-${i}`} data-testid={`t-task-${i}`} data-issue={taskIssues.length > 0}
                  className={`min-w-0 space-y-3 rounded-2xl border p-4 ${flagged ? 'border-warn/60 bg-warn-soft/40 ring-2 ring-warn/30' : 'border-line'}`}>
                  <legend className="px-1 font-serif text-lg font-semibold">{t('tTaskN', { n: i + 1 })}</legend>
                  {flagged && (
                    <div className="rounded-xl bg-warn-soft p-3 text-sm text-warn" role="alert">
                      <b>{t('tFixHere')}</b>
                      {taskIssues.length > 0 && <ul data-testid={`t-task-issue-${i}`}>{taskIssues.map((q, k) => <li key={k}>⚠ {qualityIssueText(lang, q)}</li>)}</ul>}
                      {taskErrors.length > 0 && <ul data-testid={`t-task-err-${i}`}>{taskErrors.map((e) => <li key={e}>⚠ {errText(e)}</li>)}</ul>}
                    </div>
                  )}
                  {(duplicateTask || duplicateOptions) && (
                    <button type="button" className="btn-ghost" data-testid={`t-fix-ids-${i}`}
                      onClick={() => repairIds(i, task, duplicateTask, duplicateOptions)}>{t('tRepairIds')}</button>
                  )}
                  {taskWarnings.length > 0 && (
                    <p className="rounded-xl border border-warn/40 p-3 text-sm text-warn" data-testid={`t-task-warn-${i}`}>
                      {taskWarnings.map((w) => `💡 ${qualityWarningText(lang, w)}`).join(' ')}
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select className="input max-w-full" value={task.skill} onChange={(e) => updTask(i, { skill: e.target.value as Skill })} aria-label={t('tTaskN', { n: i + 1 })}>
                      <option value="find">{t('tSkillFind')}</option><option value="match">{t('tSkillMatch')}</option><option value="infer">{t('tSkillInfer')}</option>
                    </select>
                    <input className="input min-w-0 flex-1" placeholder={t('tQuestion')} aria-label={t('tQuestion')} value={task.question} onChange={(e) => updTask(i, { question: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-muted">{t('tOptions')}</div>
                    {task.options.map((o, k) => (
                      <div key={k} className="flex items-center gap-2">
                        <input type="radio" className="h-4 w-4 accent-[rgb(var(--brand))]" name={`correct-${rev}-${i}`} checked={task.correctOptionId === o.id} onChange={() => updTask(i, { correctOptionId: o.id })} title={t('tCorrect')} aria-label={`${t('tCorrect')}: ${o.id}`} />
                        <span className="w-4 font-mono text-xs text-muted">{o.id}</span>
                        <input className="input min-w-0 flex-1" aria-label={t('tOption', { id: o.id })} value={o.text} onChange={(e) => updTask(i, { options: task.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
                      </div>
                    ))}
                  </div>
                  <EvidenceEditor index={i} sentences={draft.sentences} sets={task.evidenceSets} onChange={(evidenceSets) => updTask(i, { evidenceSets })} />
                  <input className="input w-full" placeholder={t('tHint')} aria-label={t('tHint')} value={task.hint} onChange={(e) => updTask(i, { hint: e.target.value })} />
                  {draft.tasks.length > 1 && (
                    <button type="button" className="btn-ghost text-bad" data-testid={`t-remove-task-${i}`}
                      onClick={() => loadDraft({ ...draft, tasks: draft.tasks.filter((_, index) => index !== i) })}>{t('tRemoveTask')}</button>
                  )}
                </fieldset>
              );
            })}
            {missingSkill && draft.tasks.length < 3 && (
              <button type="button" className="btn-ghost" data-testid="t-add-task" onClick={addMissingTask}>{t('tAddTask')}</button>
            )}
          </>
        )}
      </section>

      <section id="t-step-3" className="card scroll-mt-4 space-y-4 p-5 sm:p-7" aria-labelledby="t-step-3-title">
        <StepTitle n={3} id="t-step-3-title">{t('tStep3')}</StepTitle>
        <p className="text-sm text-muted">{draft && !canSave ? t('tSaveBlocked') : t('tSaveLead')}</p>
        {allErrors.length > 0 && (
          <div className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
            <b>{t('tErrorsTitle')}</b>
            <ul className="list-disc pl-5" data-testid="t-errors">
              {allErrors.map((e) => { const n = taskOf(e); return <li key={e}>{n === null ? e : `${t('tTaskN', { n: n + 1 })}: ${errText(e)} (${e.split(': ')[0]})`}</li>; })}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={!canSave || saving} onClick={() => void save()} data-testid="t-save">{t('tSave')}</button>
          <button className="btn-ghost" disabled={!canSave} onClick={exportJson} data-testid="t-export">{t('tExport')}</button>
          {draft && <button className="btn-ghost text-bad" disabled={saving} onClick={() => updateDraft(null)}>{t('tDelete')}</button>}
        </div>
        {saveStatus?.draft === draft && saveStatus.kind === 'error' && <p className="rounded-xl bg-bad-soft p-3 text-bad" role="alert" data-testid="t-save-error">{t('tSaveError')}</p>}
        {saveStatus?.draft === draft && saveStatus.kind === 'saved' && <p className="rounded-xl bg-ok-soft p-3 text-ok" role="status" data-testid="t-saved">
          ✓ {saveStatus.lesson.id === draft.id ? t('tSaved') : t('tSavedVersion', { title: saveStatus.lesson.title })}
        </p>}
      </section>
    </div>
  );
}

function StepTitle({ n, id, children }: { n: number; id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-3 font-serif text-2xl font-semibold tracking-tight">
      <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-base text-on-brand">{n}</span>
      {children}
    </h2>
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
    <div className="space-y-3 rounded-xl bg-paper p-3" data-testid={`t-ev-${index}`}>
      <div className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="inline-block h-4 w-6 rounded bg-marker" />{t('tEvidence')}</div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        {safeSets.map((s, k) => (
          <span key={k} className="inline-flex items-center">
            <button type="button" role="tab" aria-selected={k === cur} data-testid={`t-ev-${index}-set-${k}`} onClick={() => setActive(k)}
              className={`min-h-9 px-3 py-1 text-xs ${safeSets.length > 1 ? 'rounded-l-lg' : 'rounded-lg'} ${k === cur ? 'bg-brand font-semibold text-on-brand' : 'border border-line bg-card'}`}>
              {t('tSet', { n: k + 1 })}: {s.join(', ') || '—'}
            </button>
            {safeSets.length > 1 && (
              <button type="button" aria-label={t('tRemoveSet', { n: k + 1 })} data-testid={`t-ev-${index}-del-${k}`}
                onClick={() => { onChange(safeSets.filter((_, j) => j !== k)); setActive(0); }}
                className="min-h-9 rounded-r-lg border border-l-0 border-line bg-card px-2.5 py-1 text-xs hover:bg-bad-soft hover:text-bad">×</button>
            )}
          </span>
        ))}
        <button type="button" className="min-h-9 rounded-lg border border-dashed border-brand/50 px-3 py-1 text-xs font-medium text-brand-ink hover:bg-brand-soft" data-testid={`t-ev-${index}-add`}
          onClick={() => { onChange([...safeSets.filter((s) => s.length), []]); setActive(safeSets.filter((s) => s.length).length); }}>{t('tAddSet')}</button>
      </div>
      <div className="space-y-1 font-serif">
        {sentences.map((s) => {
          const on = (safeSets[cur] ?? []).includes(s.id);
          return (
            <button key={s.id} type="button" aria-pressed={on} data-testid={`t-ev-${index}-${s.id}`} onClick={() => toggle(s.id)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[0.95rem] transition-colors ${on ? 'bg-marker text-marker-ink' : 'hover:bg-marker/30 active:bg-marker/70'}`}>
              <span className={`mt-0.5 inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded-full px-1 font-sans text-[11px] font-semibold ${on ? 'bg-brand text-on-brand' : 'border border-line text-muted'}`}>{on ? `✓ ${s.id}` : s.id}</span>
              <span>{s.text}</span>
            </button>
          );
        })}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">{t('tEvidenceText')}</summary>
        <input className="input mt-1 w-full font-mono" data-testid={`t-evidence-${index}`} value={text} aria-label={t('tEvidenceText')}
          onChange={(e) => { setText(e.target.value); onChange(parseEvidence(e.target.value)); }} />
      </details>
    </div>
  );
}
