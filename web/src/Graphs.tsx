// «Графики» в разделе «Математика»: построить самому (до трёх функций) и задание про два тарифа.
// Формулы разбираются собственным парсером (shared/graphExpr.ts), всё хранится локально и работает офлайн.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { compile, intersectNear, niceStep, parseErrorText, sample, sameFunction, type AngleMode, type View } from '../../shared/graphExpr';
import type { Language } from '../../shared/lesson';
import { nbspNumbers } from '../../shared/math';
import { useI18n } from './i18n';
import { Icon } from './Icon';

export interface Func { expr: string; visible: boolean }
interface FreeState { funcs: Func[]; angle: AngleMode; view: View }
interface TaskState { funcs: Func[]; px: string; py: string; choice: string | null; checked: boolean }
interface Saved { free: FreeState; task: TaskState; mode: 'free' | 'task' }

const MAX_FUNCS = 3;
const STORAGE_KEY = 'oqy-graphs-v1';
const DEFAULT_VIEW: View = { xmin: -10, xmax: 10, ymin: -7, ymax: 7 };
/** Масштаб задачи про тарифы: видны обе линии и пересечение. */
export const TASK_VIEW: View = { xmin: -2, xmax: 42, ymin: -400, ymax: 7000 };
const EXAMPLES = ['y = 2x + 1', 'y = x^2', 'y = sin(x)', 'y = cos(x)'];
const DASH: number[][] = [[], [9, 5], [2, 5]];
const COLOR_VARS = ['--brand', '--bad', '--ok'];

const TASK = {
  single: '150x',
  pass: '2000 + 50x',
  point: { x: 20, y: 3000 },
  trips: 30,
  correct: 'pass',
} as const;

