import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { DEFAULT_GRADE, DEFAULT_LESSON_TITLE, GRADES, GradeSchema, MAX_SENTENCES, MAX_TEXT_CHARS, qualityWarnings, qualityWarningText, hasEnoughReadingText, isEditableDraft, qualityIssues, qualityIssueText, readStoredDraft, splitSentences, validateLesson, type Grade, type Language, type Lesson, type Skill, type Task } from '../../shared/lesson';
import { API_URL, getHealth, readGenerateResponse, type Health } from './api';
import { db, draftRevision, persistDraft, saveTeacherLesson, type DraftSource } from './db';
import { useI18n } from './i18n';
import { checkCalc, splitBySubject, subjectOf, type Calc, type Subject } from '../../shared/math';
import { AiReviewBar, AiTaskNote, useAiReview } from './AiReview';
import { Icon, Spinner } from './Icon';

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
  const [grade, setGrade] = useState<Grade>(DEFAULT_GRADE);
  const [subject, setSubject] = useState<Subject>('reading');
  const [title, setTitle] = useState('');
  const [health, setHealth] = useState<Health | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const ai = useAiReview();
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
  // Чтение — по предложениям, математика — каждая строка условия отдельно (числа с точкой не разрываются).
  const sentences = useMemo(() => splitBySubject(subject, text, splitSentences), [subject, text]);
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
        setGrade(GradeSchema.safeParse(source.grade).data ?? restored?.grade ?? DEFAULT_GRADE);
        setSubject(source.subject ?? (restored ? subjectOf(restored) : 'reading'));
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
      && previous.source.title === title && previous.source.language === language
      && (previous.source.grade ?? draft?.grade ?? DEFAULT_GRADE) === grade && (previous.source.subject ?? 'reading') === subject) return;
    if (!previous && !draft && !text && !title && language === 'ru' && grade === DEFAULT_GRADE && subject === 'reading') return;
    const source = { text, title, language, grade, subject };
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
  }, [draft, grade, language, loadingDraft, subject, text, title]);
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
    // Вторая проверка ИИ запускается сама, если черновик проходит схему; иначе её можно запустить после правки.
    ai.reset();
    const checked = validateLesson(generated.draft);
    if (checked.ok) void ai.run(checked.lesson);
  }

  async function generate() {
    if (abortRef.current) return;
    const requestedRevision = draftEdits.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true); setGenMsg(null); setStructErrors([]);
    try {
      const r = await fetch(`${API_URL}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, language, title, grade, subject }), signal: ctrl.signal });
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
    ai.reset();
    loadDraft({ id: `manual-${Date.now().toString(36)}`, title: title.trim() || DEFAULT_LESSON_TITLE[language], language, grade, ...(subject === 'math' ? { subject } : {}), sentences, tasks: [emptyTask(1, 'find'), emptyTask(2, 'match'), emptyTask(3, 'infer')] });
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
      <div>
        <p className="kicker">{t('tKicker')}</p>
        <h1 className="mt-2 font-serif text-title font-semibold">{t('tHeading')}</h1>
      </div>
      <ol aria-label={t('tSteps')} className="grid gap-2 sm:grid-cols-3 sm:gap-3" data-testid="t-steps">
        {steps.map((label, k) => {
          const n = k + 1;
          const state = n < step ? 'done' : n === step ? 'current' : 'next';
          return (
            <li key={n}>
              <button type="button" onClick={() => go(n)} aria-current={state === 'current' ? 'step' : undefined}
                className={`flex h-full min-h-11 w-full items-center gap-3 rounded-control border bg-card px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-brand-ink/60 sm:px-4 sm:py-3 ${state === 'current' ? 'border-brand-ink font-semibold text-ink shadow-card ring-1 ring-brand-ink' : state === 'done' ? 'border-line text-ink' : 'border-line text-muted'}`}>
                <span aria-hidden="true" className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${state === 'next' ? 'border border-line-strong/60' : state === 'done' ? 'bg-ok text-card' : 'bg-brand text-on-brand'}`}>
                  {state === 'done' ? <Icon name="check" className="h-4 w-4" /> : n}
                </span>
                <span className="leading-tight">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {storageIssue && <p className="note note-bad" role="alert" data-testid="t-draft-storage-error">
        <Icon name="alert" className="mt-px h-5 w-5" /><span>{t(storageIssue === 'conflict' ? 'tDraftConflict' : 'tDraftStorageError')}</span>
      </p>}

      <section id="t-step-1" className="card scroll-mt-4 space-y-5 p-5 sm:p-7" aria-labelledby="t-step-1-title">
        <StepTitle n={1} id="t-step-1-title">{t('tText')}</StepTitle>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <label className="min-w-0">
            <span className="field-label">{t('tTitle')}</span>
            <input className="input w-full" placeholder={t('tTitlePh')} value={title} disabled={loadingDraft} onChange={(e) => setTitle(e.target.value)} data-testid="t-title" />
          </label>
          <label>
            <span className="field-label">{t('tSubject')}</span>
            <select className="input w-full" value={subject} disabled={loadingDraft} onChange={(e) => setSubject(e.target.value === 'math' ? 'math' : 'reading')} data-testid="t-subject">
              <option value="reading">{t('tSubjectReading')}</option><option value="math">{t('tSubjectMath')}</option>
            </select>
          </label>
          <label>
            <span className="field-label">{t('tLangLabel')}</span>
            <select className="input w-full" value={language} disabled={loadingDraft} onChange={(e) => setLanguage(e.target.value as Language)} data-testid="t-lang">
              <option value="ru">Русский</option><option value="kk">Қазақша</option>
            </select>
          </label>
          <label>
            <span className="field-label">{t('gradeLabel')}</span>
            <select className="input w-full" value={grade} disabled={loadingDraft}
              onChange={(e) => setGrade(GradeSchema.parse(Number(e.target.value)))} data-testid="t-grade">
              {GRADES.map((g) => <option key={g} value={g}>{t('grade', { g })}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="field-label">{t('tTextLabel')}</span>
          <textarea className="input h-44 w-full font-serif text-[1.0625rem] leading-7" placeholder={t(subject === 'math' ? 'tPasteMath' : 'tPaste')} value={text} disabled={loadingDraft} onChange={(e) => setText(e.target.value)} data-testid="t-text" aria-describedby="t-text-count" />
          <span id="t-text-count" className={`mt-1 block text-caption tabular-nums ${tooLong ? 'text-warn' : 'text-muted'}`}>{t('tCount', { n: sentences.length, max: MAX_SENTENCES, chars: text.trim().length, maxChars: MAX_TEXT_CHARS })}</span>
        </label>
        {sentences.length > 0 && (
          <div className="panel">
            <p className="mb-2 text-sm font-medium text-muted">{t('tPreviewTitle')}</p>
            <ol className="space-y-1.5 font-serif text-[0.95rem]" data-testid="t-preview">
              {sentences.map((s) => <li key={s.id} className="flex gap-2.5"><span className="mt-0.5 w-6 shrink-0 font-sans text-xs font-semibold tabular-nums text-brand-ink">{s.id}</span><span className="wrap-any">{s.text}</span></li>)}
            </ol>
          </div>
        )}
        <div className="flex items-start gap-2 text-sm" data-testid="t-health">
          {!health ? <Spinner className="mt-0.5 h-4 w-4 text-muted" /> : ollamaOk ? <Icon name="check" className="h-5 w-5 text-ok" /> : <Icon name="alert" className="h-5 w-5 text-warn" />}
          {!health ? <span className="text-muted">{t('tChecking')}</span> : 'error' in health ? <span className="text-bad">{health.error}</span>
            : health.ollama.ok ? <span className="text-ok">{t('tReady', { model: health.ollama.model })}</span>
            : <span className="text-warn">{health.ollama.reason}. {t('tStart')} <code className="rounded-chip bg-sunken px-1.5 py-0.5 text-ink">{health.startCommand}</code></span>}
        </div>
        <p className="text-sm text-muted">{t('tGenerateLead')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={loadingDraft || busy || !hasEnoughReadingText(sentences) || tooLong} onClick={() => void generate()} data-testid="t-generate">{busy && <Spinner />}{busy ? t('tGenerating') : t('tGenerate')}</button>
          {busy && <button className="btn-ghost" onClick={() => abortRef.current?.abort()} data-testid="t-cancel"><Icon name="x" className="h-4 w-4" />{t('tCancel')}</button>}
          {!busy && <button className="btn-ghost" disabled={loadingDraft || sentences.length < 2} onClick={manualDraft}>{t('tManual')}</button>}
        </div>
        {busy && (
          <p className="flex items-center gap-2 rounded-control bg-sunken px-3 py-2 text-sm text-muted" role="status" data-testid="t-elapsed">
            <Icon name="clock" className="h-4 w-4" /><span className="tabular-nums">{t('tElapsed', { time: mmss(elapsed), limit: mmss(limitSec) })}</span>
          </p>
        )}
        {!ollamaOk && !busy && <p className="text-caption text-muted">{t('tNoModel')}</p>}
        {tooLong && <p className="note note-warn" role="status" data-testid="t-too-long"><Icon name="alert" className="mt-px h-5 w-5" /><span>{t('tTooLong', { chars: MAX_TEXT_CHARS, n: MAX_SENTENCES })}</span></p>}
        {genMsg && (
          <div role="alert" data-testid={`t-msg-${genMsg.kind}`} className={`note ${genMsg.kind === 'cancelled' ? 'note-info' : 'note-bad'}`}>
            <Icon name={genMsg.kind === 'cancelled' ? 'info' : 'alert'} className="mt-px h-5 w-5" />
            <span>
              {genMsg.kind === 'cancelled' && t('tCancelled')}
              {genMsg.kind === 'timeout' && t('tTimeout', { sec: genMsg.sec })}
              {genMsg.kind === 'unavailable' && t('tUnavailable', { reason: genMsg.reason, command: genMsg.command })}
              {genMsg.kind === 'server-down' && t('tServerDown', { reason: genMsg.reason })}
              {genMsg.kind === 'input' && t('tInputRejected', { errors: genMsg.errors.join('; ') })}
            </span>
          </div>
        )}
        {structErrors.length > 0 && (
          <div role="alert" className="note note-bad" data-testid="t-struct-error">
            <Icon name="alert" className="mt-px h-5 w-5" />
            <div className="min-w-0">
              <b>{t('tStructTitle')}</b> {draft ? t('tStructKept') : ''} {t('tStructRetry')}
              <ul className="mt-1 list-disc pl-5">{structErrors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          </div>
        )}
        {pendingGeneration && (
          <div className="note note-warn flex-col items-stretch">
            <p role="status" className="flex items-start gap-2.5"><Icon name="info" className="mt-px h-5 w-5" /><span>{t('tPendingGeneration')}</span></p>
            <button type="button" className="btn-ghost self-start" disabled={busy} data-testid="t-open-generated"
              onClick={() => openGeneration(pendingGeneration)}>{t('tOpenGenerated')}</button>
          </div>
        )}
      </section>

      <section id="t-step-2" className="card scroll-mt-4 space-y-5 p-5 sm:p-7" aria-labelledby="t-step-2-title" data-testid={draft ? 't-draft' : undefined}>
        <StepTitle n={2} id="t-step-2-title">{t('tDraftTitle')}</StepTitle>
        <p className="note note-info" data-testid="t-autocheck"><Icon name="info" className="mt-px h-5 w-5 text-brand-ink" /><span>{t('tAutoCheck')}</span></p>
        {!draft ? (
          <div className="rounded-control border border-dashed border-line-strong/60 p-5 text-sm text-muted">
            <p>{t('tStep2Empty')}</p>
            <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => go(1)}><Icon name="arrow-up" className="h-4 w-4" />{t('tGoStep1')}</button>
          </div>
        ) : (
          <>
            {liveServerErrors.length > 0 && <div className="note note-warn" role="alert"><Icon name="alert" className="mt-px h-5 w-5" /><div className="min-w-0"><b>{t('tRefErrors')}</b><ul className="mt-1 list-disc pl-5">{liveServerErrors.map((e) => <li key={e}>{e}</li>)}</ul></div></div>}
            {issues.length > 0 && (
              <div className="note note-warn" role="alert" data-testid="t-quality">
                <Icon name="alert" className="mt-px h-5 w-5" />
                <div className="min-w-0">
                  <b>{t('tQualityTitle')}</b>
                  <ul className="mt-1 list-disc pl-5">{issues.map((q, k) => <li key={k}>{qualityIssueText(lang, q)}</li>)}</ul>
                </div>
              </div>
            )}
            <AiReviewBar ai={ai} lesson={validation?.ok ? validation.lesson : null} canRun={!!ollamaOk && !busy} />
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="field-label">{t('tTitle')}</span>
                <input className="input w-full font-serif text-lg font-semibold" aria-label={t('tTitle')} value={draft.title} onChange={(e) => updateDraft({ ...draft, title: e.target.value })} />
              </label>
              <span className="badge mb-2.5" data-testid="t-draft-grade">{t('grade', { g: draft.grade })}</span>
            </div>
            {draft.tasks.map((task, i) => {
              const taskIssues = issues.filter((q) => q.taskIndex === i);
              const taskWarnings = warnings.filter((w) => w.taskIndex === i);
              const taskErrors = allErrors.filter((e) => taskOf(e) === i);
              const duplicateTask = draft.tasks.slice(0, i).some((item) => item.id === task.id);
              const duplicateOptions = new Set(task.options.map((option) => option.id)).size < task.options.length;
              const flagged = taskIssues.length > 0 || taskErrors.length > 0;
              return (
                <fieldset key={`${rev}-${i}`} data-testid={`t-task-${i}`} data-issue={taskIssues.length > 0}
                  className={`min-w-0 space-y-4 rounded-card border p-4 sm:p-5 ${flagged ? 'border-warn bg-warn-soft/30' : 'border-line-strong/40'}`}>
                  <legend className="flex items-center gap-2 px-1.5 font-serif text-subheading font-semibold">
                    {t('tTaskN', { n: i + 1 })}
                    {flagged && <span className="badge border-warn/50 bg-warn-soft font-sans text-warn"><Icon name="alert" className="h-3.5 w-3.5" />{t('tNeedsFix')}</span>}
                  </legend>
                  {flagged && (
                    <div className="note note-warn" role="alert">
                      <Icon name="alert" className="mt-px h-5 w-5" />
                      <div className="min-w-0">
                        <b>{t('tFixHere')}</b>
                        {taskIssues.length > 0 && <ul className="mt-1 list-disc pl-5" data-testid={`t-task-issue-${i}`}>{taskIssues.map((q, k) => <li key={k}>{qualityIssueText(lang, q)}</li>)}</ul>}
                        {taskErrors.length > 0 && <ul className="mt-1 list-disc pl-5" data-testid={`t-task-err-${i}`}>{taskErrors.map((e) => <li key={e}>{errText(e)}</li>)}</ul>}
                      </div>
                    </div>
                  )}
                  {(duplicateTask || duplicateOptions) && (
                    <button type="button" className="btn-ghost" data-testid={`t-fix-ids-${i}`}
                      onClick={() => repairIds(i, task, duplicateTask, duplicateOptions)}>{t('tRepairIds')}</button>
                  )}
                  <AiTaskNote ai={ai} lesson={validation?.ok ? validation.lesson : null} task={task} index={i}
                    onReplace={(fixed) => { updTask(i, fixed); setRev((r) => r + 1); }} />
                  {taskWarnings.length > 0 && (
                    <p className="note border border-warn/40 text-warn" data-testid={`t-task-warn-${i}`}>
                      <Icon name="bulb" className="mt-px h-5 w-5" /><span>{taskWarnings.map((w) => qualityWarningText(lang, w)).join(' ')}</span>
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                    <label className="min-w-0">
                      <span className="field-label">{t('tSkillLabel')}</span>
                      <select className="input w-full" value={task.skill} onChange={(e) => updTask(i, { skill: e.target.value as Skill })}>
                        <option value="find">{t('tSkillFind')}</option><option value="match">{t('tSkillMatch')}</option><option value="infer">{t('tSkillInfer')}</option>
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="field-label">{t('tQuestion')}</span>
                      <input className="input w-full" placeholder={t('tQuestionPh')} aria-label={t('tQuestion')} value={task.question} onChange={(e) => updTask(i, { question: e.target.value })} />
                    </label>
                  </div>
                  <fieldset className="min-w-0 space-y-2">
                    <legend className="field-label">{t('tOptions')}</legend>
                    {task.options.map((o, k) => (
                      <div key={k} className={`flex items-center gap-2 rounded-control border p-1.5 pl-3 ${task.correctOptionId === o.id ? 'border-ok/60 bg-ok-soft/60' : 'border-transparent'}`}>
                        <input type="radio" className="h-4 w-4 shrink-0 accent-[rgb(var(--ok))]" name={`correct-${rev}-${i}`} checked={task.correctOptionId === o.id} onChange={() => updTask(i, { correctOptionId: o.id })} title={t('tCorrect')} aria-label={`${t('tCorrect')}: ${o.id}`} />
                        <span className="w-4 text-center text-sm font-semibold text-muted" aria-hidden="true">{o.id}</span>
                        <input className="input min-w-0 flex-1" aria-label={t('tOption', { id: o.id })} value={o.text} onChange={(e) => updTask(i, { options: task.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
                        {task.correctOptionId === o.id && <span className="hidden whitespace-nowrap pr-1 text-caption font-semibold text-ok sm:inline-flex sm:items-center sm:gap-1"><Icon name="check" className="h-3.5 w-3.5" />{t('tCorrectShort')}</span>}
                      </div>
                    ))}
                  </fieldset>
                  <EvidenceEditor index={i} sentences={draft.sentences} sets={task.evidenceSets} onChange={(evidenceSets) => updTask(i, { evidenceSets })} />
                  <label className="block">
                    <span className="field-label">{t('tHint')}</span>
                    <input className="input w-full" placeholder={t('tHintPh')} aria-label={t('tHint')} value={task.hint} onChange={(e) => updTask(i, { hint: e.target.value })} />
                  </label>
                  {subjectOf(draft) === 'math' && <MathFields index={i} task={task} onChange={(patch) => updTask(i, patch)} />}
                  {draft.tasks.length > 1 && (
                    <button type="button" className="btn-ghost btn-sm btn-danger" data-testid={`t-remove-task-${i}`}
                      onClick={() => loadDraft({ ...draft, tasks: draft.tasks.filter((_, index) => index !== i) })}><Icon name="trash" className="h-4 w-4" />{t('tRemoveTask')}</button>
                  )}
                </fieldset>
              );
            })}
            {missingSkill && draft.tasks.length < 3 && (
              <button type="button" className="btn-ghost" data-testid="t-add-task" onClick={addMissingTask}><Icon name="plus" className="h-4 w-4" />{t('tAddTask')}</button>
            )}
          </>
        )}
      </section>

      <section id="t-step-3" className="card scroll-mt-4 space-y-5 p-5 sm:p-7" aria-labelledby="t-step-3-title">
        <StepTitle n={3} id="t-step-3-title">{t('tStep3')}</StepTitle>
        <p className="text-sm text-muted">{draft && !canSave ? t('tSaveBlocked') : t('tSaveLead')}</p>
        {allErrors.length > 0 && (
          <div className="note note-bad">
            <Icon name="alert" className="mt-px h-5 w-5" />
            <div className="min-w-0">
              <b>{t('tErrorsTitle')}</b>
              <ul className="mt-1 list-disc pl-5" data-testid="t-errors">
                {allErrors.map((e) => { const n = taskOf(e); return <li key={e}>{n === null ? e : `${t('tTaskN', { n: n + 1 })}: ${errText(e)} (${e.split(': ')[0]})`}</li>; })}
              </ul>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={!canSave || saving} onClick={() => void save()} data-testid="t-save">{saving && <Spinner />}{t('tSave')}</button>
          <button className="btn-ghost" disabled={!canSave} onClick={exportJson} data-testid="t-export"><Icon name="download" className="h-4 w-4" />{t('tExport')}</button>
          {draft && <button className="btn-ghost btn-danger sm:ml-auto" disabled={saving} onClick={() => updateDraft(null)}><Icon name="trash" className="h-4 w-4" />{t('tDelete')}</button>}
        </div>
        {saveStatus?.draft === draft && saveStatus.kind === 'error' && <p className="note note-bad" role="alert" data-testid="t-save-error"><Icon name="alert" className="mt-px h-5 w-5" /><span>{t('tSaveError')}</span></p>}
        {saveStatus?.draft === draft && saveStatus.kind === 'saved' && <p className="note note-ok" role="status" data-testid="t-saved">
          <Icon name="check" className="mt-px h-5 w-5" /><span>{saveStatus.lesson.id === draft.id ? t('tSaved') : t('tSavedVersion', { title: saveStatus.lesson.title })}</span>
        </p>}
      </section>
    </div>
  );
}

function StepTitle({ n, id, children }: { n: number; id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-3 font-serif text-heading font-semibold">
      <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink font-sans text-base text-paper">{n}</span>
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
    <div className="space-y-3 rounded-control bg-sunken p-3 sm:p-4" data-testid={`t-ev-${index}`}>
      <div className="flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className="inline-block h-4 w-6 rounded-[3px] bg-marker" />{t('tEvidence')}</div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('tEvidence')}>
        {safeSets.map((s, k) => (
          <span key={k} className="inline-flex items-center">
            <button type="button" role="tab" aria-selected={k === cur} data-testid={`t-ev-${index}-set-${k}`} onClick={() => setActive(k)}
              className={`min-h-9 border px-3 py-1 text-xs tabular-nums ${safeSets.length > 1 ? 'rounded-l-chip' : 'rounded-chip'} ${k === cur ? 'border-ink bg-ink font-semibold text-paper' : 'border-line-strong/60 bg-card text-ink hover:bg-brand-soft'}`}>
              {t('tSet', { n: k + 1 })}: {s.join(', ') || '—'}
            </button>
            {safeSets.length > 1 && (
              <button type="button" aria-label={t('tRemoveSet', { n: k + 1 })} data-testid={`t-ev-${index}-del-${k}`}
                onClick={() => { onChange(safeSets.filter((_, j) => j !== k)); setActive(0); }}
                className="inline-flex min-h-9 items-center rounded-r-chip border border-l-0 border-line-strong/60 bg-card px-2 text-ink hover:bg-bad-soft hover:text-bad"><Icon name="x" className="h-3.5 w-3.5" /></button>
            )}
          </span>
        ))}
        <button type="button" className="min-h-9 rounded-chip border border-dashed border-brand-ink/60 px-3 py-1 text-xs font-medium text-brand-ink hover:bg-brand-soft" data-testid={`t-ev-${index}-add`}
          onClick={() => { onChange([...safeSets.filter((s) => s.length), []]); setActive(safeSets.filter((s) => s.length).length); }}>{t('tAddSet')}</button>
      </div>
      <div className="space-y-1 font-serif">
        {sentences.map((s) => {
          const on = (safeSets[cur] ?? []).includes(s.id);
          return (
            <button key={s.id} type="button" aria-pressed={on} data-testid={`t-ev-${index}-${s.id}`} onClick={() => toggle(s.id)}
              className={`flex w-full items-start gap-2.5 rounded-chip px-2 py-1.5 text-left text-[0.95rem] transition-colors duration-150 ${on ? 'bg-marker text-marker-ink underline decoration-marker-ink/50 decoration-2 underline-offset-4' : 'hover:bg-marker/40 active:bg-marker/70'}`}>
              <span className={`mt-0.5 inline-flex h-5 min-w-9 shrink-0 items-center justify-center gap-0.5 rounded-full px-1 font-sans text-[0.6875rem] font-semibold no-underline tabular-nums ${on ? 'bg-ink text-paper' : 'border border-line-strong/60 text-muted'}`}>{on && <Icon name="check" className="h-3 w-3" />}{s.id}</span>
              <span className="wrap-any">{s.text}</span>
            </button>
          );
        })}
      </div>
      <details className="text-xs">
        <summary className="inline-flex min-h-8 cursor-pointer items-center text-muted">{t('tEvidenceText')}</summary>
        <input className="input mt-1 w-full font-mono text-sm" data-testid={`t-evidence-${index}`} value={text} aria-label={t('tEvidenceText')}
          onChange={(e) => { setText(e.target.value); onChange(parseEvidence(e.target.value)); }} />
      </details>
    </div>
  );
}

/** Математика: объяснение расчёта и формула, которую проверяет код (результат — сразу под полем). */
function MathFields({ index, task, onChange }: { index: number; task: Task; onChange: (patch: Partial<Task>) => void }) {
  const { t } = useI18n();
  const calc: Calc = task.calc ?? { kind: 'value', expr: '', unit: '' };
  const check = calc.kind === 'value' && !calc.expr.trim() ? null : checkCalc({ ...task, calc });
  const setCalc = (next: Calc) => onChange({ calc: next });
  return (
    <div className="space-y-3 rounded-control border border-line-strong/50 bg-sunken p-3" data-testid={`t-math-${index}`}>
      <label className="block">
        <span className="field-label">{t('tSolution')}</span>
        <textarea className="input w-full" rows={2} placeholder={t('tSolutionPh')} value={task.solution ?? ''} data-testid={`t-solution-${index}`}
          onChange={(e) => onChange({ solution: e.target.value })} />
      </label>
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_6rem]">
        <label>
          <span className="field-label">{t('tCalcKind')}</span>
          <select className="input w-full" value={calc.kind === 'value' ? 'value' : calc.pick} data-testid={`t-calc-kind-${index}`}
            onChange={(e) => setCalc(e.target.value === 'value'
              ? { kind: 'value', expr: '', unit: calc.unit }
              : { kind: 'choose', pick: e.target.value === 'max' ? 'max' : 'min', values: calc.kind === 'choose' ? calc.values : {}, unit: calc.unit })}>
            <option value="value">{t('tCalcValue')}</option><option value="min">{t('tCalcMin')}</option><option value="max">{t('tCalcMax')}</option>
          </select>
        </label>
        {calc.kind === 'value' ? (
          <label className="min-w-0">
            <span className="field-label">{t('tCalcExpr')}</span>
            <input className="input w-full font-mono" placeholder="35000-18000-24*600" value={calc.expr} data-testid={`t-calc-expr-${index}`}
              onChange={(e) => setCalc({ ...calc, expr: e.target.value })} />
          </label>
        ) : (
          <div className="min-w-0 space-y-1">
            <span className="field-label">{t('tCalcPerOption')}</span>
            {task.options.map((o) => (
              <label key={o.id} className="flex items-center gap-2">
                <span className="w-4 text-sm font-semibold text-muted">{o.id}</span>
                <input className="input min-w-0 flex-1 font-mono" value={calc.values[o.id] ?? ''} data-testid={`t-calc-opt-${index}-${o.id}`}
                  onChange={(e) => { const values = { ...calc.values }; if (e.target.value.trim()) values[o.id] = e.target.value; else delete values[o.id]; setCalc({ ...calc, values }); }} />
              </label>
            ))}
          </div>
        )}
        <label>
          <span className="field-label">{t('tCalcUnit')}</span>
          <input className="input w-full" placeholder="₸" value={calc.unit} data-testid={`t-calc-unit-${index}`} onChange={(e) => setCalc({ ...calc, unit: e.target.value })} />
        </label>
      </div>
      {check && (
        <p className={`note ${check.ok ? 'note-ok' : 'note-bad'}`} role="status" data-testid={`t-calc-check-${index}`} data-ok={check.ok}>
          <Icon name={check.ok ? 'check' : 'alert'} className="mt-px h-5 w-5" />
          <span>{check.ok ? t('tCalcOk', { value: check.value === null ? '—' : String(Math.round(check.value * 100) / 100), unit: calc.unit }) : t('tCalcBad')}</span>
        </p>
      )}
    </div>
  );
}
