// Математика в Oqy: та же механика «ответ + доказательство», где доказательство — строки с исходными данными.
// Расчёт задания можно проверить кодом: формула над числами из условия должна давать верный вариант.
import { z } from 'zod';

export const SubjectSchema = z.enum(['reading', 'math']);
export type Subject = z.infer<typeof SubjectSchema>;

/** Старые уроки и JSON без поля subject — это «Чтение». */
export const subjectOf = (lesson: { subject?: Subject }): Subject => lesson.subject ?? 'reading';

/**
 * Проверяемый расчёт задания:
 * - value: результат формулы должен совпасть с числом в тексте верного варианта;
 * - choose: у каждого варианта своя формула, верный — с наименьшим (min) или наибольшим (max) значением.
 */
export const CalcSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), expr: z.string().min(1), unit: z.string().default('') }),
  z.object({ kind: z.literal('choose'), pick: z.enum(['min', 'max']), values: z.record(z.string(), z.string().min(1)), unit: z.string().default('') }),
]);
export type Calc = z.infer<typeof CalcSchema>;

/** Безопасный вычислитель: числа (точка или запятая), + − * / × ÷ и скобки. Никакого eval. null — ошибка в формуле. */
export function evaluateExpr(src: string): number | null {
  const s = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−|–/g, '-').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, '');
  if (!s || /[^0-9.+\-*/()]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  function number(): number | null {
    const m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v; }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (v === null || peek() !== ')') return null; i++; return v; }
    return number();
  }
  function term(): number | null {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++]; const r = factor();
      if (r === null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number | null {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++]; const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = expr();
  return v !== null && i === s.length && Number.isFinite(v) ? v : null;
}

/** Числа в тексте варианта: «1 350 ₸», «12,5 л», «2 400». */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)) out.push(Number(m[0].replace(/[  ]/g, '').replace(',', '.')));
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 0.005 + Math.abs(b) * 1e-9;

export type CalcCheck =
  | { ok: true; value: number | null }
  | { ok: false; reason: 'bad-expr'; expr: string }
  | { ok: false; reason: 'mismatch'; expected: number; optionId: string }
  | { ok: false; reason: 'ambiguous'; expected: number; optionId: string }
  | { ok: false; reason: 'wrong-choice'; expectedOptionId: string };

/** Совпадает ли расчёт с верным вариантом задания. */
export function checkCalc(task: { calc?: Calc; options: { id: string; text: string }[]; correctOptionId: string }): CalcCheck {
  const c = task.calc;
  if (!c) return { ok: true, value: null };
  if (c.kind === 'value') {
    const v = evaluateExpr(c.expr);
    if (v === null) return { ok: false, reason: 'bad-expr', expr: c.expr };
    const text = task.options.find((o) => o.id === task.correctOptionId)?.text ?? '';
    if (!numbersIn(text).some((n) => close(n, v))) return { ok: false, reason: 'mismatch', expected: v, optionId: task.correctOptionId };
    // Тот же результат в неверном варианте — у задачи не единственный ответ.
    const twin = task.options.find((o) => o.id !== task.correctOptionId && numbersIn(o.text).some((n) => close(n, v)));
    return twin ? { ok: false, reason: 'ambiguous', expected: v, optionId: twin.id } : { ok: true, value: v };
  }
  const values: [string, number][] = [];
  for (const [id, expr] of Object.entries(c.values)) {
    const v = evaluateExpr(expr);
    if (v === null) return { ok: false, reason: 'bad-expr', expr };
    values.push([id, v]);
  }
  if (!values.length) return { ok: false, reason: 'bad-expr', expr: '' };
  const best = values.reduce((a, b) => ((c.pick === 'min' ? b[1] < a[1] : b[1] > a[1]) ? b : a));
  // Ничья — у задачи нет единственного ответа.
  const ties = values.filter(([, v]) => close(v, best[1])).length;
  if (ties > 1 || best[0] !== task.correctOptionId) return { ok: false, reason: 'wrong-choice', expectedOptionId: ties > 1 ? '—' : best[0] };
  return { ok: true, value: best[1] };
}

export const MATH_SKILL_LABELS = {
  ru: { find: 'Найти данные', match: 'Посчитать', infer: 'Выбрать и обосновать' },
  kk: { find: 'Деректі табу', match: 'Есептеу', infer: 'Таңдау және негіздеу' },
} as const;

/** Условие математической задачи: каждая непустая строка — отдельное исходное данное (числа с точкой не разрываются). */
export function splitDataLines(text: string): { id: string; text: string }[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => /[\p{L}\p{N}]/u.test(l)).map((l, i) => ({ id: `s${i + 1}`, text: l }));
}

/** Разбивка исходного текста по разделу: чтение — по предложениям, математика — по строкам. */
export const splitBySubject = (subject: Subject, text: string, splitSentences: (t: string) => { id: string; text: string }[]) =>
  subject === 'math' ? splitDataLines(text) : splitSentences(text);

/** Неразрывные пробелы в числах и единицах: «2 000 ₸», «150 ₸», «20 ГБ» не разрываются переносом строки. */
export function nbspNumbers(text: string): string {
  return text.replace(/(\d) (?=\d{3}(\D|$))/g, '$1\u00a0').replace(/(\d) (?=(₸|ГБ|л|кг|шт|%))/g, '$1\u00a0');
}
