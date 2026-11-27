import { describe, expect, it } from 'vitest';
import { checkAnswer, feedbackParts, feedbackText, parseLessonJson, LessonSchema, recommendNext, splitSentences, validateLesson, type Lesson } from '../../shared/lesson';
import pitchKk from '../../docs/pitch/lesson-kk-after-teacher.json';
import { subjectOf, evaluateExpr, checkCalc, numbersIn } from '../../shared/math';
import { BUILTIN_LESSONS } from '../../shared/builtin';

const saiga = BUILTIN_LESSONS.find((l) => l.id === 'ru-saiga')!;
const [find, match, infer] = saiga.tasks as [Lesson['tasks'][0], Lesson['tasks'][0], Lesson['tasks'][0]];

it('урок с полями только из пробелов нельзя импортировать или сохранить', () => {
  const lesson = structuredClone(saiga);
  lesson.title = ' \n ';
  lesson.sentences[0]!.text = '  ';
  lesson.tasks[0]!.question = '\t';
  lesson.tasks[0]!.options[0]!.text = '  ';
  lesson.tasks[0]!.hint = '\n';
  const result = parseLessonJson(JSON.stringify(lesson));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.map((error) => error.split(':')[0])).toEqual(
    expect.arrayContaining(['title', 'sentences.0.text', 'tasks.0.question', 'tasks.0.options.0.text', 'tasks.0.hint']),
  );
});

it('десятичная точка не разбивает предложение и не меняет ID доказательства', () => {
  expect(splitSentences('Длина тропы 2.5 км. За час прошли больше 1.25 км! Дальше начался подъём.')).toEqual([
    { id: 's1', text: 'Длина тропы 2.5 км.' },
    { id: 's2', text: 'За час прошли больше 1.25 км!' },
    { id: 's3', text: 'Дальше начался подъём.' },
  ]);
});

describe('встроенные уроки', () => {
  it('чтение: 8 уроков; математика: 6 уроков — kk и ru на каждый класс 7–9, по 3 задания', () => {
    const reading = BUILTIN_LESSONS.filter((l) => subjectOf(l) === 'reading');
    const math = BUILTIN_LESSONS.filter((l) => subjectOf(l) === 'math');
    expect(reading).toHaveLength(8);
    expect(math).toHaveLength(6);
    for (const grade of [7, 8, 9]) for (const language of ['kk', 'ru']) {
      expect(reading.filter((l) => l.grade === grade && l.language === language)).toHaveLength(grade === 8 ? 2 : 1);
      expect(math.filter((l) => l.grade === grade && l.language === language)).toHaveLength(1);
    }
    for (const l of BUILTIN_LESSONS) expect(l.tasks.map((t) => t.skill)).toEqual(['find', 'match', 'infer']);
  });
  it('в заданиях на сопоставление одно предложение не засчитывается', () => {
    for (const lesson of BUILTIN_LESSONS) {
      const task = lesson.tasks.find((item) => item.skill === 'match')!;
      for (const evidence of task.evidenceSets) {
        expect(evidence.length, lesson.id).toBeGreaterThanOrEqual(2);
        for (const id of evidence) expect(checkAnswer(task, task.correctOptionId, [id]).solved, lesson.id).toBe(false);
        expect(checkAnswer(task, task.correctOptionId, evidence).solved, lesson.id).toBe(true);
      }
    }
  });
});

it('дополнительное задание соответствует классу и языку текущего урока', () => {
  const current = BUILTIN_LESSONS.find((l) => l.id === 'ru-garden')!;
  const attempt = { lessonId: current.id, taskId: 't1', skill: 'find' as const, solved: false };
  expect(recommendNext(BUILTIN_LESSONS, current, [attempt], new Set())).toBeNull();
  const added = { ...current, id: 'ru-extra7' };
  expect(recommendNext([...BUILTIN_LESSONS, added], current, [attempt], new Set())?.lesson.id).toBe(added.id);
});

