// Разбор формул y = f(x) для «Графиков»: собственный парсер в дерево и вычисление по дереву. Без eval и new Function.
import type { Language } from './lesson';

export type AngleMode = 'rad' | 'deg';
type Fn1 = 'sin' | 'cos' | 'tan' | 'sqrt' | 'abs' | 'ln' | 'log' | 'exp';
const FUNCS: readonly Fn1[] = ['sin', 'cos', 'tan', 'sqrt', 'abs', 'ln', 'log', 'exp'];

export type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'fn'; f: Fn1; a: Node };

export type ParseError =
  | { code: 'empty' }
  | { code: 'char'; ch: string; pos: number }
  | { code: 'name'; name: string; pos: number }
  | { code: 'paren-open'; pos: number }
  | { code: 'paren-close'; pos: number }
  | { code: 'operand'; pos: number }
  | { code: 'arg'; f: string; pos: number };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: ParseError };

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'id'; v: string; p: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^'; p: number }
  | { t: '(' | ')'; p: number };

/** Нормализация: «y =», «f(x) =», десятичная запятая, ×·÷−, ², √, π. */
export function normalize(src: string): string {
  return src
    .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-')
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/π/g, ' pi ').replace(/√/g, ' sqrt ');
}

function tokenize(src: string): Tok[] | ParseError {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]), p: i }); i += num[0].length; continue; }
    const id = /^[a-zA-Zа-яА-ЯёЁ]+/.exec(src.slice(i));
    if (id) {
      // «2sinx», «xsin» — разбиваем на известные имена и x.
      let w = id[0].toLowerCase(); let p = i;
      while (w) {
        const known = [...FUNCS, 'pi', 'e', 'x'].find((n) => w.startsWith(n));
        if (!known) return { code: 'name', name: id[0], pos: i };
        out.push({ t: 'id', v: known, p });
        w = w.slice(known.length); p += known.length;
      }
      i += id[0].length; continue;
    }
    if ('+-*/^'.includes(c)) { out.push({ t: 'op', v: c as '+' | '-' | '*' | '/' | '^', p: i }); i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c, p: i }); i++; continue; }
    return { code: 'char', ch: c, pos: i };
  }
  return out;
}

/** Разбор: expr → term (+|− term)*; term → unary ((*|/|неявное) unary)*; unary → −unary | power; power → primary (^ unary)?. */
export function parse(srcRaw: string): ParseResult {
  const src = normalize(srcRaw);
  if (!src.trim()) return { ok: false, error: { code: 'empty' } };
  const toks = tokenize(src);
  if (!Array.isArray(toks)) return { ok: false, error: toks };
  let i = 0;
  const peek = () => toks[i];
  const fail = (e: ParseError): never => { throw e; };
  const startsPrimary = (tk: Tok | undefined) => !!tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');

  function primary(): Node {
    const tk = peek();
    if (!tk) return fail({ code: 'operand', pos: src.length });
    if (tk.t === 'num') { i++; return { k: 'num', v: tk.v }; }
    if (tk.t === '(') {
      i++;
      const e = expr();
      if (peek()?.t !== ')') return fail({ code: 'paren-close', pos: tk.p });
      i++;
      return e;
    }
    if (tk.t === 'id') {
      i++;
      if (tk.v === 'x') return { k: 'x' };
      if (tk.v === 'pi') return { k: 'num', v: Math.PI };
      if (tk.v === 'e') return { k: 'num', v: Math.E };
      const f = tk.v as Fn1;
      if (!startsPrimary(peek()) && peek()?.t !== 'op') return fail({ code: 'arg', f, pos: tk.p });
      // sin x, sin(x), sin 2x → аргумент — unary с неявным умножением внутри скобок
      const a = peek()?.t === '(' ? primary() : unary();
      return { k: 'fn', f, a };
    }
    if (tk.t === ')') return fail({ code: 'paren-open', pos: tk.p });
    return fail({ code: 'operand', pos: tk.p });
  }
  function power(): Node {
    const base = primary();
    if (peek()?.t === 'op' && (peek() as { v: string }).v === '^') { i++; return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function unary(): Node {
    const tk = peek();
    if (tk?.t === 'op' && (tk.v === '-' || tk.v === '+')) { i++; const a = unary(); return tk.v === '-' ? { k: 'neg', a } : a; }
    return power();
  }
  function term(): Node {
    let a = unary();
    for (;;) {
      const tk = peek();
      if (tk?.t === 'op' && (tk.v === '*' || tk.v === '/')) { i++; a = { k: 'bin', op: tk.v, a, b: unary() }; continue; }
      if (startsPrimary(tk)) { a = { k: 'bin', op: '*', a, b: unary() }; continue; } // 2x, 3(x+1), x sin x
      return a;
    }
  }
  function expr(): Node {
    let a = term();
    for (;;) {
      const tk = peek();
      if (tk?.t === 'op' && (tk.v === '+' || tk.v === '-')) { i++; a = { k: 'bin', op: tk.v, a, b: term() }; continue; }
      return a;
    }
  }
  try {
    const ast = expr();
    const rest = peek();
    if (rest) return { ok: false, error: rest.t === ')' ? { code: 'paren-open', pos: rest.p } : { code: 'operand', pos: rest.p } };
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e as ParseError };
  }
}

export function evaluate(n: Node, x: number, angle: AngleMode = 'rad'): number {
  switch (n.k) {
    case 'num': return n.v;
    case 'x': return x;
    case 'neg': return -evaluate(n.a, x, angle);
    case 'bin': {
      const a = evaluate(n.a, x, angle), b = evaluate(n.b, x, angle);
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b);
    }
    case 'fn': {
      const a = evaluate(n.a, x, angle);
      const r = angle === 'deg' ? (a * Math.PI) / 180 : a;
      switch (n.f) {
        case 'sin': return Math.sin(r);
        case 'cos': return Math.cos(r);
        // tan у 90° даёт огромное число из-за округления π — считаем это разрывом.
        case 'tan': { const c = Math.cos(r); return Math.abs(c) < 1e-12 ? NaN : Math.sin(r) / c; }
        case 'sqrt': return Math.sqrt(a);
        case 'abs': return Math.abs(a);
        case 'ln': return Math.log(a);
        case 'log': return Math.log10(a);
        case 'exp': return Math.exp(a);
      }
    }
  }
}

