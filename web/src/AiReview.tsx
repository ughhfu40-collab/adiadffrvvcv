import { useEffect, useRef, useState } from 'react';
import type { Lesson, Task } from '../../shared/lesson';
import { isEditableDraft } from '../../shared/lesson';
import { API_URL } from './api';
import { useI18n } from './i18n';
import { Icon, Spinner } from './Icon';

/** Ответ /api/review для одного задания (см. server/review.ts). */
export interface TaskReview {
  taskId: string;
  answerFromText: boolean;
  onlyOneCorrect: boolean;
  evidenceOk: boolean;
  languageOk: boolean;
  problems: string[];
  ok: boolean;
}

type Entry = { review: TaskReview; snapshot: string; repaired?: boolean };
type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done' } | { kind: 'error'; reason: string };

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const snap = (t: Task) => JSON.stringify(t);

async function postJson(path: string, body: unknown, signal: AbortSignal): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await r.json().catch(() => null);
  return { status: r.status, data: data && typeof data === 'object' ? (data as Record<string, unknown>) : null };
}

const reasonOf = (d: Record<string, unknown> | null, status: number) =>
  typeof d?.reason === 'string' ? d.reason : Array.isArray(d?.errors) ? (d.errors as string[]).join('; ') : `HTTP ${status}`;

/**
 * Вторая проверка ИИ: после генерации модель перечитывает каждое задание по тексту.
 * Замечания показываются рядом с заданием и не блокируют сохранение — решение за учителем.
 */
export function useAiReview() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [byTask, setByTask] = useState<Record<string, Entry>>({});
  const [elapsed, setElapsed] = useState(0);
  const [repairing, setRepairing] = useState<string | null>(null);
  const [repairMsg, setRepairMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    if (status.kind !== 'running' && !repairing) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [status.kind, repairing]);

  async function run(lesson: Lesson, repairedId?: string) {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setStatus({ kind: 'running' });
    if (!repairedId) setRepairMsg({});
    try {
      const { status: code, data } = await postJson('/api/review', { lesson }, c.signal);
      if (!data?.ok || !Array.isArray(data.review)) { setStatus({ kind: 'error', reason: reasonOf(data, code) }); return; }
      const next: Record<string, Entry> = {};
      for (const r of data.review as TaskReview[]) {
        const task = lesson.tasks.find((t) => t.id === r.taskId);
        if (task) next[r.taskId] = { review: r, snapshot: snap(task), repaired: r.taskId === repairedId };
      }
      setByTask(next);
      setStatus({ kind: 'done' });
    } catch (e) {
      setStatus(c.signal.aborted ? { kind: 'idle' } : { kind: 'error', reason: (e as Error).message });
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
  }

  function cancel() { ctrl.current?.abort(); }
  function reset() { ctrl.current?.abort(); setByTask({}); setStatus({ kind: 'idle' }); setRepairMsg({}); }

  /** Исправление одного задания. Возвращает новое задание только если оно прошло серверную проверку. */
  async function repair(lesson: Lesson, taskId: string): Promise<Task | null> {
    const entry = byTask[taskId];
    if (!entry || repairing) return null;
    const c = new AbortController();
    ctrl.current = c;
    setRepairing(taskId);
    try {
      const { status: code, data } = await postJson('/api/repair', { lesson, taskId, problems: entry.review.problems }, c.signal);
      const task = data?.ok ? (data.task as Task) : null;
      if (!task) { setRepairMsg((m) => ({ ...m, [taskId]: { ok: false, text: reasonOf(data, code) } })); return null; }
      // Проверяем, что задание вставится в урок без ошибок, и помечаем его как исправленное ИИ.
      const next = { ...lesson, tasks: lesson.tasks.map((t) => (t.id === taskId ? task : t)) };
      if (!isEditableDraft(next)) { setRepairMsg((m) => ({ ...m, [taskId]: { ok: false, text: 'structure' } })); return null; }
      setByTask((b) => ({ ...b, [taskId]: { ...entry, snapshot: snap(task), repaired: true } }));
      setRepairMsg((m) => ({ ...m, [taskId]: { ok: true, text: '' } }));
      return task;
    } catch (e) {
      if (!c.signal.aborted) setRepairMsg((m) => ({ ...m, [taskId]: { ok: false, text: (e as Error).message } }));
      return null;
    } finally {
      setRepairing(null);
      if (ctrl.current === c) ctrl.current = null;
    }
  }

  return { status, byTask, elapsed, repairing, repairMsg, run, cancel, reset, repair };
}

export type AiReviewState = ReturnType<typeof useAiReview>;