const TEXT = {
  ru: {
    free: 'Построить самому', task: 'Задание', add: 'Добавить функцию', hide: 'Скрыть', show: 'Показать', remove: 'Удалить',
    funcLabel: 'Функция {n}', examples: 'Примеры:', angle: 'Углы', deg: 'градусы', rad: 'радианы',
    zoomIn: 'Приблизить', zoomOut: 'Отдалить', reset: 'Исходный масштаб', point: 'Выбранная точка', pointOn: 'на линии {n}',
    intersection: 'точка пересечения', noPoint: 'Нажмите на линию, чтобы увидеть координаты точки.',
    plotLabel: 'График. Перетащите, чтобы сдвинуть; колесо мыши или кнопки + и − меняют масштаб; стрелки сдвигают с клавиатуры.',
    max: 'Не больше трёх функций.', keys: 'Вставить',
    taskTitle: 'Разовые билеты или проездной?',
    taskText: [
      'Разовый билет на автобус стоит 150 ₸ за поездку.',
      'Проездной стоит 2 000 ₸ в месяц, и с ним каждая поездка стоит ещё 50 ₸.',
      'Пусть x — число поездок в месяц, y — расходы в тенге за месяц.',
    ],
    step1: 'Постройте обе линии: расходы с разовыми билетами и с проездным.',
    step2: 'Найдите точку пересечения (нажмите рядом с ней на графике) и запишите координаты.',
    step3: 'Ученик ездит 30 раз в месяц. Что выгоднее?',
    px: 'x — поездок', py: 'y — тенге',
    opts: { single: 'Разовые билеты', pass: 'Проездной', equal: 'Одинаково' } as Record<string, string>,
    check: 'Проверить', linesOk: 'Обе линии построены', linesBad: 'Постройте обе линии: y = 150x и y = 2000 + 50x (можно записать по-другому)',
    pointOk: 'Точка пересечения найдена верно', pointBad: 'Точка пересечения пока неверна — нажмите на график рядом с пересечением линий',
    choiceOk: 'Вывод верный', choiceBad: 'Вывод пока неверный — сравните линии при x = 30',
    openGraph: 'Открыть в «Построить самому»',
    explain: '150x = 2000 + 50x → 100x = 2000 → x = 20, y = 3 000 ₸. До 20 поездок дешевле разовые билеты, после 20 — проездной. При 30 поездках: разовые — 30 × 150 = 4 500 ₸, проездной — 2 000 + 30 × 50 = 3 500 ₸. Выгоднее проездной.',
  },
  kk: {
    free: 'Өзің сал', task: 'Тапсырма', add: 'Функция қосу', hide: 'Жасыру', show: 'Көрсету', remove: 'Өшіру',
    funcLabel: '{n}-функция', examples: 'Мысалдар:', angle: 'Бұрыштар', deg: 'градус', rad: 'радиан',
    zoomIn: 'Жақындату', zoomOut: 'Алыстату', reset: 'Бастапқы масштаб', point: 'Таңдалған нүкте', pointOn: '{n}-сызықта',
    intersection: 'қиылысу нүктесі', noPoint: 'Нүктенің координаталарын көру үшін сызықты басыңыз.',
    plotLabel: 'График. Жылжыту үшін сүйреңіз; масштабты тінтуір дөңгелегі немесе + және − батырмалары өзгертеді; пернетақтадан бағыттауыштармен жылжытыңыз.',
    max: 'Үш функциядан артық емес.', keys: 'Қою',
    taskTitle: 'Бір реттік билет пе, жол жүру билеті ме?',
    taskText: [
      'Автобустың бір реттік билеті бір сапарға 150 ₸ тұрады.',
      'Жол жүру билеті айына 2 000 ₸ тұрады, онымен әр сапар тағы 50 ₸.',
      'x — айдағы сапарлар саны, y — айлық шығын (теңге).',
    ],
    step1: 'Екі сызықты да салыңыз: бір реттік билетпен және жол жүру билетімен шығын.',
    step2: 'Қиылысу нүктесін табыңыз (графикте соның жанын басыңыз) және координаталарын жазыңыз.',
    step3: 'Оқушы айына 30 рет жүреді. Қайсысы тиімді?',
    px: 'x — сапар', py: 'y — теңге',
    opts: { single: 'Бір реттік билеттер', pass: 'Жол жүру билеті', equal: 'Бірдей' } as Record<string, string>,
    check: 'Тексеру', linesOk: 'Екі сызық та салынды', linesBad: 'Екі сызықты салыңыз: y = 150x және y = 2000 + 50x (басқаша жазуға болады)',
    pointOk: 'Қиылысу нүктесі дұрыс табылды', pointBad: 'Қиылысу нүктесі әзірге қате — графикте сызықтар қиылысатын жерді басыңыз',
    choiceOk: 'Қорытынды дұрыс', choiceBad: 'Қорытынды әзірге қате — x = 30 кезіндегі сызықтарды салыстырыңыз',
    openGraph: '«Өзің сал» бөлімінде ашу',
    explain: '150x = 2000 + 50x → 100x = 2000 → x = 20, y = 3 000 ₸. 20 сапарға дейін бір реттік билет арзан, 20-дан кейін — жол жүру билеті. 30 сапарда: бір реттік — 30 × 150 = 4 500 ₸, жол жүру билеті — 2 000 + 30 × 50 = 3 500 ₸. Жол жүру билеті тиімді.',
  },
} as const;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return (Object.is(r, -0) ? 0 : r).toLocaleString('ru-RU', { maximumFractionDigits: 3 }).replace(/ /g, ' ');
};
const parseNum = (s: string) => { const v = Number(s.replace(/\s/g, '').replace(',', '.')); return s.trim() && Number.isFinite(v) ? v : null; };

function defaults(): Saved {
  return {
    mode: 'free',
    free: { funcs: [{ expr: 'y = 2x + 1', visible: true }, { expr: 'y = x^2', visible: true }], angle: 'rad', view: DEFAULT_VIEW },
    task: { funcs: [{ expr: '', visible: true }, { expr: '', visible: true }], px: '', py: '', choice: null, checked: false },
  };
}
function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const d = defaults(), s = JSON.parse(raw) as Partial<Saved>;
    const okView = (v: unknown): v is View => !!v && ['xmin', 'xmax', 'ymin', 'ymax'].every((k) => Number.isFinite((v as Record<string, number>)[k]));
    const okFuncs = (f: unknown): f is Func[] => Array.isArray(f) && f.length <= MAX_FUNCS && f.every((x) => x && typeof x.expr === 'string' && typeof x.visible === 'boolean');
    return {
      mode: s.mode === 'task' ? 'task' : 'free',
      free: { funcs: okFuncs(s.free?.funcs) ? s.free!.funcs : d.free.funcs, angle: s.free?.angle === 'deg' ? 'deg' : 'rad', view: okView(s.free?.view) ? s.free!.view : d.free.view },
      task: { ...d.task, ...(s.task && okFuncs(s.task.funcs) ? s.task : {}) },
    };
  } catch { return defaults(); }
}