describe('проверка ответа и доказательства отдельно', () => {
  it('верный ответ + неверное доказательство → не решено, просим уточнить', () => {
    const r = checkAnswer(find, 'b', ['s3']);
    expect(r).toEqual({ answerCorrect: true, evidence: 'wrong', solved: false });
    expect(feedbackText('ru', r, find)).toMatch(/Ответ верный.*не подтверждает/);
  });
  it('неверный ответ + верное доказательство → не решено', () => {
    const r = checkAnswer(find, 'a', ['s1']);
    expect(r.answerCorrect).toBe(false);
    expect(r.evidence).toBe('correct');
  });
  it('вывод на двух предложениях: одного мало, лишнее не принимается, оба — решено', () => {
    expect(checkAnswer(infer, 'b', ['s6']).evidence).toBe('missing');
    expect(checkAnswer(infer, 'b', ['s6', 's7', 's1']).evidence).toBe('extra');
    expect(checkAnswer(infer, 'b', ['s7', 's6']).solved).toBe(true);
  });
  it('несколько допустимых наборов доказательств', () => {
    const task = { ...match, evidenceSets: [['s4', 's5'], ['s3', 's5']] };
    expect(checkAnswer(task, 'c', ['s4', 's5']).solved).toBe(true);
    expect(checkAnswer(task, 'c', ['s3', 's5']).solved).toBe(true);
    expect(checkAnswer(task, 'c', ['s4', 's3']).solved).toBe(false);
  });
  it('численность сайгаков не доказывает, что делали учёные и инспекторы', () => {
    expect(checkAnswer(match, 'c', ['s3', 's5']).solved).toBe(false);
    expect(checkAnswer(match, 'c', ['s4', 's5']).solved).toBe(true);
  });
  it('казахский отзыв', () => {
    expect(feedbackText('kk', checkAnswer(find, 'b', ['s2']), find)).toMatch(/Жауап дұрыс/);
  });
});

describe('импорт и валидация', () => {
  it('сломанный JSON', () => {
    const r = parseLessonJson('{"id": "x", ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/Некорректный JSON/);
  });
  it('несуществующий ID предложения и неверная ссылка на вариант', () => {
    const bad = structuredClone(saiga);
    bad.tasks[0]!.evidenceSets = [['s99']];
    bad.tasks[1]!.correctOptionId = 'z';
    const r = validateLesson(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/s99.*не существует/);
      expect(r.errors.join('\n')).toMatch(/«z» не найден/);
    }
  });
  it('корректный урок проходит round-trip через JSON', () => {
    expect(parseLessonJson(JSON.stringify(saiga)).ok).toBe(true);
  });
});

describe('разбиение и рекомендации', () => {
  it('стабильные ID предложений', () => {
    expect(splitSentences('Первое. Второе! Третье?  Четвёртое')).toEqual([
      { id: 's1', text: 'Первое.' }, { id: 's2', text: 'Второе!' }, { id: 's3', text: 'Третье?' }, { id: 's4', text: 'Четвёртое' },
    ]);
  });
  it('рекомендует задание того же языка по навыку с наибольшим числом ошибок', () => {
    const attempts = [
      { lessonId: 'ru-saiga', taskId: 't3', skill: 'infer' as const, solved: false },
      { lessonId: 'ru-saiga', taskId: 't3', skill: 'infer' as const, solved: false },
      { lessonId: 'ru-saiga', taskId: 't1', skill: 'find' as const, solved: false },
    ];
    const rec = recommendNext(BUILTIN_LESSONS, saiga, attempts, new Set());
    expect(rec?.lesson.id).toBe('ru-solar');
    expect(rec?.task.skill).toBe('infer');
    expect(recommendNext(BUILTIN_LESSONS, saiga, [], new Set())).toBeNull();
  });
});

describe('два отдельных итога проверки', () => {
  it('ответ и доказательство оцениваются по отдельности (ru)', () => {
    expect(feedbackParts('ru', checkAnswer(find, 'a', ['s1']), find)).toMatchObject({ answer: 'Ответ неверный', evidence: 'Доказательство верное' });
    expect(feedbackParts('ru', checkAnswer(find, 'b', ['s3']), find)).toMatchObject({ answer: 'Ответ верный', evidence: 'Цитата не подтверждает ответ' });
    expect(feedbackParts('ru', checkAnswer(find, 'b', ['s1', 's2']), find).evidence).toBe('Лишнее предложение');
    expect(feedbackParts('ru', checkAnswer(match, 'c', ['s5']), match).evidence).toBe('Доказательства пока не хватает');
    expect(feedbackParts('ru', checkAnswer(find, 'b', ['s1']), find)).toEqual({ answer: 'Ответ верный', evidence: 'Доказательство верное', tip: null });
  });
  it('казахские строки', () => {
    expect(feedbackParts('kk', checkAnswer(find, 'a', ['s3']), find)).toMatchObject({ answer: 'Жауап қате', evidence: 'Үзінді жауапты дәлелдемейді' });
    expect(feedbackParts('kk', checkAnswer(find, 'b', ['s1']), find)).toMatchObject({ answer: 'Жауап дұрыс', evidence: 'Дәлел дұрыс', tip: null });
  });
});

