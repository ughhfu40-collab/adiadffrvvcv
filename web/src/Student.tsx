import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkAnswer, feedbackText, parseLessonJson, recommendNext, SKILL_LABELS, type CheckResult, type Lesson, type Skill, type Task } from '../../shared/lesson';
import { db, skillProgress, solvedKeys } from './db';

type Play = { lesson: Lesson; taskIds: string[] };

export function Student() {
  const rows = useLiveQuery(() => db.lessons.toArray(), []) ?? [];
  const progress = useLiveQuery(() => skillProgress(), []);
  const solved = useLiveQuery(() => solvedKeys(), []) ?? new Set<string>();
  const [play, setPlay] = useState<Play | null>(null);

  if (play) return <Player key={play.lesson.id + play.taskIds.join()} play={play} all={rows.map((r) => r.lesson)} onExit={() => setPlay(null)} onPlay={setPlay} />;

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="h2">Прогресс по навыкам</h2>
        <div className="grid gap-3 sm:grid-cols-3" data-testid="progress">
          {(['find', 'match', 'infer'] as Skill[]).map((s) => (
            <div key={s} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800" data-testid={`progress-${s}`}>
              <div className="text-sm text-slate-500 dark:text-slate-400">{SKILL_LABELS.ru[s]}</div>
              <div className="text-2xl font-semibold">{progress?.[s].solved ?? 0}<span className="text-base font-normal text-slate-500"> решено</span></div>
              <div className="text-xs text-slate-500">ошибок: {progress?.[s].errors ?? 0} · попыток: {progress?.[s].attempts ?? 0}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="h2">Уроки</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map(({ lesson, source }) => {
            const done = lesson.tasks.filter((t) => solved.has(`${lesson.id}/${t.id}`)).length;
            return (
              <li key={lesson.id}>
                <button className="card w-full text-left hover:ring-2 hover:ring-indigo-400" data-testid={`lesson-${lesson.id}`} onClick={() => setPlay({ lesson, taskIds: lesson.tasks.map((t) => t.id) })}>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    <span className="badge">{lesson.language === 'kk' ? 'Қазақша' : 'Русский'}</span>
                    <span>{lesson.grade} класс</span>
                    {source !== 'builtin' && <span className="badge">импорт</span>}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{lesson.title}</div>
                  <div className="text-sm text-slate-500">Выполнено {done} из {lesson.tasks.length}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <ImportBox />
    </div>
  );
}

function ImportBox() {
  const [errors, setErrors] = useState<string[]>([]);
  const [okMsg, setOk] = useState('');
  async function handle(raw: string) {
    setOk('');
    const r = parseLessonJson(raw);
    if (!r.ok) return setErrors(r.errors);
    setErrors([]);
    await db.lessons.put({ id: r.lesson.id, lesson: r.lesson, source: 'imported', addedAt: Date.now() });
    setOk(`Урок «${r.lesson.title}» импортирован`);
  }
  return (
    <section className="card">
      <h2 className="h2">Импорт урока (JSON)</h2>
      <input type="file" accept="application/json,.json" data-testid="import-file" className="block text-sm"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handle(await f.text()); e.target.value = ''; }} />
      {okMsg && <p className="mt-2 text-emerald-700 dark:text-emerald-400" data-testid="import-ok">{okMsg}</p>}
      {errors.length > 0 && (
        <div className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200" data-testid="import-errors" role="alert">
          <b>Урок не импортирован:</b>
          <ul className="list-disc pl-5">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function Player({ play, all, onExit, onPlay }: { play: Play; all: Lesson[]; onExit: () => void; onPlay: (p: Play) => void }) {
  const { lesson } = play;
  const tasks = useMemo(() => play.taskIds.map((id) => lesson.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t), [play, lesson]);
  const [idx, setIdx] = useState(0);
  const [option, setOption] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [finished, setFinished] = useState(false);
  const [rec, setRec] = useState<ReturnType<typeof recommendNext>>(null);
  const task = tasks[idx];
  const lang = lesson.language;
  const t = lang === 'kk'
    ? { check: 'Тексеру', next: 'Келесі', retry: 'Қайта көру', hint: 'Кеңес', evidence: 'Дәлел сөйлемдерді басып белгілеңіз', done: 'Сабақ аяқталды!', more: 'Тағы бір тапсырма', back: 'Сабақтарға' }
    : { check: 'Проверить', next: 'Дальше', retry: 'Попробовать ещё', hint: 'Подсказка', evidence: 'Нажмите на предложения-доказательства', done: 'Урок пройден!', more: 'Ещё одно задание', back: 'К урокам' };

  useEffect(() => {
    if (!finished) return;
    void (async () => {
      const attempts = await db.attempts.where('lessonId').equals(lesson.id).toArray();
      setRec(recommendNext(all, lesson, attempts, await solvedKeys()));
    })();
  }, [finished, all, lesson]);

  async function check() {
    if (!task) return;
    const r = checkAnswer(task, option, evidence);
    setResult(r);
    await db.attempts.add({ lessonId: lesson.id, taskId: task.id, skill: task.skill, optionId: option, evidence, answerCorrect: r.answerCorrect, evidenceOk: r.evidence === 'correct', solved: r.solved, at: Date.now() });
  }
  function next() {
    setOption(null); setEvidence([]); setResult(null); setShowHint(false);
    if (idx + 1 < tasks.length) setIdx(idx + 1); else setFinished(true);
  }
  const toggle = (id: string) => { if (result?.solved) return; setResult(null); setEvidence((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id])); };

  return (
    <div className="space-y-4" lang={lang}>
      <button className="btn-ghost" onClick={onExit}>← {t.back}</button>
      <h2 className="text-2xl font-bold">{lesson.title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="card leading-relaxed" data-testid="text">
          {!finished && <p className="mb-2 text-xs text-slate-500">{t.evidence}</p>}
          {lesson.sentences.map((s, i) => {
            const on = evidence.includes(s.id);
            return (
              <button key={s.id} type="button" data-testid={`sent-${s.id}`} aria-pressed={on} disabled={finished}
                onClick={() => toggle(s.id)}
                className={`mb-1 inline rounded px-1 text-left transition ${on ? 'bg-amber-200 dark:bg-amber-700/60' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <sup className="mr-0.5 text-[10px] text-slate-400">{i + 1}</sup>{s.text}{' '}
              </button>
            );
          })}
        </article>
        <div className="card">
          {finished ? (
            <div data-testid="finished" className="space-y-3">
              <p className="text-xl font-semibold">{t.done}</p>
              {rec ? (
                <div className="rounded-lg bg-indigo-50 p-3 dark:bg-indigo-950" data-testid="recommendation">
                  <p className="text-sm">Навык с ошибками: <b>{SKILL_LABELS[lang][rec.skill]}</b></p>
                  <p className="text-sm">«{rec.task.question}» — {rec.lesson.title}</p>
                  <button className="btn mt-2" data-testid="rec-start" onClick={() => onPlay({ lesson: rec.lesson, taskIds: [rec.task.id] })}>{t.more}</button>
                </div>
              ) : <p className="text-sm text-slate-500" data-testid="no-recommendation">Без ошибок — дополнительное задание не нужно.</p>}
              <button className="btn-ghost" onClick={onExit}>{t.back}</button>
            </div>
          ) : task ? (
            <div className="space-y-3">
              <div className="text-xs uppercase text-slate-500">{idx + 1}/{tasks.length} · {SKILL_LABELS[lang][task.skill]}</div>
              <p className="text-lg font-medium" data-testid="question">{task.question}</p>
              <div className="space-y-2" role="radiogroup">
                {task.options.map((o) => (
                  <label key={o.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${option === o.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950' : 'border-slate-200 dark:border-slate-700'}`}>
                    <input type="radio" name="opt" data-testid={`opt-${o.id}`} checked={option === o.id} disabled={!!result?.solved}
                      onChange={() => { setOption(o.id); setResult(null); }} className="mt-1" />
                    <span>{o.text}</span>
                  </label>
                ))}
              </div>
              {result && (
                <div role="status" data-testid="feedback" data-solved={result.solved} data-evidence={result.evidence} data-answer={result.answerCorrect}
                  className={`rounded-lg p-3 text-sm ${result.solved ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'}`}>
                  {feedbackText(lang, result)}
                </div>
              )}
              {showHint && <p className="text-sm italic text-slate-600 dark:text-slate-300" data-testid="hint">{task.hint}</p>}
              <div className="flex flex-wrap gap-2">
                {result?.solved
                  ? <button className="btn" data-testid="next" onClick={next}>{t.next}</button>
                  : <button className="btn" data-testid="check" disabled={!option || evidence.length === 0} onClick={() => void check()}>{result ? t.retry : t.check}</button>}
                {!result?.solved && <button className="btn-ghost" onClick={() => setShowHint(true)}>{t.hint}</button>}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
