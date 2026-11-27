import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkAnswer, DEFAULT_GRADE, feedbackParts, GRADES, GradeSchema, parseLessonJson, recommendNext, SKILL_LABELS, type CheckResult, type Grade, type Language, type Lesson, type Skill, type Task } from '../../shared/lesson';
import { BUILTIN_LESSONS } from '../../shared/builtin';
import { MATH_SKILL_LABELS, nbspNumbers, subjectOf, type Subject } from '../../shared/math';
import { db, importLesson, readProgress, solvedKeys } from './db';
import { PITCH_URL, useI18n } from './i18n';
import { Icon, Spinner } from './Icon';
import { Graphs } from './Graphs';

type Play = { lesson: Lesson; taskIds: string[]; startIdx?: number };

const LANG_NAME: Record<Language, string> = { kk: 'Қазақша', ru: 'Русский' };
const EMPTY_SOLVED = new Set<string>();
type GradeFilter = Grade | 'all';
const GRADE_FILTERS = ['all', ...GRADES] as const;
const GRADE_KEY = 'oqy-grade';
function readGrade(): GradeFilter {
  try { return GradeSchema.safeParse(Number(localStorage.getItem(GRADE_KEY))).data ?? 'all'; }
  catch { return 'all'; }
}
const SUBJECT_KEY = 'oqy-subject';
function readSubject(): Subject {
  try { return localStorage.getItem(SUBJECT_KEY) === 'math' ? 'math' : 'reading'; }
  catch { return 'reading'; }
}
/** Подписи навыков зависят от раздела: в математике — «найти данные / посчитать / выбрать и обосновать». */
export const skillLabel = (subject: Subject, lang: Language, skill: Skill) => (subject === 'math' ? MATH_SKILL_LABELS : SKILL_LABELS)[lang][skill];
const firstUnsolved = (l: Lesson, solved: Set<string>) => l.tasks.findIndex((x) => !solved.has(`${l.id}/${x.id}`));

/** «Начать урок»: задание 1 первого незавершённого урока на языке интерфейса; если все завершены — первого урока. */
export function pickStart(lessons: Lesson[], lang: Language, solved: Set<string>): Lesson | null {
  const own = lessons.filter((l) => l.language === lang);
  return own.find((l) => firstUnsolved(l, solved) >= 0) ?? own[0] ?? lessons[0] ?? null;
}