describe('недостающее доказательство: отзыв зависит от типа задания', () => {
  it('сопоставление — «найди вторую деталь», вывод — про опору для вывода (ru)', () => {
    expect(feedbackText('ru', checkAnswer(match, 'c', ['s5']), match)).toBe('Ответ верный. Найди вторую деталь — ещё одно предложение, с которым нужно сопоставить.');
    expect(feedbackText('ru', checkAnswer(infer, 'b', ['s6']), 'infer')).toMatch(/^Ответ верный\. Для вывода нужна ещё одна опора/);
    expect(feedbackParts('ru', checkAnswer(match, 'c', ['s5']), match).tip).toBe('Найди вторую деталь — ещё одно предложение, с которым нужно сопоставить.');
    expect(feedbackParts('ru', checkAnswer(infer, 'b', ['s6']), infer).tip).not.toMatch(/сопостав/);
  });
  it('казахский урок учителя (docs/pitch): t2, ответ a и только s3 → «екінші деректі тап»; + s4 → засчитано', () => {
    const kk = LessonSchema.parse(pitchKk);
    const t2 = kk.tasks[1]!;
    expect(t2.skill).toBe('match');
    const first = checkAnswer(t2, 'a', ['s3']);
    expect(first).toEqual({ answerCorrect: true, evidence: 'missing', solved: false });
    expect(feedbackText('kk', first, t2)).toBe('Жауап дұрыс. Екінші деректі тап — салыстыруға керек тағы бір сөйлем.');
    expect(feedbackParts('kk', first, t2)).toMatchObject({ answer: 'Жауап дұрыс', tip: 'Екінші деректі тап — салыстыруға керек тағы бір сөйлем.' });
    expect(checkAnswer(t2, 'a', ['s3', 's4']).solved).toBe(true);
    expect(feedbackText('kk', checkAnswer(kk.tasks[2]!, 'b', ['s6']), kk.tasks[2]!)).toMatch(/Қорытындыға тағы бір тірек керек/);
  });
});

import { qualityWarnings } from '../../shared/lesson';
import { readFileSync } from 'node:fs';

describe('мягкое предупреждение: сопоставление отвечается одним предложением', () => {
  const draft = (f: string) => JSON.parse(readFileSync(f, 'utf8')).draft;
  it('ловит реальные черновики Gemma kk-solar и kk-bus (до и после улучшения промпта)', () => {
    for (const f of ['docs/gemma-run-qa/kk-solar.json', 'docs/gemma-run-qa/kk-bus.json', 'docs/gemma-run-qa/retry/kk-solar.json', 'docs/gemma-run-qa/retry/kk-bus.json']) {
      const w = qualityWarnings(draft(f));
      expect(w.map((x) => x.taskIndex), f).toEqual([1]);
    }
  });
  it('не срабатывает на честном сопоставлении (ru-radio) и на встроенных уроках', () => {
    expect(qualityWarnings(draft('docs/gemma-run-qa/ru-radio.json'))).toEqual([]);
    for (const l of BUILTIN_LESSONS) expect(qualityWarnings(l), l.id).toEqual([]);
  });
  it('находит полный ответ за пределами выбранных доказательств', () => {
    const lesson = draft('docs/gemma-run-qa/ru-radio.json') as Lesson;
    const task = lesson.tasks[1]!;
    const answer = task.options.find((option) => option.id === task.correctOptionId)!.text;
    lesson.sentences.push({ id: 'summary', text: answer });
    expect(qualityWarnings(lesson)).toMatchObject([{ taskIndex: 1, sentenceId: 'summary' }]);
  });
});