const cssColor = (name: string, alpha = 1) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v} / ${alpha})` : `rgba(0,0,0,${alpha})`;
};

type Compiled = { f: ((x: number) => number) | null; error: string | null };

/** Холст графика: сетка, оси, линии с разрывами, выбранная точка; сдвиг, масштаб, выбор точки, клавиатура. */
function Plot({ funcs, compiled, view, onView, testId }: { funcs: Func[]; compiled: Compiled[]; view: View; onView: (v: View) => void; testId: string }) {
  const { lang } = useI18n();
  const t = TEXT[lang];
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Ширина берётся из контейнера (холст 100 % ширины): фиксированная стартовая ширина распирала страницу на телефоне.
  const [size, setSize] = useState({ w: 320, h: 260 });
  const [picked, setPicked] = useState<{ x: number; y: number; line: number; cross: boolean } | null>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(220, Math.min(560, e.contentRect.width * 0.7)) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toPx = (x: number, y: number) => ({ px: ((x - view.xmin) / (view.xmax - view.xmin)) * size.w, py: size.h - ((y - view.ymin) / (view.ymax - view.ymin)) * size.h });
  const toWorld = (px: number, py: number) => ({ x: view.xmin + (px / size.w) * (view.xmax - view.xmin), y: view.ymin + ((size.h - py) / size.h) * (view.ymax - view.ymin) });

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssColor('--card'); g.fillRect(0, 0, size.w, size.h);
    const sx = niceStep(view.xmax - view.xmin), sy = niceStep(view.ymax - view.ymin, 7);
    g.lineWidth = 1; g.strokeStyle = cssColor('--line', 0.9);
    g.font = '12px "Golos Text Variable", system-ui, sans-serif'; g.fillStyle = cssColor('--muted');
    const o = toPx(0, 0);
    for (let x = Math.ceil(view.xmin / sx) * sx; x <= view.xmax; x += sx) {
      const { px } = toPx(x, 0); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, size.h); g.stroke();
      if (Math.abs(x) > sx / 2) g.fillText(fmt(x), px + 3, Math.min(size.h - 4, Math.max(14, o.py + 14)));
    }
    for (let y = Math.ceil(view.ymin / sy) * sy; y <= view.ymax; y += sy) {
      const { py } = toPx(0, y); g.beginPath(); g.moveTo(0, py); g.lineTo(size.w, py); g.stroke();
      if (Math.abs(y) > sy / 2) g.fillText(fmt(y), Math.min(size.w - 40, Math.max(3, o.px + 4)), py - 3);
    }
    g.strokeStyle = cssColor('--ink', 0.75); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, o.py); g.lineTo(size.w, o.py); g.moveTo(o.px, 0); g.lineTo(o.px, size.h); g.stroke();
    funcs.forEach((fn, i) => {
      const f = compiled[i]?.f;
      if (!fn.visible || !f) return;
      g.strokeStyle = cssColor(COLOR_VARS[i]!); g.lineWidth = 2.5; g.setLineDash(DASH[i]!);
      for (const seg of sample(f, view, Math.round(size.w * 1.5))) {
        g.beginPath();
        seg.forEach((p, k) => { const q = toPx(p.x, p.y); const cy = Math.max(-1e4, Math.min(1e4, q.py)); if (k) g.lineTo(q.px, cy); else g.moveTo(q.px, cy); });
        g.stroke();
      }
      g.setLineDash([]);
    });
    if (picked) {
      const q = toPx(picked.x, picked.y);
      g.fillStyle = cssColor('--marker'); g.strokeStyle = cssColor('--ink'); g.lineWidth = 2;
      g.beginPath(); g.arc(q.px, q.py, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }, [funcs, compiled, view, size, picked]);

  const zoom = (k: number, cx = (view.xmin + view.xmax) / 2, cy = (view.ymin + view.ymax) / 2) =>
    onView({ xmin: cx - (cx - view.xmin) * k, xmax: cx + (view.xmax - cx) * k, ymin: cy - (cy - view.ymin) * k, ymax: cy + (view.ymax - cy) * k });
  const pan = (dx: number, dy: number) => onView({ xmin: view.xmin + dx, xmax: view.xmax + dx, ymin: view.ymin + dy, ymax: view.ymax + dy });

  function pick(px: number, py: number) {
    const w = toWorld(px, py);
    const near: { i: number; d: number; y: number }[] = [];
    funcs.forEach((fn, i) => {
      const f = compiled[i]?.f; if (!fn.visible || !f) return;
      const y = f(w.x); if (!Number.isFinite(y)) return;
      const d = Math.abs(toPx(w.x, y).py - py);
      if (d < 28) near.push({ i, d, y });
    });
    if (!near.length) { setPicked(null); return; }
    // Рядом с пересечением двух линий точка «прилипает» к нему (как инструмент «Пересечение»).
    const span = ((view.xmax - view.xmin) * 24) / size.w;
    for (let a = 0; a < funcs.length; a++) for (let b = a + 1; b < funcs.length; b++) {
      const fa = compiled[a]?.f, fb = compiled[b]?.f;
      if (!fa || !fb || !funcs[a]!.visible || !funcs[b]!.visible) continue;
      const p = intersectNear(fa, fb, w.x, span);
      if (p) { const q = toPx(p.x, p.y); if (Math.hypot(q.px - px, q.py - py) < 30) { setPicked({ x: p.x, y: p.y, line: a, cross: true }); return; } }
    }
    const best = near.sort((a, b) => a.d - b.d)[0]!;
    setPicked({ x: w.x, y: best.y, line: best.i, cross: false });
  }

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view, moved: false }; };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const kx = (d.view.xmax - d.view.xmin) / size.w, ky = (d.view.ymax - d.view.ymin) / size.h;
    onView({ xmin: d.view.xmin - dx * kx, xmax: d.view.xmax - dx * kx, ymin: d.view.ymin + dy * ky, ymax: d.view.ymax + dy * ky });
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved) { const r = e.currentTarget.getBoundingClientRect(); pick(e.clientX - r.left, e.clientY - r.top); }
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const sx = (view.xmax - view.xmin) / 10, sy = (view.ymax - view.ymin) / 10;
    const act: Record<string, () => void> = { ArrowLeft: () => pan(-sx, 0), ArrowRight: () => pan(sx, 0), ArrowUp: () => pan(0, sy), ArrowDown: () => pan(0, -sy), '+': () => zoom(0.8), '=': () => zoom(0.8), '-': () => zoom(1.25) };
    const a = act[e.key]; if (a) { e.preventDefault(); a(); }
  };

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(); const w = toWorld(e.clientX - r.left, e.clientY - r.top);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, w.x, w.y);
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  });

  return (
    <div className="min-w-0 space-y-2">
      <div ref={wrap} className="relative w-full min-w-0 overflow-hidden rounded-control border border-line-strong/50" data-testid={testId}
        data-view={`${fmt(view.xmin)};${fmt(view.xmax)};${fmt(view.ymin)};${fmt(view.ymax)}`}>
        <canvas ref={canvas} style={{ width: '100%', height: size.h, touchAction: 'none' }} tabIndex={0} role="img" aria-label={t.plotLabel}
          className="block cursor-crosshair focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-brand-ink"
          data-testid={`${testId}-canvas`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onKeyDown={onKey} />
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" className="btn-ghost btn-sm h-9 w-9 justify-center bg-card p-0" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => zoom(0.8)} data-testid={`${testId}-zoom-in`}><Icon name="plus" className="h-4 w-4" /></button>
          <button type="button" className="btn-ghost btn-sm h-9 w-9 justify-center bg-card p-0" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => zoom(1.25)} data-testid={`${testId}-zoom-out`}><Icon name="minus" className="h-4 w-4" /></button>
        </div>
      </div>
      <p className="text-sm tabular-nums" role="status" aria-live="polite" data-testid={`${testId}-point`}
        data-x={picked ? picked.x : ''} data-y={picked ? picked.y : ''} data-cross={picked?.cross ?? false}>
        {picked
          ? <><b>{t.point}:</b> ({fmt(picked.x)}; {fmt(picked.y)}) — {picked.cross ? t.intersection : fill(t.pointOn, { n: picked.line + 1 })}</>
          : <span className="text-muted">{t.noPoint}</span>}
      </p>
    </div>
  );
}

/** Строки ввода функций: скрыть, удалить, кнопки sin/cos/tan/√/π, подсказки об ошибках. */
function FuncList({ funcs, compiled, onChange, prefix, allowAdd = true }: { funcs: Func[]; compiled: Compiled[]; onChange: (f: Func[]) => void; prefix: string; allowAdd?: boolean }) {
  const { lang } = useI18n();
  const t = TEXT[lang];
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [focus, setFocus] = useState(0);
  // Курсор после вставки ставится сразу после обновления поля (до следующего ввода): с requestAnimationFrame
  // на медленном устройстве быстрый набор успевал раньше, и курсор отскакивал назад («sin()x»).
  const caret = useRef<{ i: number; pos: number } | null>(null);
  useLayoutEffect(() => {
    const c = caret.current; if (!c) return;
    caret.current = null;
    const el = inputs.current[c.i]; if (!el) return;
    el.focus(); el.setSelectionRange(c.pos, c.pos);
  });
  const set = (i: number, patch: Partial<Func>) => onChange(funcs.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  function insert(text: string) {
    const el = inputs.current[focus]; const cur = funcs[focus]; if (!cur) return;
    const at = el?.selectionStart ?? cur.expr.length, end = el?.selectionEnd ?? at;
    caret.current = { i: focus, pos: at + text.length };
    set(focus, { expr: cur.expr.slice(0, at) + text + cur.expr.slice(end) });
  }
  return (
    <div className="space-y-3">
      {funcs.map((fn, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="h-1 w-6 shrink-0 rounded-full" aria-hidden="true" style={{ background: `rgb(var(${COLOR_VARS[i]}))`, ...(i ? { backgroundImage: `repeating-linear-gradient(90deg, rgb(var(--card)) 0 ${i === 1 ? 5 : 2}px, transparent 0 ${i === 1 ? 9 : 5}px)` } : {}) }} />
            <label className="sr-only" htmlFor={`${prefix}-f-${i}`}>{fill(t.funcLabel, { n: i + 1 })}</label>
            <input id={`${prefix}-f-${i}`} ref={(el) => { inputs.current[i] = el; }} className={`input min-w-0 flex-1 font-mono ${compiled[i]?.error ? 'border-bad' : ''}`}
              value={fn.expr} placeholder="y = 2x + 1" spellCheck={false} autoCapitalize="off" inputMode="text"
              aria-invalid={!!compiled[i]?.error} aria-describedby={compiled[i]?.error ? `${prefix}-err-${i}` : undefined}
              onFocus={() => setFocus(i)} onChange={(e) => set(i, { expr: e.target.value })} data-testid={`${prefix}-f-${i}`} />
            {/* На узком экране — только значок (подпись остаётся для экранного диктора), чтобы формула не обрезалась. */}
            <button type="button" className="btn-ghost btn-sm h-9 min-w-9 justify-center px-2 sm:px-3" aria-pressed={!fn.visible} aria-label={`${fn.visible ? t.hide : t.show}: ${fill(t.funcLabel, { n: i + 1 })}`}
              title={fn.visible ? t.hide : t.show} onClick={() => set(i, { visible: !fn.visible })} data-testid={`${prefix}-hide-${i}`}>
              <Icon name={fn.visible ? 'eye' : 'eye-off'} className="h-4 w-4" /><span className="hidden sm:inline">{fn.visible ? t.hide : t.show}</span>
            </button>
            <button type="button" className="btn-ghost btn-sm btn-danger h-9 w-9 justify-center p-0" aria-label={`${t.remove}: ${fill(t.funcLabel, { n: i + 1 })}`} title={t.remove}
              onClick={() => onChange(funcs.filter((_, k) => k !== i))} data-testid={`${prefix}-del-${i}`}><Icon name="trash" className="h-4 w-4" /></button>
          </div>
          {compiled[i]?.error && <p id={`${prefix}-err-${i}`} className="pl-8 text-sm text-bad" role="alert" data-testid={`${prefix}-err-${i}`}>{compiled[i]!.error}</p>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-muted">{t.keys}:</span>
        {[['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['√', '√('], ['π', 'π'], ['x²', '^2']].map(([label, ins]) => (
          <button key={label} type="button" className="btn-ghost btn-sm min-w-11 justify-center font-mono" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(ins!)} data-testid={`${prefix}-key-${label}`}>{label}</button>
        ))}
        {allowAdd && funcs.length < MAX_FUNCS && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onChange([...funcs, { expr: '', visible: true }])} data-testid={`${prefix}-add`}><Icon name="plus" className="h-4 w-4" />{t.add}</button>
        )}
        {allowAdd && funcs.length >= MAX_FUNCS && <span className="text-sm text-muted">{t.max}</span>}
      </div>
    </div>
  );
}

const useCompiled = (funcs: Func[], angle: AngleMode, lang: Language): Compiled[] =>
  useMemo(() => funcs.map((fn) => {
    if (!fn.expr.trim()) return { f: null, error: null };
    const r = compile(fn.expr, angle);
    return r.ok ? { f: r.f, error: null } : { f: null, error: parseErrorText(lang, r.error) };
  }), [funcs, angle, lang]);

export function Graphs() {
  const { lang } = useI18n();
  const t = TEXT[lang];
  const [state, setState] = useState<Saved>(load);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* приватный режим */ } }, [state]);
  const free = state.free, task = state.task;
  const freeCompiled = useCompiled(free.funcs, free.angle, lang);
  const taskCompiled = useCompiled(task.funcs, 'rad', lang);
  const [taskView, setTaskView] = useState<View>(TASK_VIEW);
  const setFree = (p: Partial<FreeState>) => setState((s) => ({ ...s, free: { ...s.free, ...p } }));
  const setTask = (p: Partial<TaskState>) => setState((s) => ({ ...s, task: { ...s.task, ...p, checked: p.checked ?? false } }));

  // Проверка задания: линии, точка пересечения и вывод — отдельно.
  const result = useMemo(() => {
    const single = compile(TASK.single), pass = compile(TASK.pass);
    if (!single.ok || !pass.ok) return null;
    const built = taskCompiled.filter((c, i) => c.f && task.funcs[i]?.visible).map((c) => c.f!);
    const xs = [0, 7, 20, 33];
    const lines = built.some((f) => sameFunction(f, single.f, xs)) && built.some((f) => sameFunction(f, pass.f, xs));
    const x = parseNum(task.px), y = parseNum(task.py);
    const point = x !== null && y !== null && Math.abs(x - TASK.point.x) <= 0.5 && Math.abs(y - TASK.point.y) <= 50;
    return { lines, point, choice: task.choice === TASK.correct };
  }, [taskCompiled, task]);

  function openInFree() {
    setState((s) => ({ ...s, mode: 'free', free: { ...s.free, funcs: [{ expr: `y = ${TASK.single}`, visible: true }, { expr: `y = ${TASK.pass}`, visible: true }], view: TASK_VIEW } }));
  }

  return (
    <section className="space-y-5" aria-labelledby="graphs-title" data-testid="graphs">
      <div role="tablist" aria-label="Графики" className="inline-flex rounded-full border border-line-strong/50 bg-card p-1">
        {(['free', 'task'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={state.mode === m} data-testid={`graph-mode-${m}`}
            className={`min-h-10 rounded-full px-4 text-sm ${state.mode === m ? 'bg-ink font-semibold text-paper' : 'text-muted hover:bg-sunken hover:text-ink'}`}
            onClick={() => setState((s) => ({ ...s, mode: m }))}>{m === 'free' ? t.free : t.task}</button>
        ))}
      </div>
      <h2 id="graphs-title" className="sr-only">{state.mode === 'free' ? t.free : t.task}</h2>

      {state.mode === 'free' ? (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="card min-w-0 space-y-4">
            <FuncList funcs={free.funcs} compiled={freeCompiled} prefix="g" onChange={(funcs) => setFree({ funcs })} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-muted">{t.examples}</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="btn-ghost btn-sm font-mono" data-testid={`g-example-${ex}`}
                  onClick={() => setFree({ funcs: free.funcs.length < MAX_FUNCS ? [...free.funcs, { expr: ex, visible: true }] : free.funcs.map((f, i) => (i === free.funcs.length - 1 ? { expr: ex, visible: true } : f)) })}>{ex}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.angle}>
              <span className="text-sm text-muted">{t.angle}:</span>
              {(['deg', 'rad'] as const).map((a) => (
                <button key={a} type="button" aria-pressed={free.angle === a} data-testid={`g-angle-${a}`}
                  className={`min-h-9 rounded-full px-3 text-sm ring-1 ${free.angle === a ? 'bg-ink text-paper ring-ink' : 'ring-line-strong/50 hover:bg-sunken'}`}
                  onClick={() => setFree({ angle: a })}>{a === 'deg' ? t.deg : t.rad}</button>
              ))}
              <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setFree({ view: DEFAULT_VIEW })} data-testid="g-reset">{t.reset}</button>
            </div>
          </div>
          <Plot funcs={free.funcs} compiled={freeCompiled} view={free.view} onView={(view) => setFree({ view })} testId="g-plot" />
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="card min-w-0 space-y-4" lang={lang}>
            <h3 className="font-serif text-subheading font-semibold">{t.taskTitle}</h3>
            <ul className="space-y-1 text-[1.0625rem]">{t.taskText.map((line) => <li key={line}>{nbspNumbers(line)}</li>)}</ul>
            <p className="text-sm font-medium"><span className="step-dot mr-2 inline-flex h-6 w-6 text-xs" aria-hidden="true">1</span>{t.step1}</p>
            <FuncList funcs={task.funcs} compiled={taskCompiled} prefix="tk" allowAdd={false} onChange={(funcs) => setTask({ funcs })} />
            <p className="text-sm font-medium"><span className="step-dot mr-2 inline-flex h-6 w-6 text-xs" aria-hidden="true">2</span>{t.step2}</p>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1"><span className="field-label">{t.px}</span>
                <input className="input w-full tabular-nums" inputMode="decimal" value={task.px} onChange={(e) => setTask({ px: e.target.value })} data-testid="task-x" /></label>
              <label className="min-w-0 flex-1"><span className="field-label">{t.py}</span>
                <input className="input w-full tabular-nums" inputMode="decimal" value={task.py} onChange={(e) => setTask({ py: e.target.value })} data-testid="task-y" /></label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium"><span className="step-dot mr-2 inline-flex h-6 w-6 text-xs" aria-hidden="true">3</span>{t.step3}</legend>
              {(['single', 'pass', 'equal'] as const).map((o) => (
                <label key={o} className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border px-3 ${task.choice === o ? 'border-brand-ink bg-brand-soft' : 'border-line-strong/50'}`}>
                  <input type="radio" name="task-choice" className="h-4 w-4 accent-[rgb(var(--brand))]" checked={task.choice === o} onChange={() => setTask({ choice: o })} data-testid={`task-opt-${o}`} />
                  {t.opts[o]}
                </label>
              ))}
            </fieldset>
            <button type="button" className="btn" disabled={!task.choice} onClick={() => setTask({ checked: true })} data-testid="task-check">{t.check}</button>
            {task.checked && result && (
              <div className="space-y-2 rounded-control border border-line-strong/50 bg-sunken p-4" role="status" data-testid="task-result">
                {([['lines', result.lines, t.linesOk, t.linesBad], ['point', result.point, t.pointOk, t.pointBad], ['choice', result.choice, t.choiceOk, t.choiceBad]] as const).map(([key, ok, yes, no]) => (
                  <p key={key} className="flex items-start gap-2.5" data-testid={`task-res-${key}`} data-ok={ok}>
                    <span aria-hidden="true" className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-card ${ok ? 'bg-ok' : 'bg-bad'}`}><Icon name={ok ? 'check' : 'x'} className="h-4 w-4" /></span>
                    <span>{ok ? yes : no}</span>
                  </p>
                ))}
                <p className="border-t border-line pt-2 text-sm tabular-nums" data-testid="task-explain">{nbspNumbers(t.explain)}</p>
              </div>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={openInFree} data-testid="task-open-graph"><Icon name="arrow-right" className="h-4 w-4" />{t.openGraph}</button>
          </div>
          {/* На телефоне график задачи — первым: на шаге 2 по нему нажимают, и до него не нужно листать всю форму. */}
          <div className="order-first min-w-0 lg:order-none"><Plot funcs={task.funcs} compiled={taskCompiled} view={taskView} onView={setTaskView} testId="tk-plot" /></div>
        </div>
      )}
    </section>
  );
}