/** Панель над заданиями: запуск, ход и итог проверки ИИ. */
export function AiReviewBar({ ai, lesson, canRun }: { ai: AiReviewState; lesson: Lesson | null; canRun: boolean }) {
  const { t } = useI18n();
  const flagged = Object.values(ai.byTask).filter((e) => !e.review.ok).length;
  return (
    <div className="rounded-control border border-line-strong/50 bg-card p-4 text-sm" data-testid="t-ai-bar" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-chip bg-brand-soft text-brand-ink" aria-hidden="true"><Icon name="search" className="h-[1.125rem] w-[1.125rem]" /></span>
        <b className="mr-auto text-base">{t('aiTitle')}</b>
        {ai.status.kind === 'running'
          ? <>
              <span className="inline-flex items-center gap-2 tabular-nums text-muted" data-testid="t-ai-running"><Spinner />{t('aiRunning', { time: mmss(ai.elapsed) })}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={ai.cancel} data-testid="t-ai-cancel"><Icon name="x" className="h-4 w-4" />{t('tCancel')}</button>
            </>
          : <button type="button" className="btn-ghost btn-sm" disabled={!canRun || !lesson} onClick={() => lesson && void ai.run(lesson)} data-testid="t-ai-run">
              {ai.status.kind === 'done' ? t('aiRerun') : t('aiRun')}
            </button>}
      </div>
      {ai.status.kind === 'done' && (
        <p className={`note mt-3 ${flagged ? 'note-warn' : 'note-ok'}`} data-testid="t-ai-summary">
          <Icon name={flagged ? 'alert' : 'check'} className="mt-px h-5 w-5" /><span>{flagged ? t('aiSummaryFlagged', { n: flagged }) : t('aiSummaryClean')}</span>
        </p>
      )}
      {ai.status.kind === 'error' && <p className="note note-bad mt-3" role="alert" data-testid="t-ai-error"><Icon name="alert" className="mt-px h-5 w-5" /><span>{t('aiError', { reason: ai.status.reason })}</span></p>}
      <p className="mt-3 text-caption text-muted">{t('aiNote')}</p>
    </div>
  );
}

/** Замечание ИИ рядом с заданием и кнопка «Попросить ИИ исправить». */
export function AiTaskNote({ ai, lesson, task, index, onReplace }: { ai: AiReviewState; lesson: Lesson | null; task: Task; index: number; onReplace: (task: Task) => void }) {
  const { t } = useI18n();
  const entry = ai.byTask[task.id];
  if (!entry) return null;
  const stale = entry.snapshot !== snap(task);
  const msg = ai.repairMsg[task.id];
  const r = entry.review;
  const checks: [string, boolean][] = [[t('aiCheckAnswer'), r.answerFromText], [t('aiCheckOne'), r.onlyOneCorrect], [t('aiCheckEvidence'), r.evidenceOk], [t('aiCheckLanguage'), r.languageOk]];
  return (
    <div className={`rounded-control p-3 text-sm ${r.ok && !entry.repaired ? 'bg-ok-soft text-ok' : 'border border-warn/50 bg-warn-soft/60 text-ink'}`} data-testid={`t-ai-${index}`} data-ok={r.ok} data-stale={stale}>
      {entry.repaired && <p className="mb-2 flex items-start gap-2" data-testid={`t-ai-fixed-${index}`}><Icon name="pencil" className="mt-px h-4 w-4" /><b>{t(r.ok ? 'aiFixedClean' : 'aiFixedStill')}</b></p>}
      {r.ok ? <p className="flex items-center gap-2"><Icon name="check" className="h-4 w-4" />{t('aiOk')}</p>
        : <>
            <p className="flex items-center gap-2 text-warn"><Icon name="alert" className="h-4 w-4" /><b>{t('aiProblems')}</b></p>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-caption">
              {checks.map(([label, ok]) => (
                <li key={label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${ok ? 'border-ok/40 text-ok' : 'border-bad/50 bg-bad-soft text-bad'}`}>
                  <Icon name={ok ? 'check' : 'x'} className="h-3.5 w-3.5" />{label}
                </li>
              ))}
            </ul>
            {r.problems.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5" data-testid={`t-ai-problems-${index}`}>{r.problems.map((p, k) => <li key={k}>{p}</li>)}</ul>}
            <button type="button" className="btn-ghost btn-sm mt-3" disabled={!!ai.repairing || !lesson}
              onClick={async () => {
                if (!lesson) return;
                const fixed = await ai.repair(lesson, task.id);
                if (!fixed) return;
                onReplace(fixed);
                // Исправление ИИ тоже может ошибаться — сразу перепроверяем урок, учитель видит новый вердикт.
                void ai.run({ ...lesson, tasks: lesson.tasks.map((x) => (x.id === task.id ? fixed : x)) }, task.id);
              }}
              data-testid={`t-ai-fix-${index}`}>
              {ai.repairing === task.id ? <><Spinner /><span className="tabular-nums">{t('aiFixing', { time: mmss(ai.elapsed) })}</span></> : <><Icon name="pencil" className="h-4 w-4" />{t('aiFix')}</>}
            </button>
          </>}
      {stale && <p className="mt-2 flex items-center gap-1.5 text-caption text-muted" data-testid={`t-ai-stale-${index}`}><Icon name="info" className="h-3.5 w-3.5" />{t('aiStale')}</p>}
      {msg && !msg.ok && <p className="note note-bad mt-2" role="alert" data-testid={`t-ai-fix-error-${index}`}><Icon name="alert" className="mt-px h-4 w-4" /><span>{t('aiFixFailed', { errors: msg.text })}</span></p>}
    </div>
  );
}