describe('исправленный учителем t2 (s3 + s4) не помечается', () => {
  it('docs/pitch/lesson-kk-after-teacher.json', () => {
    const l = JSON.parse(readFileSync('docs/pitch/lesson-kk-after-teacher.json', 'utf8'));
    expect(qualityWarnings(l)).toEqual([]);
  });
});

describe('ошибки импорта JSON — по-русски, без технического английского', () => {
  it('тип, диапазон, пустой список, язык, тип задания, формат ID, не объект', () => {
    const L = structuredClone(BUILTIN_LESSONS[0]!) as unknown as Record<string, unknown>;
    const bad = [{ ...L, grade: 'восьмой' }, { ...L, grade: 10 }, { ...L, tasks: [] }, { ...L, language: 'en' }, { ...L, id: 'мой урок' }, [1, 2], { ...L, tasks: undefined }];
    for (const v of bad) {
      const r = parseLessonJson(JSON.stringify(v));
      expect(r.ok).toBe(false);
      if (!r.ok) for (const e of r.errors) expect(e, e).not.toMatch(/Invalid|expected|received|Too (big|small)/);
    }
  });
});

describe('математика: вычислитель и проверка расчёта кодом', () => {
  it('вычислитель: приоритет, скобки, запятая, × и ÷; мусор и деление на 0 — null', () => {
    expect(evaluateExpr('35000-18000-24*600')).toBe(2600);
    expect(evaluateExpr('(8 − 5) × 400 + 1500')).toBe(2700);
    expect(evaluateExpr('30*280*0,85')).toBeCloseTo(7140);
    expect(evaluateExpr('24 ÷ 4 × 1000')).toBe(6000);
    expect(evaluateExpr('-(2+3)')).toBe(-5);
    for (const bad of ['', '2+', 'alert(1)', '1/0', '2**3', '(1+2', 'process.exit()']) expect(evaluateExpr(bad), bad).toBeNull();
  });
  it('числа в вариантах: пробел-разделитель тысяч, запятая', () => {
    expect(numbersIn('«Старт», 2 700 ₸')).toEqual([2700]);
    expect(numbersIn('12,5 л и 1 200 ₸')).toEqual([12.5, 1200]);
  });
  it('все встроенные математические задания: расчёт сходится с верным вариантом и единственен', () => {
    for (const l of BUILTIN_LESSONS.filter((x) => subjectOf(x) === 'math')) for (const t of l.tasks) {
      expect(t.calc, `${l.id}/${t.id}`).toBeTruthy();
      expect(t.solution, `${l.id}/${t.id}`).toMatch(/₸|ГБ/);
      expect(checkCalc(t), `${l.id}/${t.id}`).toMatchObject({ ok: true });
    }
  });
  it('расхождение, неверный выбор, ничья и совпадение с неверным вариантом — ошибки качества', () => {
    const base = { options: [{ id: 'a', text: '2 600 ₸' }, { id: 'b', text: '1 400 ₸' }], correctOptionId: 'a' };
    expect(checkCalc({ ...base, calc: { kind: 'value', expr: '1000+400', unit: '₸' } })).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(checkCalc({ ...base, options: [{ id: 'a', text: '2 600 ₸' }, { id: 'b', text: 'тоже 2 600 ₸' }], calc: { kind: 'value', expr: '2600', unit: '₸' } })).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(checkCalc({ ...base, calc: { kind: 'choose', pick: 'min', values: { a: '5', b: '3' }, unit: '' } })).toMatchObject({ ok: false, reason: 'wrong-choice', expectedOptionId: 'b' });
    expect(checkCalc({ ...base, calc: { kind: 'choose', pick: 'min', values: { a: '3', b: '3' }, unit: '' } })).toMatchObject({ ok: false, reason: 'wrong-choice', expectedOptionId: '—' });
    expect(checkCalc({ ...base, calc: { kind: 'value', expr: '2600+', unit: '' } })).toMatchObject({ ok: false, reason: 'bad-expr' });
  });
  it('старый урок без subject — «Чтение»', () => {
    const old = structuredClone(BUILTIN_LESSONS.find((l) => l.id === 'ru-saiga')!) as Record<string, unknown>;
    delete old.subject;
    expect(subjectOf(old as { subject?: 'reading' | 'math' })).toBe('reading');
  });
});
