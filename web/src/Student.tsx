import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkAnswer, feedbackParts, parseLessonJson, recommendNext, SKILL_LABELS, type CheckResult, type Language, type Lesson, type Skill, type Task } from '../../shared/lesson';
import { BUILTIN_LESSONS } from '../../shared/builtin';
import { db, importLesson, skillProgress, solvedKeys } from './db';
import { PITCH_URL, useI18n } from './i18n';

type Play = { lesson: Lesson; taskIds: string[]; startIdx?: number };

const LANG_NAME: Record<Language, string> = { kk: 'Қазақша', ru: 'Русский' };
const firstUnsolved = (l: Lesson, solved: Set<string>) => l.tasks.findIndex((x) => !solved.has(`${l.id}/${x.id}`));

/** «Начать урок»: задание 1 первого незавершённого урока на языке интерфейса; если все завершены — первого урока. */
export function pickStart(lessons: Lesson[], lang: Language, solved: Set<string>): Lesson | null {
  const own = lessons.filter((l) => l.language === lang);
  return own.find((l) => firstUnsolved(l, solved) >= 0) ?? own[0] ?? lessons[0] ?? null;
}

export function Student() {
  const { t, lang } = useI18n();
  const rows = useLiveQuery(() => db.lessons.toArray(), []) ?? [];
  const progress = useLiveQuery(() => skillProgress(), []);
  const solved = useLiveQuery(() => solvedKeys(), []) ?? new Set<string>();
  const [play, setPlay] = useState<Play | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const importId = useId();

  if (play) return <Player key={play.lesson.id + play.taskIds.join() + (play.startIdx ?? 0)} play={play} all={rows.map((r) => r.lesson)} onExit={() => setPlay(null)} onPlay={setPlay} />;

  // Уроки на языке интерфейса — первыми (порядок внутри группы сохраняется).
  const ordered = [...rows].sort((a, b) => Number(b.lesson.language === lang) - Number(a.lesson.language === lang));
  const start = pickStart(ordered.map((r) => r.lesson), lang, solved);
  const startPlay = () => start && setPlay({ lesson: start, taskIds: start.tasks.map((x) => x.id) });

  return (
    <div className="space-y-14 pt-6 sm:space-y-20 sm:pt-12">
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]" aria-labelledby="hero-title">
        <div>
          <p className="kicker">{t('heroKicker')}</p>
          <h1 id="hero-title" className="mt-3 text-balance font-serif text-[2.15rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl xl:text-[3.6rem]">{t('heroTitle')}</h1>
          <p className="mt-4 max-w-xl text-pretty text-lg leading-relaxed text-muted sm:text-xl">{t('heroSub')}</p>
          <div className="mt-7 flex flex-col items-start gap-3">
            <button type="button" className="btn btn-lg w-full sm:w-auto" data-testid="start-lesson" disabled={!start} onClick={startPlay}>
              {t('startLesson')} <span aria-hidden="true">→</span>
            </button>
            {start && (
              <p className="text-sm text-muted" data-testid="start-caption">
                <span lang={start.language}>{t('startCaption', { title: start.title, total: start.tasks.length })}</span>
              </p>
            )}
          </div>
          <p className="mt-6 text-sm">
            <a className="link" href={PITCH_URL} target="_blank" rel="noopener noreferrer" data-testid="pitch-link">▶ {t('pitchLink')}</a>
          </p>
        </div>
        <HeroExample lang={lang} />
      </section>

      <section aria-labelledby="lessons-title">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 id="lessons-title" className="font-serif text-3xl font-semibold tracking-tight">{t('lessons')}</h2>
            <p className="mt-1 text-sm text-muted">{t('lessonsLead')}</p>
          </div>
          <button type="button" className="btn-ghost" data-testid="import-open" aria-expanded={importOpen} aria-controls={importId} onClick={() => setImportOpen((o) => !o)}>
            <span aria-hidden="true">{importOpen ? '−' : '+'}</span> {t('addLesson')}
          </button>
        </div>
        {importOpen && <div id={importId} className="mt-4"><ImportBox /></div>}
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {ordered.map(({ lesson, source }) => {
            const done = lesson.tasks.filter((x) => solved.has(`${lesson.id}/${x.id}`)).length;
            const complete = done === lesson.tasks.length;
            return (
              <li key={lesson.id}>
                <button type="button" className="card group flex h-full w-full flex-col text-left transition hover:border-brand/60 hover:shadow-md active:translate-y-px"
                  data-testid={`lesson-${lesson.id}`} onClick={() => setPlay({ lesson, taskIds: lesson.tasks.map((x) => x.id) })}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="badge" lang={lesson.language}>{LANG_NAME[lesson.language]}</span>
                    <span className="text-xs text-muted">{t('grade', { g: lesson.grade })}</span>
                    {source !== 'builtin' && <span className="badge">{t('imported')}</span>}
                    {complete && <span className="badge border-ok/40 bg-ok-soft text-ok">✓ {t('lessonDone')}</span>}
                  </span>
                  <span className="mt-3 font-serif text-xl font-semibold leading-snug group-hover:text-brand-ink" lang={lesson.language}>{lesson.title}</span>
                  <span className="mt-1 line-clamp-2 text-sm text-muted" lang={lesson.language}>{lesson.sentences[0]?.text}</span>
                  <span className="mt-auto flex items-center gap-3 pt-4">
                    <span className="flex gap-1" aria-hidden="true">
                      {lesson.tasks.map((x) => <span key={x.id} className={`h-1.5 w-6 rounded-full ${solved.has(`${lesson.id}/${x.id}`) ? 'bg-brand' : 'bg-line'}`} />)}
                    </span>
                    <span className="text-sm text-muted">{t('doneOf', { d: done, n: lesson.tasks.length })}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="progress-title">
        <div className="border-b border-line pb-3">
          <h2 id="progress-title" className="font-serif text-3xl font-semibold tracking-tight">{t('progressTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('progressLead')}</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3" data-testid="progress">
          {(['find', 'match', 'infer'] as Skill[]).map((s, i) => (
            <div key={s} className="card" data-testid={`progress-${s}`}>
              <div className="text-sm font-medium text-muted"><span className="mr-2 font-serif text-brand-ink">{i + 1}</span>{SKILL_LABELS[lang][s]}</div>
              <div className="mt-2 font-serif text-4xl font-semibold">{progress?.[s].solved ?? 0}<span className="font-sans text-base font-normal text-muted"> {t('solved')}</span></div>
              <div className="mt-1 text-xs text-muted">{t('errorsAttempts', { e: progress?.[s].errors ?? 0, a: progress?.[s].attempts ?? 0 })}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Фрагмент настоящего встроенного урока: предложение-доказательство выделено маркером (только на широком экране). */
function HeroExample({ lang }: { lang: Language }) {
  const { t } = useI18n();
  const lesson = BUILTIN_LESSONS.find((l) => l.id === (lang === 'kk' ? 'kk-balkhash' : 'ru-saiga')) ?? BUILTIN_LESSONS[0]!;
  const task = lesson.tasks[0]!;
  const ev = task.evidenceSets[0]?.[0];
  const at = Math.max(0, lesson.sentences.findIndex((s) => s.id === ev));
  const from = Math.max(0, at - 1);
  const shown = lesson.sentences.slice(from, from + 3);
  const answer = task.options.find((o) => o.id === task.correctOptionId)?.text;
  return (
    <figure className="relative hidden lg:block" lang={lesson.language} data-testid="hero-example">
      <div className="absolute -inset-x-3 -bottom-3 top-3 rotate-1 rounded-2xl border border-line bg-card/60" aria-hidden="true" />
      <div className="relative rounded-2xl border border-line bg-card p-7 shadow-sm">
        <figcaption className="kicker" lang={lang}>{t('exampleLabel')} · <span lang={lesson.language} className="normal-case tracking-normal">«{lesson.title}»</span></figcaption>
        <p className="mt-4 font-serif text-[1.15rem] leading-9">
          {shown.map((s, k) => {
            const n = from + k + 1;
            return s.id === ev
              ? <mark key={s.id} className="rounded-md bg-marker px-1 py-0.5 text-marker-ink underline decoration-2 underline-offset-[5px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]" style={{ textDecorationColor: 'rgb(var(--marker-ink) / 0.45)' }}><span className="sent-num border-transparent bg-brand text-on-brand">✓</span>{s.text}</mark>
              : <span key={s.id} className="text-ink/80"><span className="sent-num">{n}</span>{s.text}</span>;
          }).reduce<ReactNode[]>((acc, el, k) => (k ? [...acc, ' ', el] : [el]), [])}
        </p>
        <div className="mt-6 space-y-2 border-t border-dashed border-line pt-5 text-sm">
          <p className="font-medium">{task.question}</p>
          <p className="flex flex-wrap items-center gap-2" lang={lang}>
            <span className="text-muted">{t('exampleAnswer')}:</span>
            <span className="rounded-full border border-brand/40 bg-brand-soft px-3 py-1 font-medium text-brand-ink" lang={lesson.language}>{answer}</span>
            <span className="text-muted">{t('exampleEvidence')}:</span>
            <span className="rounded-full bg-marker px-3 py-1 font-medium text-marker-ink">№ {at + 1}</span>
          </p>
        </div>
      </div>
    </figure>
  );
}

function ImportBox() {
  const { t } = useI18n();
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'same' | 'renamed'; text: string } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  async function handle(raw: string) {
    setMsg(null);
    const r = parseLessonJson(raw);
    if (!r.ok) return setErrors(r.errors);
    setErrors([]);
    const out = await importLesson(r.lesson);
    if (out.status === 'new') setMsg({ kind: 'ok', text: t('importOk', { title: out.lesson.title }) });
    else if (out.status === 'same') setMsg({ kind: 'same', text: t('importSame', { title: out.lesson.title }) });
    else setMsg({ kind: 'renamed', text: t('importConflict', { id: out.originalId, title: out.lesson.title, newId: out.lesson.id }) });
  }
  return (
    <div className="card border-dashed">
      <h3 className="font-serif text-lg font-semibold">{t('importTitle')}</h3>
      <p className="mt-1 text-sm text-muted">{t('importHint')}</p>
      {/* Своя подписанная кнопка вместо системного «Choose File»; сам input (data-testid=import-file) остаётся в DOM и доступен с клавиатуры. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="btn cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-ink">
          <input type="file" accept="application/json,.json" data-testid="import-file" className="sr-only"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); await handle(await f.text()); } e.target.value = ''; }} />
          <span aria-hidden="true">↥</span> {t('importChoose')}
        </label>
        <span className="min-w-0 break-all text-sm text-muted" data-testid="import-filename">{fileName ? t('importFile', { name: fileName }) : t('importNoFile')}</span>
      </div>
      {msg && (
        <p role="status" data-testid={msg.kind === 'ok' ? 'import-ok' : `import-${msg.kind}`}
          className={`mt-3 rounded-xl p-3 text-sm ${msg.kind === 'ok' ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-ink'}`}>{msg.text}</p>
      )}
      {errors.length > 0 && (
        <div className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad" data-testid="import-errors" role="alert">
          <b>{t('importFailed')}</b>
          <ul className="list-disc pl-5">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

const PLAYER_TEXT = {
  ru: {
    check: 'Проверить', recheck: 'Проверить ещё раз', next: 'Следующее задание', finish: 'Завершить урок', hint: 'Подсказка',
    textHint: 'Нажми на предложение, которое подтверждает ответ, — оно выделится маркером. Нажми ещё раз, чтобы снять.',
    step1: 'Выбери ответ', step2: 'Отметь доказательство в тексте', noQuote: 'Пока ничего не отмечено.',
    toText: '↓ К тексту', toQuestion: '↑ К вопросу', marked: 'Отмечено: {n}', remove: 'Снять отметку с предложения {n}',
    needBoth: 'Чтобы проверить, выбери ответ и отметь хотя бы одно предложение.',
    done: 'Урок пройден!', more: 'Ещё одно задание', back: 'К урокам', task: 'Задание {n} из {total}',
    weak: 'Навык с ошибками:', noRec: 'Без ошибок — дополнительное задание не нужно.', solved: 'Отлично: ответ доказан.', sentence: 'Предложение',
  },
  kk: {
    check: 'Тексеру', recheck: 'Қайта тексеру', next: 'Келесі тапсырма', finish: 'Сабақты аяқтау', hint: 'Кеңес',
    textHint: 'Жауапты дәлелдейтін сөйлемді бас — ол маркермен белгіленеді. Белгіні алу үшін қайта бас.',
    step1: 'Жауапты таңда', step2: 'Мәтіннен дәлелді белгіле', noQuote: 'Әзірге ештеңе белгіленбеген.',
    toText: '↓ Мәтінге', toQuestion: '↑ Сұраққа', marked: 'Белгіленді: {n}', remove: '{n}-сөйлемнің белгісін алу',
    needBoth: 'Тексеру үшін жауапты таңдап, кемінде бір сөйлемді белгіле.',
    done: 'Сабақ аяқталды!', more: 'Тағы бір тапсырма', back: 'Сабақтарға', task: '{total} тапсырманың {n}-сі',
    weak: 'Қатесі бар дағды:', noRec: 'Қатесіз — қосымша тапсырма керек емес.', solved: 'Тамаша: жауап дәлелденді.', sentence: 'Сөйлем',
  },
} as const;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

function Mark({ ok }: { ok: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${ok ? 'bg-ok text-card' : 'bg-bad text-card'}`}>{ok ? '✓' : '✗'}</span>
  );
}

function Player({ play, all, onExit, onPlay }: { play: Play; all: Lesson[]; onExit: () => void; onPlay: (p: Play) => void }) {
  const { lesson } = play;
  const tasks = useMemo(() => play.taskIds.map((id) => lesson.tasks.find((x) => x.id === id)).filter((x): x is Task => !!x), [play, lesson]);
  const [idx, setIdx] = useState(() => Math.min(play.startIdx ?? 0, Math.max(0, tasks.length - 1)));
  const [option, setOption] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [finished, setFinished] = useState(false);
  const [rec, setRec] = useState<ReturnType<typeof recommendNext>>(null);
  const textRef = useRef<HTMLElement>(null);
  const questionRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const task = tasks[idx];
  const lang = lesson.language;
  const t = PLAYER_TEXT[lang];
  const order = new Map(lesson.sentences.map((s, i) => [s.id, i]));

  useEffect(() => {
    if (!finished) return;
    void (async () => {
      const attempts = await db.attempts.where('lessonId').equals(lesson.id).toArray();
      setRec(recommendNext(all, lesson, attempts, await solvedKeys()));
    })();
  }, [finished, all, lesson]);

  // Новое задание на телефоне: показываем вопрос с начала (текст ниже, к нему ведёт «К тексту»).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (window.innerWidth < 1024) questionRef.current?.scrollIntoView({ block: 'start' });
  }, [idx, finished]);

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
  // Исправление цитаты не сбрасывает выбранный ответ (и наоборот).
  const toggle = (id: string) => {
    if (result?.solved) return;
    setResult(null);
    setEvidence((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))));
  };
  const goText = () => { textRef.current?.scrollIntoView({ block: 'start' }); textRef.current?.focus({ preventScroll: true }); };
  const goQuestion = () => { questionRef.current?.scrollIntoView({ block: 'start' }); questionRef.current?.focus({ preventScroll: true }); };
  const parts = result && task ? feedbackParts(lang, result, task) : null;
  const isLast = idx + 1 >= tasks.length;

  return (
    <div className="pt-4 sm:pt-8" lang={lang}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={onExit}>← {t.back}</button>
        <span className="text-sm text-muted">{LANG_NAME[lang]} · {lang === 'kk' ? `${lesson.grade}-сынып` : `${lesson.grade} класс`}</span>
      </div>
      <h1 className="mt-5 text-balance font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{lesson.title}</h1>
      {!finished && task && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span className="flex gap-1" aria-hidden="true">
            {tasks.map((x, k) => <span key={x.id} className={`h-1.5 w-8 rounded-full ${k < idx ? 'bg-brand' : k === idx ? 'bg-brand/50' : 'bg-line'}`} />)}
          </span>
          <span>{fill(t.task, { n: idx + 1, total: tasks.length })} · {SKILL_LABELS[lang][task.skill]}</span>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:items-start lg:gap-8">

        <section ref={questionRef} tabIndex={-1} className="card scroll-mt-4 p-5 sm:p-7 lg:sticky lg:top-4" aria-label={task?.question}>
          {finished ? (
            <div data-testid="finished" className="space-y-4">
              <p className="font-serif text-3xl font-semibold">{t.done}</p>
              {rec ? (
                <div className="rounded-xl border border-line bg-paper p-4" data-testid="recommendation">
                  <p className="text-sm">{t.weak} <b>{SKILL_LABELS[lang][rec.skill]}</b></p>
                  <p className="mt-1 text-sm text-muted">«{rec.task.question}» — {rec.lesson.title}</p>
                  <button type="button" className="btn mt-3" data-testid="rec-start" onClick={() => onPlay({ lesson: rec.lesson, taskIds: [rec.task.id] })}>{t.more} →</button>
                </div>
              ) : <p className="text-sm text-muted" data-testid="no-recommendation">{t.noRec}</p>}
              <button type="button" className="btn-ghost" onClick={onExit}>{t.back}</button>
            </div>
          ) : task ? (
            <div className="space-y-5">
              <p className="font-serif text-xl font-semibold leading-snug sm:text-2xl" data-testid="question">{task.question}</p>

              <fieldset>
                <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-paper" aria-hidden="true">1</span>{t.step1}
                </legend>
                <div className="space-y-2">
                  {task.options.map((o) => {
                    const sel = option === o.id;
                    return (
                      <label key={o.id} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-ink ${sel ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/50'} ${result?.solved ? 'cursor-default' : ''}`}>
                        <input type="radio" name="opt" data-testid={`opt-${o.id}`} checked={sel} disabled={!!result?.solved}
                          onChange={() => { setOption(o.id); setResult(null); }} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" />
                        <span className={sel ? 'font-medium' : ''}>{o.text}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-paper" aria-hidden="true">2</span>{t.step2}
                </p>
                {evidence.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line p-3 text-sm text-muted" data-testid="quotes-empty">
                    <span>{t.noQuote}</span>
                    <button type="button" className="btn-ghost min-h-9 py-1 lg:hidden" data-testid="to-text" onClick={goText}>{t.toText}</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <ul className="space-y-2" data-testid="quotes">
                      {evidence.map((sid) => {
                        const n = (order.get(sid) ?? 0) + 1;
                        const s = lesson.sentences.find((x) => x.id === sid);
                        return (
                          <li key={sid} className="flex items-start gap-2 rounded-xl bg-marker p-2.5 text-sm text-marker-ink">
                            <span className="sent-num mt-0.5 border-transparent bg-brand text-on-brand">{n}</span>
                            <span className="line-clamp-2 flex-1 font-serif">{s?.text}</span>
                            {!result?.solved && (
                              <button type="button" className="-m-1 rounded-lg px-2 py-1 text-base leading-none hover:bg-marker" aria-label={fill(t.remove, { n })} onClick={() => toggle(sid)}>×</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {!result?.solved && <button type="button" className="text-sm font-medium text-brand-ink underline underline-offset-4 lg:hidden" data-testid="to-text" onClick={goText}>{t.toText}</button>}
                  </div>
                )}
              </div>

              {result && parts && (
                <div role="status" data-testid="feedback" data-solved={result.solved} data-evidence={result.evidence} data-answer={result.answerCorrect}
                  className={`space-y-2 rounded-xl border p-4 ${result.solved ? 'border-ok/40 bg-ok-soft' : 'border-line bg-paper'}`}>
                  {result.solved && <p className="font-serif text-lg font-semibold text-ok">{t.solved}</p>}
                  <p className="flex items-center gap-2.5 font-medium">
                    <Mark ok={result.answerCorrect} /><span data-testid="feedback-answer" data-ok={result.answerCorrect}>{parts.answer}</span>
                  </p>
                  <p className="flex items-center gap-2.5 font-medium">
                    <Mark ok={result.evidence === 'correct'} /><span data-testid="feedback-evidence" data-ok={result.evidence === 'correct'}>{parts.evidence}</span>
                  </p>
                  {parts.tip && <p className="pl-[34px] text-sm text-muted" data-testid="feedback-tip">{parts.tip}</p>}
                </div>
              )}
              {showHint && <p className="rounded-xl border-l-4 border-marker bg-paper p-3 text-sm italic" data-testid="hint">{task.hint}</p>}
              {!result && (!option || evidence.length === 0) && <p className="text-sm text-muted">{t.needBoth}</p>}
              <div className="flex flex-wrap gap-2">
                {result?.solved
                  ? <button type="button" className="btn btn-lg w-full sm:w-auto" data-testid="next" onClick={next}>{isLast ? t.finish : t.next} <span aria-hidden="true">→</span></button>
                  : <button type="button" className="btn" data-testid="check" disabled={!option || evidence.length === 0} onClick={() => void check()}>{result ? t.recheck : t.check}</button>}
                {!result?.solved && !showHint && <button type="button" className="btn-ghost" onClick={() => setShowHint(true)}>{t.hint}</button>}
              </div>
            </div>
          ) : null}
        </section>

        <article ref={textRef} tabIndex={-1} id="lesson-text" className="card scroll-mt-4 p-5 sm:p-8 lg:order-first" data-testid="text">
          {!finished && (
            <p className="mb-4 flex items-start gap-2 rounded-xl bg-paper p-3 text-sm text-muted" data-testid="text-hint">
              <span aria-hidden="true" className="mt-0.5 inline-block h-4 w-6 shrink-0 rounded bg-marker" />
              <span>{t.textHint}</span>
            </p>
          )}
          <p className="font-serif text-[1.13rem] leading-[2.05rem] sm:text-[1.2rem] sm:leading-[2.2rem]">
            {lesson.sentences.map((s, i) => {
              const on = evidence.includes(s.id);
              return (
                <span key={s.id}>
                  <button type="button" data-testid={`sent-${s.id}`} aria-pressed={on} disabled={finished} onClick={() => toggle(s.id)} className="sent">
                    <span className="sent-num" aria-hidden="true">{on ? '✓' : i + 1}</span>
                    <span className="sr-only">{t.sentence} {i + 1}: </span>{s.text}
                  </button>{' '}
                </span>
              );
            })}
          </p>
          {!finished && (
            <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 flex items-center justify-between gap-3 rounded-b-2xl border-t border-line bg-card/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:-mb-8 sm:px-8 lg:hidden">
              <span className="text-sm text-muted" data-testid="marked-count">{fill(t.marked, { n: evidence.length })}</span>
              <button type="button" className="btn-ghost" data-testid="to-question" onClick={goQuestion}>{t.toQuestion}</button>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
