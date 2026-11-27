import { describe, expect, it } from 'vitest';
import { checkAnswer, feedbackParts, feedbackText, parseLessonJson, LessonSchema, recommendNext, splitSentences, validateLesson, type Lesson } from '../../shared/lesson';
import pitchKk from '../../docs/pitch/lesson-kk-after-teacher.json';
import { BUILTIN_LESSONS } from '../../shared/builtin';

const saiga = BUILTIN_LESSONS.find((l) => l.id === 'ru-saiga')!;
const [find, match, infer] = saiga.tasks as [Lesson['tasks'][0], Lesson['tasks'][0], Lesson['tasks'][0]];

describe('встроенные уроки', () => {
  it('4 урока: 2 kk + 2 ru, по 3 задания на все навыки', () => {
    expect(BUILTIN_LESSONS).toHaveLength(4);
    expect(BUILTIN_LESSONS.filter((l) => l.language === 'kk')).toHaveLength(2);
    for (const l of BUILTIN_LESSONS) expect(l.tasks.map((t) => t.skill)).toEqual(['find', 'match', 'infer']);
  });
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
    expect(checkAnswer(match, 'c', ['s4', 's5']).solved).toBe(true);
    expect(checkAnswer(match, 'c', ['s3', 's5']).solved).toBe(true);
    expect(checkAnswer(match, 'c', ['s4', 's3']).solved).toBe(false);
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
