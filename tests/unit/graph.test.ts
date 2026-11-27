import { describe, expect, it } from 'vitest';
import { compile, parse, parseErrorText, sample, intersectNear, niceStep, sameFunction } from '../../shared/graphExpr';
import { readFileSync } from 'node:fs';

const f = (src: string, angle: 'rad' | 'deg' = 'rad') => { const r = compile(src, angle); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.f; };

describe('парсер формул (без eval)', () => {
  it('примеры из задания и запись школьника', () => {
    expect(f('y = 2x + 1')(3)).toBe(7);
    expect(f('y = x^2')(-3)).toBe(9);
    expect(f('y = sin(x)')(Math.PI / 2)).toBeCloseTo(1);
    expect(f('y = cos(x)')(0)).toBe(1);
    expect(f('1,5x')(2)).toBe(3);                 // десятичная запятая
    expect(f('3(x+1)')(1)).toBe(6);              // неявное умножение
    expect(f('-x^2')(2)).toBe(-4);               // унарный минус слабее степени
    expect(f('2^-1')(0)).toBe(0.5);
    expect(f('√(x)')(9)).toBe(3);
    expect(f('2π')(0)).toBeCloseTo(2 * Math.PI);
    expect(f('sinx + 2sin(x)')(Math.PI / 2)).toBeCloseTo(3);
    expect(f('f(x) = 2000 + 50x')(20)).toBe(3000);
    expect(f('x²')(4)).toBe(16);
    expect(f('2 × x − 1')(3)).toBe(5);
  });
  it('градусы и радианы', () => {
    expect(f('sin(x)', 'deg')(90)).toBeCloseTo(1);
    expect(f('cos(x)', 'deg')(180)).toBeCloseTo(-1);
    expect(Number.isNaN(f('tan(x)', 'deg')(90))).toBe(true);
  });
  it('ошибки дают понятные подсказки на ru и kk', () => {
    const cases: [string, RegExp, RegExp][] = [
      ['', /Введите формулу/, /Формуланы енгізіңіз/],
      ['2x +', /Формула оборвана/, /аяқталмаған/],
      ['(x+1', /закрывающей скобки/, /Жабатын/],
      ['x+1)', /Лишняя закрывающая/, /Артық/],
      ['sn(x)', /Неизвестное имя «sn»/, /белгісіз атау/],
      ['x$2', /Символ «\$»/, /таңбасы/],
      ['sin', /После sin нужен аргумент/, /sin кейін/],
    ];
    for (const [src, ru, kk] of cases) {
      const r = parse(src);
      expect(r.ok, src).toBe(false);
      if (!r.ok) { expect(parseErrorText('ru', r.error)).toMatch(ru); expect(parseErrorText('kk', r.error)).toMatch(kk); }
    }
  });
  it('в коде графиков нет eval и new Function', () => {
    for (const file of ['shared/graphExpr.ts', 'web/src/Graphs.tsx']) {
      const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, file).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    }
  });
});

describe('построение: разрывы не соединяются', () => {
  const view = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
  it('1/x — две ветви, без отрезка через ноль', () => {
    const segs = sample(f('1/x'), view, 501);
    expect(segs.length).toBe(2);
    expect(segs[0]!.every((p) => p.x < 0)).toBe(true);
    expect(segs[1]!.every((p) => p.x > 0)).toBe(true);
  });
  it('tan(x) на [−5; 5] — пять ветвей (четыре разрыва: ±π/2 и ±3π/2)', () => {
    expect(sample(f('tan(x)'), view, 1000).length).toBe(5);
  });
  it('x^2 и sin(x) — одна непрерывная линия; √x — только x ≥ 0', () => {
    expect(sample(f('x^2'), view).length).toBe(1);
    expect(sample(f('sin(x)'), view).length).toBe(1);
    const sq = sample(f('√(x)'), view);
    expect(sq.length).toBe(1);
    expect(sq[0]!.every((p) => p.x >= 0)).toBe(true);
  });
});

describe('задача про тарифы', () => {
  it('пересечение 150x и 2000 + 50x — (20; 3000); у 1/x и −1/x смена знака на разрыве не считается', () => {
    const p = intersectNear(f('150x'), f('2000+50x'), 18, 10)!;
    expect(p.x).toBeCloseTo(20, 6);
    expect(p.y).toBeCloseTo(3000, 3);
    expect(intersectNear(f('1/x'), f('-1/x'), 0, 1)).toBeNull();
  });
  it('равносильная запись линии засчитывается', () => {
    expect(sameFunction(f('50x + 2000'), f('2000+50x'), [0, 10, 30])).toBe(true);
    expect(sameFunction(f('150x'), f('2000+50x'), [0, 10, 30])).toBe(false);
  });
  it('шаг сетки — 1, 2 или 5 × 10ⁿ', () => {
    expect(niceStep(10)).toBe(1);
    expect(niceStep(6300)).toBe(1000);
    expect(niceStep(0.5)).toBe(0.05);
  });
});

import { nbspNumbers } from '../../shared/math';
describe('неразрывные пробелы в числах', () => {
  it('разряды и единицы не разрываются', () => {
    expect(nbspNumbers('2 000 ₸ и 150 ₸, 20 ГБ')).toBe('2 000 ₸ и 150 ₸, 20 ГБ');
    expect(nbspNumbers('24 × 600')).toBe('24 × 600');
  });
});
