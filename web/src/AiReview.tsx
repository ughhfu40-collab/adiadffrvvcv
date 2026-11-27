import { useEffect, useRef, useState } from 'react';
import type { Lesson, Task } from '../../shared/lesson';
import { isEditableDraft } from '../../shared/lesson';
import { API_URL } from './api';
import { useI18n } from './i18n';

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
    <div className="rounded-xl border border-line p-3 text-sm" data-testid="t-ai-bar" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <b>{t('aiTitle')}</b>
        {ai.status.kind === 'running'
          ? <>
              <span data-testid="t-ai-running">{t('aiRunning', { time: mmss(ai.elapsed) })}</span>
              <button type="button" className="btn-ghost" onClick={ai.cancel} data-testid="t-ai-cancel">{t('tCancel')}</button>
            </>
          : <button type="button" className="btn-ghost" disabled={!canRun || !lesson} onClick={() => lesson && void ai.run(lesson)} data-testid="t-ai-run">
              {ai.status.kind === 'done' ? t('aiRerun') : t('aiRun')}
            </button>}
      </div>
      {ai.status.kind === 'done' && (
        <p className="mt-2" data-testid="t-ai-summary">{flagged ? t('aiSummaryFlagged', { n: flagged }) : t('aiSummaryClean')}</p>
      )}
      {ai.status.kind === 'error' && <p className="mt-2 text-bad" role="alert" data-testid="t-ai-error">{t('aiError', { reason: ai.status.reason })}</p>}
      <p className="mt-2 text-xs text-muted">{t('aiNote')}</p>
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
    <div className={`rounded-xl p-3 text-sm ${r.ok && !entry.repaired ? 'bg-ok-soft text-ok' : 'border border-warn/40 bg-warn-soft/50'}`} data-testid={`t-ai-${index}`} data-ok={r.ok} data-stale={stale}>
      {entry.repaired && <p data-testid={`t-ai-fixed-${index}`}><b>✎ {t(r.ok ? 'aiFixedClean' : 'aiFixedStill')}</b></p>}
      {r.ok ? <p>✓ {t('aiOk')}</p>
        : <>
            <p><b>{t('aiProblems')}</b></p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {checks.map(([label, ok]) => <li key={label}>{ok ? '✓' : '✗'} {label}</li>)}
            </ul>
            {r.problems.length > 0 && <ul className="mt-2 list-disc pl-5" data-testid={`t-ai-problems-${index}`}>{r.problems.map((p, k) => <li key={k}>{p}</li>)}</ul>}
            <button type="button" className="btn-ghost mt-2" disabled={!!ai.repairing || !lesson}
              onClick={async () => {
                if (!lesson) return;
                const fixed = await ai.repair(lesson, task.id);
                if (!fixed) return;
                onReplace(fixed);
                // Исправление ИИ тоже может ошибаться — сразу перепроверяем урок, учитель видит новый вердикт.
                void ai.run({ ...lesson, tasks: lesson.tasks.map((x) => (x.id === task.id ? fixed : x)) }, task.id);
              }}
              data-testid={`t-ai-fix-${index}`}>
              {ai.repairing === task.id ? t('aiFixing', { time: mmss(ai.elapsed) }) : t('aiFix')}
            </button>
          </>}
      {stale && <p className="mt-2 text-xs text-muted" data-testid={`t-ai-stale-${index}`}>{t('aiStale')}</p>}
      {msg && !msg.ok && <p className="mt-2 text-bad" role="alert" data-testid={`t-ai-fix-error-${index}`}>{t('aiFixFailed', { errors: msg.text })}</p>}
    </div>
  );
}