export function Student() {
  const { t, lang } = useI18n();
  const rows = useLiveQuery(() => db.lessons.toArray(), []);
  const all = useMemo(() => rows?.map((row) => row.lesson) ?? [], [rows]);
  const progress = useLiveQuery(() => readProgress().catch(() => null), []);
  const solved = progress?.solved ?? EMPTY_SOLVED;
  const [play, setPlay] = useState<Play | null>(null);
  const [grade, setGrade] = useState(readGrade);
  const [subject, setSubject] = useState<Subject>(readSubject);
  const [mathView, setMathView] = useState<'lessons' | 'graphs'>(() => { try { return localStorage.getItem('oqy-math-view') === 'graphs' ? 'graphs' : 'lessons'; } catch { return 'lessons'; } });
  const selectMathView = (value: 'lessons' | 'graphs') => { setMathView(value); try { localStorage.setItem('oqy-math-view', value); } catch { /* Storage can be disabled. */ } };
  const selectSubject = (value: Subject) => {
    setSubject(value);
    try { localStorage.setItem(SUBJECT_KEY, value); } catch { /* Storage can be disabled. */ }
  };
  const [importOpen, setImportOpen] = useState(false);
  const importId = useId();
  const selectGrade = (value: GradeFilter) => {
    setGrade(value);
    try { localStorage.setItem(GRADE_KEY, String(value)); } catch { /* Storage can be disabled. */ }
  };

  if (play) return <Player key={play.lesson.id + play.taskIds.join() + (play.startIdx ?? 0)} play={play} all={all} onExit={() => setPlay(null)} onPlay={setPlay} />;

  // Раздел и класс; уроки на языке интерфейса — первыми (порядок внутри группы сохраняется).
  const inView = (lesson: Lesson) => subjectOf(lesson) === subject && (grade === 'all' || lesson.grade === grade);
  const ordered = (rows ?? []).filter((row) => inView(row.lesson))
    .sort((a, b) => Number(b.lesson.language === lang) - Number(a.lesson.language === lang) || a.lesson.grade - b.lesson.grade);
  const start = progress === undefined ? null : pickStart(all.filter(inView), lang, solved);
  const startPlay = () => start && setPlay({ lesson: start, taskIds: start.tasks.map((x) => x.id) });

  return (
    <div className="space-y-14 pt-6 sm:space-y-20 sm:pt-12">
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14" aria-labelledby="hero-title">
        <div>
          {/* Раздел: «Чтение / Математика». Выбор запоминается, как класс и язык. */}
          <div role="group" aria-label={t('subjectLabel')} className="mb-5 inline-flex rounded-full border border-line-strong/50 bg-card p-1" data-testid="subject-switch">
            {(['reading', 'math'] as const).map((value) => (
              <button type="button" key={value} aria-pressed={subject === value} data-testid={`subject-${value}`}
                className={`min-h-10 rounded-full px-4 text-sm transition-colors duration-150 ${subject === value ? 'bg-ink font-semibold text-paper' : 'text-muted hover:bg-sunken hover:text-ink'}`}
                onClick={() => selectSubject(value)}>{t(value === 'math' ? 'subjectMath' : 'subjectReading')}</button>
            ))}
          </div>
          <p className="kicker">{t(subject === 'math' ? 'heroKickerMath' : 'heroKicker')}</p>
          <h1 id="hero-title" className="mt-3 font-serif text-display font-semibold">{t(subject === 'math' ? 'heroTitleMath' : 'heroTitle')}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">{t(subject === 'math' ? 'heroSubMath' : 'heroSub')}</p>
          <div className="mt-6 flex flex-col gap-4 sm:mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <span id="grade-label" className="text-sm font-medium text-muted">{t('gradeLabel')}</span>
              {/* Класс: сегменты с видимой цифрой; доступное имя — полное («7 класс»). */}
              <div role="group" aria-labelledby="grade-label" className="inline-flex rounded-full border border-line-strong/50 bg-card p-1" data-testid="grade-filter">
                {GRADE_FILTERS.map((g) => (
                  <button type="button" key={g} aria-pressed={grade === g} data-testid={`grade-${g}`} aria-label={g === 'all' ? undefined : t('grade', { g })}
                    className={`min-h-10 min-w-11 rounded-full px-3.5 text-sm tabular-nums transition-colors duration-150 ${grade === g ? 'bg-ink font-semibold text-paper' : 'text-muted hover:bg-sunken hover:text-ink'}`}
                    onClick={() => selectGrade(g)}>{g === 'all' ? t('gradeAll') : g}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-start">
              <button type="button" className="btn btn-lg" data-testid="start-lesson" disabled={!start} onClick={startPlay}>
                {t('startLesson')} <Icon name="arrow-right" />
              </button>
              {start && (
                <p className="wrap-any text-sm text-muted" data-testid="start-caption">
                  <span lang={start.language}>{t('startCaption', { title: start.title, total: start.tasks.length })}</span>
                </p>
              )}
            </div>
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-muted">{t('forTeacher')}</span>
            <a className="link inline-flex items-center gap-1.5" href={PITCH_URL} target="_blank" rel="noopener noreferrer" data-testid="pitch-link">
              <Icon name="play" className="h-3.5 w-3.5" />{t('pitchLink')}
            </a>
          </p>
        </div>
        <HeroExample lang={lang} subject={subject} grade={start?.grade ?? (grade === 'all' ? DEFAULT_GRADE : grade)} />
      </section>

      {subject === 'math' && (
        <div role="tablist" aria-label={t('subjectMath')} className="-mb-6 inline-flex rounded-full border border-line-strong/50 bg-card p-1 sm:-mb-10" data-testid="math-view">
          {(['lessons', 'graphs'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={mathView === v} data-testid={`math-view-${v}`}
              className={`min-h-10 rounded-full px-4 text-sm ${mathView === v ? 'bg-ink font-semibold text-paper' : 'text-muted hover:bg-sunken hover:text-ink'}`}
              onClick={() => selectMathView(v)}>{t(v === 'graphs' ? 'mathGraphs' : 'mathLessons')}</button>
          ))}
        </div>
      )}
      {subject === 'math' && mathView === 'graphs' ? <Graphs /> : <>
      <section aria-labelledby="lessons-title">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 id="lessons-title" className="font-serif text-title font-semibold">{t('lessons')}</h2>
            <p className="mt-1 text-sm text-muted">{t(subject === 'math' ? 'lessonsLeadMath' : 'lessonsLead')}</p>
          </div>
          <button type="button" className="btn-ghost" data-testid="import-open" aria-expanded={importOpen} aria-controls={importId} onClick={() => setImportOpen((o) => !o)}>
            <Icon name={importOpen ? 'minus' : 'plus'} className="h-4 w-4" /> {t('addLesson')}
          </button>
        </div>
        {importOpen && <div id={importId} className="mt-5"><ImportBox onImported={(lesson) => { selectGrade(lesson.grade); selectSubject(subjectOf(lesson)); }} /></div>}
        {rows === undefined && <p className="mt-5 flex items-center gap-2 text-sm text-muted" role="status"><Spinner />{t('loading')}</p>}
        {rows && !ordered.length && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-line-strong/60 p-5">
            <p className="text-sm text-muted" data-testid="grade-empty">{t('gradeEmpty')}</p>
            <button type="button" className="btn-ghost btn-sm" onClick={() => selectGrade('all')}>{t('gradeShowAll')}</button>
          </div>
        )}
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ordered.map(({ lesson, source }) => {
            const done = lesson.tasks.filter((x) => solved.has(`${lesson.id}/${x.id}`)).length;
            const complete = !!progress && done === lesson.tasks.length;
            const cta = complete ? t('cardRepeat') : done > 0 ? t('cardContinue') : t('cardStart');
            return (
              <li key={lesson.id}>
                <button type="button" className="card group flex h-full w-full flex-col text-left transition-[border-color,box-shadow] duration-150 hover:border-brand-ink/50 hover:shadow-raised"
                  data-testid={`lesson-${lesson.id}`} onClick={() => setPlay({ lesson, taskIds: lesson.tasks.map((x) => x.id) })}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="badge text-ink" lang={lesson.language}>{LANG_NAME[lesson.language]}</span>
                    <span className="badge">{t('grade', { g: lesson.grade })}</span>
                    {source !== 'builtin' && <span className="badge border-dashed">{t('imported')}</span>}
                    {complete && <span className="badge border-ok/40 bg-ok-soft text-ok"><Icon name="check" className="h-3.5 w-3.5" />{t('lessonDone')}</span>}
                    <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-ink" aria-hidden="true">{cta}<Icon name="arrow-right" className="h-4 w-4 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:translate-x-0.5" /></span>
                  </span>
                  <span className="wrap-any mt-4 font-serif text-subheading font-semibold" lang={lesson.language}>{lesson.title}</span>
                  <span className="wrap-any mt-1.5 line-clamp-2 text-sm text-muted" lang={lesson.language}>{lesson.sentences[0]?.text}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex max-w-full flex-wrap gap-1" aria-hidden="true">
                        {lesson.tasks.map((x) => <span key={x.id} className={`h-2 w-6 rounded-full ${solved.has(`${lesson.id}/${x.id}`) ? 'bg-brand' : 'border border-line-strong/50 bg-sunken'}`} />)}
                      </span>
                      <span className="text-sm tabular-nums text-muted">{progress ? t('doneOf', { d: done, n: lesson.tasks.length }) : t(progress === undefined ? 'loading' : 'progressUnavailable')}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="progress-title">
        <div className="border-b border-line pb-4">
          <h2 id="progress-title" className="font-serif text-title font-semibold">{t('progressTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t(subject === 'math' ? 'progressLeadMath' : 'progressLead')}</p>
        </div>
        {!progress ? (
          <p className="mt-5 text-sm text-muted" role="status" data-testid="progress">{t(progress === undefined ? 'loading' : 'progressUnavailable')}</p>
        ) : <ul className="mt-5 grid gap-4 sm:grid-cols-3" data-testid="progress">
          {(['find', 'match', 'infer'] as Skill[]).map((s, i) => (
            <li key={s} className="card" data-testid={`progress-${s}`}>
              <div className="flex items-center gap-2.5 text-sm font-medium text-ink">
                <span className="step-dot h-6 w-6 text-xs" aria-hidden="true">{i + 1}</span>{skillLabel(subject, lang, s)}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-serif text-[2.5rem] font-semibold leading-none tabular-nums">{progress.bySubject[subject][s].solved}</span>{' '}
                <span className="text-sm text-muted">{t('solved')}</span>
              </div>
              <div className="mt-2 text-caption tabular-nums text-muted">{t('errorsAttempts', { e: progress.bySubject[subject][s].errors, a: progress.bySubject[subject][s].attempts })}</div>
            </li>
          ))}
        </ul>}
      </section>
      </>}
    </div>
  );
}

/** Фрагмент настоящего встроенного урока: предложение-доказательство выделено маркером (только на широком экране). */
function HeroExample({ lang, grade, subject }: { lang: Language; grade: Grade; subject: Subject }) {
  const { t } = useI18n();
  const preferred = lang === 'kk' ? 'kk-balkhash' : 'ru-saiga';
  const lesson = subject === 'reading' && grade === DEFAULT_GRADE
    ? BUILTIN_LESSONS.find((item) => item.id === preferred)
    : BUILTIN_LESSONS.find((item) => subjectOf(item) === subject && item.grade === grade && item.language === lang);
  if (!lesson) return null;
  const task = lesson.tasks[0]!;
  const ev = task.evidenceSets[0]?.[0];
  const at = Math.max(0, lesson.sentences.findIndex((s) => s.id === ev));
  const from = Math.max(0, at - 1);
  const shown = lesson.sentences.slice(from, from + 3);
  const answer = task.options.find((o) => o.id === task.correctOptionId)?.text;
  return (
    <figure className="relative hidden lg:block" lang={lesson.language} data-testid="hero-example">
      <div className="notebook absolute -inset-6 rounded-card" aria-hidden="true" />
      <div className="relative rounded-card border border-line bg-card p-7 shadow-raised">
        <figcaption className="kicker" lang={lang}>{t('exampleLabel')} · <span lang={lesson.language} className="normal-case tracking-normal">«{lesson.title}»</span></figcaption>
        <p className="mt-4 font-serif text-[1.125rem] leading-[2.1]">
          {shown.map((s, k) => {
            const n = from + k + 1;
            return s.id === ev
              ? <mark key={s.id} className="rounded-chip bg-marker px-1 py-0.5 text-marker-ink underline decoration-2 underline-offset-[5px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]" style={{ textDecorationColor: 'rgb(var(--marker-ink) / 0.55)' }}><span className="sent-num border-transparent bg-ink text-paper"><Icon name="check" className="h-3 w-3" /></span>{s.text}</mark>
              : <span key={s.id} className="text-muted"><span className="sent-num">{n}</span>{s.text}</span>;
          }).reduce<ReactNode[]>((acc, el, k) => (k ? [...acc, ' ', el] : [el]), [])}
        </p>
        <div className="mt-6 space-y-3 border-t border-dashed border-line-strong/50 pt-5 text-sm">
          <p className="font-medium">{task.question}</p>
          <ol className="grid gap-2" lang={lang}>
            <li className="flex flex-wrap items-center gap-2">
              <span className="step-dot h-6 w-6 text-xs" aria-hidden="true">1</span>
              <span className="text-muted">{t('exampleAnswer')}:</span>
              <span className="rounded-full border border-brand-ink/40 bg-brand-soft px-3 py-1 font-medium text-ink" lang={lesson.language}>{answer}</span>
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className="step-dot h-6 w-6 text-xs" aria-hidden="true">2</span>
              <span className="text-muted">{t('exampleEvidence')}:</span>
              <span className="rounded-full bg-marker px-3 py-1 font-medium text-marker-ink">{t('exampleSentence', { n: at + 1 })}</span>
            </li>
          </ol>
        </div>
      </div>
    </figure>
  );
}

function ImportBox({ onImported }: { onImported: (lesson: Lesson) => void }) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'same' | 'renamed'; text: string } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  async function handle(file: File) {
    setFileName(file.name);
    setImporting(true);
    setMsg(null);
    setErrors([]);
    try {
      const r = parseLessonJson(await file.text());
      if (!r.ok) {
        setErrors(r.errors);
        return;
      }
      const out = await importLesson(r.lesson);
      onImported(out.lesson);
      if (out.status === 'new') setMsg({ kind: 'ok', text: t('importOk', { title: out.lesson.title }) });
      else if (out.status === 'same') setMsg({ kind: 'same', text: t('importSame', { title: out.lesson.title }) });
      else setMsg({ kind: 'renamed', text: t('importConflict', { id: out.originalId, title: out.lesson.title, newId: out.lesson.id }) });
    } catch {
      setErrors([t('importStorageError')]);
    } finally {
      setImporting(false);
    }
  }
  return (
    <div className="rounded-card border border-dashed border-line-strong/70 bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-ink" aria-hidden="true"><Icon name="upload" /></span>
        <div className="min-w-0">
          <h3 className="font-serif text-subheading font-semibold">{t('importTitle')}</h3>
          <p className="mt-1 text-sm text-muted">{t('importHint')}</p>
        </div>
      </div>
      {/* Своя подписанная кнопка вместо системного «Choose File»; сам input (data-testid=import-file) остаётся в DOM и доступен с клавиатуры. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className={`btn-ghost cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-ink ${importing ? 'pointer-events-none opacity-60' : ''}`}>
          <input type="file" accept="application/json,.json" data-testid="import-file" className="sr-only" disabled={importing}
            onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void handle(f); }} />
          {importing ? <Spinner /> : <Icon name="upload" className="h-4 w-4" />} {t('importChoose')}
        </label>
        <span className="min-w-0 break-all text-sm text-muted" data-testid="import-filename">{fileName ? t('importFile', { name: fileName }) : t('importNoFile')}</span>
      </div>
      {importing && <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status"><Spinner />{t('importBusy')}</p>}
      {msg && (
        <p role="status" data-testid={msg.kind === 'ok' ? 'import-ok' : `import-${msg.kind}`}
          className={`note mt-4 ${msg.kind === 'ok' ? 'note-ok' : 'note-info'}`}>
          <Icon name={msg.kind === 'ok' ? 'check' : 'info'} className="mt-px h-5 w-5" /><span>{msg.text}</span>
        </p>
      )}
      {errors.length > 0 && (
        <div className="note note-bad mt-4" data-testid="import-errors" role="alert">
          <Icon name="alert" className="mt-px h-5 w-5" />
          <div className="min-w-0">
            <b>{t('importFailed')}</b>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
            <p className="mt-2 text-ink">{t('importRetry')}</p>
          </div>
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
    saving: 'Сохраняю…', saveError: 'Не удалось сохранить попытку. Ответ и цитаты остались выбраны. Попробуй ещё раз.',
    done: 'Урок пройден!', more: 'Ещё одно задание', back: 'К урокам', task: 'Задание {n} из {total}',
    weak: 'Навык с ошибками:', noRec: 'Дополнительное задание не требуется.', noRecYet: 'Других заданий для этого класса и языка пока нет. Пройди урок ещё раз — ошибки станут подсказкой.', recLoading: 'Подбираю дополнительное задание…',
    recError: 'Не удалось загрузить рекомендацию. Вернись к урокам и выбери следующий.', solved: 'Отлично: ответ доказан.', sentence: 'Предложение',
    textLabel: 'Текст', grade: '{g} класс', doneLead: 'Все задания решены: ответы выбраны и доказаны цитатами из текста.', recTitle: 'Потренируй навык',
    retry: 'Исправь то, что отмечено крестиком, и проверь ещё раз.',
    retryAdd: 'Отмеченное предложение оставь и добавь ещё одно, потом проверь ещё раз.',
  },
  kk: {
    check: 'Тексеру', recheck: 'Қайта тексеру', next: 'Келесі тапсырма', finish: 'Сабақты аяқтау', hint: 'Кеңес',
    textHint: 'Жауапты дәлелдейтін сөйлемді бас — ол маркермен белгіленеді. Белгіні алу үшін қайта бас.',
    step1: 'Жауапты таңда', step2: 'Мәтіннен дәлелді белгіле', noQuote: 'Әзірге ештеңе белгіленбеген.',
    toText: '↓ Мәтінге', toQuestion: '↑ Сұраққа', marked: 'Белгіленді: {n}', remove: '{n}-сөйлемнің белгісін алу',
    needBoth: 'Тексеру үшін жауапты таңдап, кемінде бір сөйлемді белгіле.',
    saving: 'Сақталуда…', saveError: 'Тапсырма нәтижесі сақталмады. Жауап пен дәлелдер белгіленіп тұр. Қайта тексеріп көр.',
    done: 'Сабақ аяқталды!', more: 'Тағы бір тапсырма', back: 'Сабақтарға', task: '{total} тапсырманың {n}-сі',
    weak: 'Қатесі бар дағды:', noRec: 'Қосымша тапсырма қажет емес.', noRecYet: 'Бұл сынып пен тілге басқа тапсырма әзірге жоқ. Сабақты қайта өт — қателер кеңес болады.', recLoading: 'Қосымша тапсырма таңдалуда…',
    recError: 'Ұсынысты жүктеу мүмкін болмады. Сабақтарға оралып, келесісін таңда.', solved: 'Тамаша: жауап дәлелденді.', sentence: 'Сөйлем',
    textLabel: 'Мәтін', grade: '{g}-сынып', doneLead: 'Барлық тапсырма орындалды: жауаптар таңдалып, мәтіннен дәлелденді.', recTitle: 'Дағдыны жаттықтыр',
    retry: 'Айқышпен белгіленгенді түзетіп, қайта тексер.',
    retryAdd: 'Белгіленген сөйлемді қалдырып, тағы біреуін қос та, қайта тексер.',
  },
} as const;

/** Математика: те же шаги, но доказательство — строки с исходными данными. */
const MATH_TEXT = {
  ru: {
    textHint: 'Нажми на строку с данными, которые нужны для ответа, — она выделится маркером. Нажми ещё раз, чтобы снять.',
    step2: 'Отметь нужные данные в условии', noQuote: 'Данные пока не отмечены.',
    needBoth: 'Чтобы проверить, выбери ответ и отметь хотя бы одну строку с данными.',
    solved: 'Отлично: ответ обоснован данными.', sentence: 'Строка', textLabel: 'Условие',
    doneLead: 'Все задания решены: ответы выбраны и обоснованы данными из условия.',
    retry: 'Исправь то, что отмечено крестиком, и проверь ещё раз.',
    retryAdd: 'Отмеченные данные оставь и добавь недостающую величину, потом проверь ещё раз.',
  },
  kk: {
    textHint: 'Жауапқа керек деректі жолды бас — ол маркермен белгіленеді. Белгіні алу үшін қайта бас.',
    step2: 'Шарттан керек деректерді белгіле', noQuote: 'Деректер әзірге белгіленбеген.',
    needBoth: 'Тексеру үшін жауапты таңдап, деректі кемінде бір жолды белгіле.',
    solved: 'Тамаша: жауап деректермен негізделді.', sentence: 'Жол', textLabel: 'Шарт',
    doneLead: 'Барлық тапсырма орындалды: жауаптар таңдалып, шарттағы деректермен негізделді.',
    retry: 'Айқышпен белгіленгенді түзетіп, қайта тексер.',
    retryAdd: 'Белгіленген деректерді қалдырып, жетпейтін шаманы қос та, қайта тексер.',
  },
} as const;

/** Итоги проверки в математике: «данные» вместо «цитат»; при нехватке — какую величину найти (подсказка задания). */
const MATH_PARTS = {
  ru: { correct: 'Данные выбраны верно', missing: 'Данных пока не хватает', extra: 'Лишнее данное', wrong: 'Эти данные не нужны для ответа', empty: 'Данные не отмечены', find: 'Найди, какой величины не хватает:', calc: 'Расчёт' },
  kk: { correct: 'Деректер дұрыс таңдалды', missing: 'Деректер әзірге жеткіліксіз', extra: 'Артық дерек', wrong: 'Бұл деректер жауапқа керек емес', empty: 'Деректер белгіленбеген', find: 'Қай шама жетпейтінін тап:', calc: 'Есептеу' },
} as const;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

/** ok — верно; partial — верно, но неполно (не хватает ещё одной цитаты); bad — неверно. */
function Mark({ ok, partial = false, testId }: { ok: boolean; partial?: boolean; testId?: string }) {
  const state = ok ? 'ok' : partial ? 'partial' : 'bad';
  return (
    <span aria-hidden="true" data-testid={testId} data-state={state}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-card ${state === 'ok' ? 'bg-ok' : state === 'partial' ? 'bg-warn' : 'bg-bad'}`}>
      <Icon name={state === 'ok' ? 'check' : state === 'partial' ? 'plus' : 'x'} className="h-4 w-4" />
    </span>
  );
}

const PROOF_TEST = {
  ru: {
    title: 'Проверка на прочность',
    choose: 'Выбери одну цитату, которую хочешь убрать.',
    question: 'Хватит ли остальных цитат, чтобы доказать ответ?',
    keep: 'Оставшихся хватит',
    need: 'Нужны ещё цитаты',
    yes: 'Оставшиеся цитаты образуют другой допустимый набор доказательств.',
    no: 'Без этой цитаты доказательство неполное. Вернись к тексту и подумай, какую деталь она добавляет.',
    expectedYes: 'Верный вывод:',
    expectedNo: 'Перепроверь:',
  },
  kk: {
    title: 'Дәлелді сынап көр',
    choose: 'Алып тастағың келген бір сөйлемді таңда.',
    question: 'Қалған сөйлемдер жауапты дәлелдеуге жете ме?',
    keep: 'Қалғаны жеткілікті',
    need: 'Тағы сөйлем керек',
    yes: 'Қалған сөйлемдер де жауапты дәлелдейді.',
    no: 'Бұл сөйлемсіз дәлел толық болмайды. Мәтінге қайта қарап, оның қандай мәлімет қосатынын ойлан.',
    expectedYes: 'Дұрыс қорытынды:',
    expectedNo: 'Қайта тексер:',
  },
} as const;

const PROOF_TEST_MATH = {
  ru: {
    choose: 'Убери одно исходное данное.',
    question: 'Можно ли без него всё ещё обосновать ответ?',
    keep: 'Можно, данных хватит',
    need: 'Нельзя, без него не посчитать',
    yes: 'Оставшихся данных хватает: это другой допустимый набор.',
    no: 'Без этого данного ответ не получить. Подумай, какую величину оно даёт для расчёта.',
  },
  kk: {
    choose: 'Бір бастапқы деректі алып таста.',
    question: 'Онсыз жауапты әлі де негіздеуге бола ма?',
    keep: 'Болады, деректер жеткілікті',
    need: 'Болмайды, онсыз есептей алмаймын',
    yes: 'Қалған деректер жеткілікті: бұл басқа рұқсат етілген жиын.',
    no: 'Бұл деректерсіз жауап шықпайды. Ол есептеуге қандай шама беретінін ойлан.',
  },
} as const;

function ProofTest({ task, lesson, evidence, order }: { task: Task; lesson: Lesson; evidence: string[]; order: Map<string, number> }) {
  const t: Record<keyof typeof PROOF_TEST.ru, string> = subjectOf(lesson) === 'math' ? { ...PROOF_TEST[lesson.language], ...PROOF_TEST_MATH[lesson.language] } : PROOF_TEST[lesson.language];
  const [removed, setRemoved] = useState<string | null>(null);
  const [guess, setGuess] = useState<boolean | null>(null);
  const remaining = evidence.filter((id) => id !== removed);
  const enough = checkAnswer(task, task.correctOptionId, remaining).solved;
  return (
    <details className="group rounded-control border border-line-strong/50 bg-sunken p-4" data-testid="proof-test">
      <summary className="-m-1 flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-chip p-1 font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="search" className="h-5 w-5 text-brand-ink" />{t.title}
        <Icon name="arrow-down" className="ml-auto h-4 w-4 text-muted transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <fieldset className="mt-3 min-w-0 space-y-2">
        <legend className="text-sm font-medium">{t.choose}</legend>
        {evidence.map((id) => (
          <label key={id} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-chip p-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-brand-ink ${removed === id ? 'bg-card text-muted line-through' : 'hover:bg-card'}`}>
            <input type="radio" name="removed-quote" checked={removed === id}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" data-testid={`proof-remove-${id}`}
              onChange={() => { setRemoved(id); setGuess(null); }} />
            <span className="wrap-any min-w-0">{(order.get(id) ?? 0) + 1}. {lesson.sentences.find((s) => s.id === id)?.text}</span>
          </label>
        ))}
      </fieldset>
      {removed && (
        <div className="mt-2 space-y-2">
          <p className="text-sm">{t.question}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost btn-sm" data-testid="proof-enough" onClick={() => setGuess(true)}>{t.keep}</button>
            <button type="button" className="btn-ghost btn-sm" data-testid="proof-insufficient" onClick={() => setGuess(false)}>{t.need}</button>
          </div>
          {guess !== null && (
            <p className={`note ${guess === enough ? 'note-ok' : 'note-warn'}`} role="status" data-testid="proof-feedback" data-correct={guess === enough}>
              <Icon name={guess === enough ? 'check' : 'alert'} className="mt-px h-5 w-5" />
              <span><b>{guess === enough ? t.expectedYes : t.expectedNo}</b> {enough ? t.yes : t.no}</span>
            </p>
          )}
        </div>
      )}
    </details>
  );
}

function Player({ play, all, onExit, onPlay }: { play: Play; all: Lesson[]; onExit: () => void; onPlay: (p: Play) => void }) {
  const { lesson } = play;
  const tasks = useMemo(() => play.taskIds.map((id) => lesson.tasks.find((x) => x.id === id)).filter((x): x is Task => !!x), [play, lesson]);
  const [idx, setIdx] = useState(() => Math.min(play.startIdx ?? 0, Math.max(0, tasks.length - 1)));
  const [option, setOption] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [checking, setChecking] = useState(false);
  const writingAttempt = useRef(false);
  const [showHint, setShowHint] = useState(false);
  const [finished, setFinished] = useState(false);
  const [hadErrors, setHadErrors] = useState(false);
  const [rec, setRec] = useState<ReturnType<typeof recommendNext> | 'unavailable'>();
  const textRef = useRef<HTMLElement>(null);
  const questionRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const task = tasks[idx];
  const lang = lesson.language;
  const math = subjectOf(lesson) === 'math';
  const t: Record<keyof typeof PLAYER_TEXT.ru, string> = math ? { ...PLAYER_TEXT[lang], ...MATH_TEXT[lang] } : PLAYER_TEXT[lang];
  const order = new Map(lesson.sentences.map((s, i) => [s.id, i]));

  useEffect(() => {
    if (!finished) return;
    let active = true;
    setRec(undefined);
    void db.transaction('r', db.attempts, async () => {
      const attempts = await db.attempts.where('lessonId').equals(lesson.id).toArray();
      return { next: recommendNext(all, lesson, attempts, await solvedKeys()), hadErrors: attempts.some((a) => !a.solved) };
    }).then(
      ({ next, hadErrors: errs }) => { if (active) { setHadErrors(errs); setRec(next); } },
      () => { if (active) setRec('unavailable'); },
    );
    return () => { active = false; };
  }, [finished, all, lesson]);

  // Новое задание на телефоне: показываем вопрос с начала (текст ниже, к нему ведёт «К тексту»).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (window.innerWidth < 1024) questionRef.current?.scrollIntoView({ block: 'start' });
  }, [idx, finished]);

  async function check() {
    if (!task || !option || !evidence.length || writingAttempt.current) return;
    writingAttempt.current = true;
    setChecking(true);
    setSaveError(false);
    setResult(null);
    const r = checkAnswer(task, option, evidence);
    // Сначала записываем попытку, потом показываем итог: «Засчитано» на экране = прогресс уже в IndexedDB.
    try {
      await db.attempts.add({ lessonId: lesson.id, taskId: task.id, skill: task.skill, optionId: option, evidence, answerCorrect: r.answerCorrect, evidenceOk: r.evidence === 'correct', solved: r.solved, at: Date.now() });
      setResult(r);
    } catch {
      setSaveError(true);
    } finally {
      writingAttempt.current = false;
      setChecking(false);
    }
  }
  function next() {
    setOption(null); setEvidence([]); setResult(null); setShowHint(false);
    if (idx + 1 < tasks.length) setIdx(idx + 1); else setFinished(true);
  }
  // Исправление цитаты не сбрасывает выбранный ответ (и наоборот).
  const toggle = (id: string) => {
    if (result?.solved || writingAttempt.current) return;
    setResult(null);
    setEvidence((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))));
  };
  const goText = () => { textRef.current?.scrollIntoView({ block: 'start' }); textRef.current?.focus({ preventScroll: true }); };
  const goQuestion = () => { questionRef.current?.scrollIntoView({ block: 'start' }); questionRef.current?.focus({ preventScroll: true }); };
  const baseParts = result && task ? feedbackParts(lang, result, task) : null;
  // Математика: те же два итога, но про данные; при нехватке данных — подсказка, какую величину найти.
  const parts = baseParts && result && task && math
    ? {
        ...baseParts,
        evidence: MATH_PARTS[lang][result.evidence],
        tip: result.evidence === 'missing' ? [result.answerCorrect ? '' : baseParts.tip, `${MATH_PARTS[lang].find} ${task.hint}`].filter(Boolean).join(' ') : baseParts.tip,
      }
    : baseParts;
  const isLast = idx + 1 >= tasks.length;

  return (
    <div className="pt-4 sm:pt-8" lang={lang}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-ghost btn-sm" onClick={onExit}>← {t.back}</button>
        <span className="flex flex-wrap gap-2">
          <span className="badge text-ink">{LANG_NAME[lang]}</span>
          <span className="badge">{fill(t.grade, { g: lesson.grade })}</span>
        </span>
      </div>
      <h1 className="wrap-any mt-5 font-serif text-title font-semibold">{lesson.title}</h1>
      {!finished && task && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span className="flex max-w-full flex-wrap gap-1" aria-hidden="true">
            {tasks.map((x, k) => <span key={x.id} className={`h-2 w-8 rounded-full ${k < idx ? 'bg-brand' : k === idx ? 'bg-brand/45 ring-1 ring-brand-ink ring-offset-1 ring-offset-paper' : 'border border-line-strong/50 bg-sunken'}`} />)}
          </span>
          <span className="tabular-nums"><b className="font-semibold text-ink">{fill(t.task, { n: idx + 1, total: tasks.length })}</b> · {skillLabel(subjectOf(lesson), lang, task.skill)}</span>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:items-start lg:gap-8">

        <section ref={questionRef} tabIndex={-1} className="card scroll-mt-4 p-5 sm:p-7 lg:sticky lg:top-4" aria-label={task?.question}>
          {finished ? (
            <div data-testid="finished" className="space-y-5">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ok text-card" aria-hidden="true"><Icon name="check" className="h-8 w-8" /></span>
              <div>
                <p className="font-serif text-title font-semibold">{t.done}</p>
                <p className="mt-2 text-muted">{t.doneLead}</p>
              </div>
              {rec === undefined ? (
                <p className="flex items-center gap-2 text-sm text-muted" role="status" data-testid="recommendation-loading"><Spinner />{t.recLoading}</p>
              ) : rec === 'unavailable' ? (
                <p className="note note-warn" role="status"><Icon name="alert" className="mt-px h-5 w-5" /><span>{t.recError}</span></p>
              ) : rec ? (
                <div className="rounded-control border border-line bg-sunken p-4" data-testid="recommendation">
                  <p className="kicker">{t.recTitle}</p>
                  <p className="mt-2 text-sm">{t.weak} <b>{skillLabel(subjectOf(lesson), lang, rec.skill)}</b></p>
                  <p className="wrap-any mt-1 text-sm text-muted">«{rec.task.question}» — {rec.lesson.title}</p>
                  <button type="button" className="btn mt-4" data-testid="rec-start" onClick={() => onPlay({ lesson: rec.lesson, taskIds: [rec.task.id] })}>{t.more} <Icon name="arrow-right" /></button>
                </div>
              ) : <p className={`note ${hadErrors ? 'note-info' : 'note-ok'}`} data-testid="no-recommendation" data-had-errors={hadErrors}><Icon name={hadErrors ? 'info' : 'check'} className="mt-px h-5 w-5" /><span>{hadErrors ? t.noRecYet : t.noRec}</span></p>}
              <button type="button" className={rec && rec !== 'unavailable' ? 'btn-ghost' : 'btn'} onClick={onExit}>{t.back}</button>
            </div>
          ) : task ? (
            <div className="space-y-6">
              <p className="wrap-any font-serif text-subheading font-semibold sm:text-[1.375rem] sm:leading-snug" data-testid="question">{task.question}</p>

              <fieldset className="min-w-0">
                <legend className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
                  <span className="step-dot h-6 w-6 text-xs" aria-hidden="true">1</span>{t.step1}
                </legend>
                <div className="space-y-2">
                  {task.options.map((o) => {
                    const sel = option === o.id;
                    return (
                      <label key={o.id} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-ink ${sel ? 'border-brand-ink bg-brand-soft' : 'border-line-strong/50 hover:border-brand-ink/60 hover:bg-sunken'} ${result?.solved ? 'cursor-default' : ''}`}>
                        <input type="radio" name="opt" data-testid={`opt-${o.id}`} checked={sel} disabled={checking || !!result?.solved}
                          onChange={() => { setOption(o.id); setResult(null); }} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" />
                        <span className={`wrap-any ${sel ? 'font-medium' : ''}`}>{o.text}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <p className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
                  <span className="step-dot h-6 w-6 text-xs" aria-hidden="true">2</span>{t.step2}
                </p>
                {evidence.length === 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-dashed border-line-strong/60 p-3 text-sm text-muted" data-testid="quotes-empty">
                    <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3.5 w-5 rounded-[3px] bg-marker" />{t.noQuote}</span>
                    <button type="button" className="btn-ghost btn-sm lg:hidden" data-testid="to-text" onClick={goText}>{t.toText}</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <ul className="space-y-2" data-testid="quotes">
                      {evidence.map((sid) => {
                        const n = (order.get(sid) ?? 0) + 1;
                        const s = lesson.sentences.find((x) => x.id === sid);
                        return (
                          <li key={sid} className="flex items-start gap-2 rounded-control bg-marker py-2 pl-2.5 pr-1 text-sm text-marker-ink">
                            <span className="sent-num mt-0.5 border-transparent bg-ink text-paper tabular-nums">{n}</span>
                            <span className="wrap-any line-clamp-2 min-w-0 flex-1 font-serif">{s?.text}</span>
                            {!result?.solved && (
                              <button type="button" className="-my-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-chip hover:bg-marker-ink/10" aria-label={fill(t.remove, { n })} disabled={checking} onClick={() => toggle(sid)}>
                                <Icon name="x" className="h-4 w-4" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {!result?.solved && <button type="button" className="btn-ghost btn-sm lg:hidden" data-testid="to-text" onClick={goText}>{t.toText}</button>}
                  </div>
                )}
              </div>

              {result && parts && (
                <div role="status" data-testid="feedback" data-solved={result.solved} data-evidence={result.evidence} data-answer={result.answerCorrect}
                  className={`space-y-2.5 rounded-control border p-4 ${result.solved ? 'border-ok/50 bg-ok-soft' : 'border-line-strong/50 bg-sunken'}`}>
                  {result.solved && <p className="font-serif text-subheading font-semibold text-ok">{t.solved}</p>}
                  <p className="flex items-center gap-2.5 font-medium">
                    <Mark ok={result.answerCorrect} /><span data-testid="feedback-answer" data-ok={result.answerCorrect}>{parts.answer}</span>
                  </p>
                  <p className="flex items-center gap-2.5 font-medium">
                    <Mark ok={result.evidence === 'correct'} partial={result.evidence === 'missing'} testId="feedback-evidence-mark" /><span data-testid="feedback-evidence" data-ok={result.evidence === 'correct'}>{parts.evidence}</span>
                  </p>
                  {parts.tip && <p className="flex items-start gap-2.5 text-sm text-ink" ><Icon name="bulb" className="mt-px h-5 w-5 text-warn" /><span data-testid="feedback-tip">{parts.tip}</span></p>}
                  {!result.solved && <p className="pl-[34px] text-sm text-muted" data-testid="feedback-retry">{result.answerCorrect && result.evidence === 'missing' ? t.retryAdd : t.retry}</p>}
                </div>
              )}
              {result?.solved && math && task.solution && (
                <div className="note note-ok" data-testid="solution" lang={lang}>
                  <Icon name="check" className="mt-px h-5 w-5" />
                  <p><b>{MATH_PARTS[lang].calc}:</b> <span className="tabular-nums">{nbspNumbers(task.solution)}</span></p>
                </div>
              )}
              {result?.solved && evidence.length > 1 && <ProofTest task={task} lesson={lesson} evidence={evidence} order={order} />}
              {saveError && <p role="alert" data-testid="attempt-save-error" className="note note-bad"><Icon name="alert" className="mt-px h-5 w-5" /><span>{t.saveError}</span></p>}
              {showHint && <p className="note border-l-4 border-marker bg-sunken text-ink" data-testid="hint"><Icon name="bulb" className="mt-px h-5 w-5 text-warn" /><span>{task.hint}</span></p>}
              {!result && (!option || evidence.length === 0) && <p className="text-sm text-muted">{t.needBoth}</p>}
              <div className="flex flex-wrap gap-2">
                {result?.solved
                  ? <button type="button" className="btn btn-lg w-full sm:w-auto" data-testid="next" onClick={next}>{isLast ? t.finish : t.next} <Icon name="arrow-right" /></button>
                  : <button type="button" className="btn" data-testid="check" disabled={checking || !option || evidence.length === 0} onClick={() => void check()}>{checking && <Spinner />}{checking ? t.saving : (result || saveError) ? t.recheck : t.check}</button>}
                {!result?.solved && !showHint && <button type="button" className="btn-ghost" onClick={() => setShowHint(true)}><Icon name="bulb" className="h-4 w-4" />{t.hint}</button>}
              </div>
            </div>
          ) : null}
        </section>

        <article ref={textRef} tabIndex={-1} id="lesson-text" className="card scroll-mt-4 p-5 sm:p-8 lg:order-first" data-testid="text" aria-label={t.textLabel}>
          {!finished && (
            <p className="mb-5 flex items-start gap-2.5 rounded-control bg-sunken p-3 text-sm text-muted" data-testid="text-hint">
              <span aria-hidden="true" className="mt-0.5 inline-block h-4 w-6 shrink-0 rounded-[3px] bg-marker" />
              <span>{t.textHint}</span>
            </p>
          )}
          <p className="wrap-any max-w-measure font-serif text-[1.125rem] leading-[1.9] sm:text-reading">
            {lesson.sentences.map((s, i) => {
              const on = evidence.includes(s.id);
              return (
                <span key={s.id}>
                  <button type="button" data-testid={`sent-${s.id}`} aria-pressed={on} disabled={finished || checking || !!result?.solved} onClick={() => toggle(s.id)} className="sent">
                    <span className="sent-num" aria-hidden="true">{on ? '✓' : i + 1}</span>
                    <span className="sr-only">{t.sentence} {i + 1}: </span>{s.text}
                  </button>{' '}
                </span>
              );
            })}
          </p>
          {!finished && (
            <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex items-center justify-between gap-3 rounded-b-card border-t border-line bg-card/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:-mb-8 sm:px-8 lg:hidden">
              <span className="flex items-center gap-2 text-sm text-muted" data-testid="marked-count"><span aria-hidden="true" className="inline-block h-3.5 w-5 rounded-[3px] bg-marker" />{fill(t.marked, { n: evidence.length })}</span>
              <button type="button" className="btn-ghost btn-sm" data-testid="to-question" onClick={goQuestion}>{t.toQuestion}</button>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