/** Компиляция формулы в функцию x → y (вычисление по дереву). */
export function compile(src: string, angle: AngleMode = 'rad'): { ok: true; f: (x: number) => number } | { ok: false; error: ParseError } {
  const r = parse(src);
  return r.ok ? { ok: true, f: (x: number) => evaluate(r.ast, x, angle) } : r;
}

const MSG: Record<Language, (e: ParseError) => string> = {
  ru: (e) => {
    switch (e.code) {
      case 'empty': return 'Введите формулу, например 2x + 1.';
      case 'char': return `Символ «${e.ch}» не поддерживается. Используйте цифры, x, + − * / ^ и скобки.`;
      case 'name': return `Неизвестное имя «${e.name}». Доступно: x, sin, cos, tan, √ (sqrt), abs, ln, π.`;
      case 'paren-close': return 'Не хватает закрывающей скобки «)».';
      case 'paren-open': return 'Лишняя закрывающая скобка «)» — проверьте пары скобок.';
      case 'operand': return 'Формула оборвана: после знака нужно число, x или скобка.';
      case 'arg': return `После ${e.f} нужен аргумент, например ${e.f}(x).`;
    }
  },
  kk: (e) => {
    switch (e.code) {
      case 'empty': return 'Формуланы енгізіңіз, мысалы 2x + 1.';
      case 'char': return `«${e.ch}» таңбасы қолданылмайды. Цифрларды, x, + − * / ^ және жақшаларды пайдаланыңыз.`;
      case 'name': return `«${e.name}» белгісіз атау. Қолжетімді: x, sin, cos, tan, √ (sqrt), abs, ln, π.`;
      case 'paren-close': return 'Жабатын «)» жақшасы жетпейді.';
      case 'paren-open': return 'Артық «)» жақшасы — жақшаларды тексеріңіз.';
      case 'operand': return 'Формула аяқталмаған: таңбадан кейін сан, x немесе жақша керек.';
      case 'arg': return `${e.f} кейін аргумент керек, мысалы ${e.f}(x).`;
    }
  },
};
export const parseErrorText = (lang: Language, e: ParseError) => MSG[lang](e);

export interface View { xmin: number; xmax: number; ymin: number; ymax: number }

/**
 * Точки графика с разрывами: линия рвётся, где значение не определено или функция «прыгает» через окно
 * (1/x у нуля, tan у 90°). Проверка прыжка: на большом скачке смотрим середину — у разрыва она не лежит между концами.
 */
export function sample(f: (x: number) => number, view: View, n = 600): { x: number; y: number }[][] {
  const segs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  const h = view.ymax - view.ymin;
  let prev: { x: number; y: number } | null = null;
  for (let k = 0; k <= n; k++) {
    const x = view.xmin + ((view.xmax - view.xmin) * k) / n;
    const y = f(x);
    if (!Number.isFinite(y)) { if (cur.length) segs.push(cur); cur = []; prev = null; continue; }
    if (prev && Math.abs(y - prev.y) > h) {
      const mx = (x + prev.x) / 2; const my = f(mx);
      const lo = Math.min(y, prev.y), hi = Math.max(y, prev.y);
      if (!Number.isFinite(my) || my < lo || my > hi) { if (cur.length) segs.push(cur); cur = []; }
    }
    cur.push({ x, y });
    prev = { x, y };
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** Точка пересечения двух функций рядом с x0 (бисекция по разности со сменой знака). */
export function intersectNear(f: (x: number) => number, g: (x: number) => number, x0: number, span: number): { x: number; y: number } | null {
  const d = (x: number) => f(x) - g(x);
  const steps = 200;
  let best: { x: number; y: number } | null = null;
  for (let k = 0; k < steps; k++) {
    let a = x0 - span + (2 * span * k) / steps, b = a + (2 * span) / steps;
    let da = d(a), db = d(b);
    if (!Number.isFinite(da) || !Number.isFinite(db) || da * db > 0) continue;
    for (let it = 0; it < 60; it++) {
      const m = (a + b) / 2; const dm = d(m);
      if (!Number.isFinite(dm)) break;
      if (da * dm <= 0) { b = m; db = dm; } else { a = m; da = dm; }
    }
    const x = (a + b) / 2, y = f(x);
    // Смена знака на разрыве (1/x) — не пересечение.
    if (!Number.isFinite(y) || Math.abs(d(x)) > 1e-6 * Math.max(1, Math.abs(y))) continue;
    if (!best || Math.abs(x - x0) < Math.abs(best.x - x0)) best = { x, y };
  }
  return best;
}

/** «Красивый» шаг сетки: 1, 2 или 5 × 10^n, около target делений на окно. */
export function niceStep(range: number, target = 8): number {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Совпадают ли две функции (для проверки «ученик построил нужную линию»). */
export function sameFunction(f: (x: number) => number, g: (x: number) => number, xs: number[]): boolean {
  return xs.every((x) => { const a = f(x), b = g(x); return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)); });
}
