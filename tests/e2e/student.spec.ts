import { expect, test, type Page } from '@playwright/test';

async function answer(page: Page, opt: string, sents: string[]) {
  await page.getByTestId(`opt-${opt}`).check();
  for (const s of sents) await page.getByTestId(`sent-${s}`).click();
  await page.getByTestId('check').click();
}

test('офлайн: готовность, отключение сети, перезагрузка, задание и сохранённый прогресс', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });

  // Онлайн: верный ответ с неверной цитатой → уточнение → повтор
  await page.getByTestId('lesson-ru-saiga').click();
  await answer(page, 'b', ['s3']);
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-evidence', 'wrong');
  await expect(page.getByTestId('feedback')).toContainText('Ответ верный');
  await page.getByTestId('sent-s3').click();
  await page.getByTestId('sent-s1').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await page.getByText('← К урокам').click();
  await expect(page.getByTestId('progress-find')).toContainText('1 решено');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('progress-find')).toContainText('1 решено');
  await expect(page.getByTestId('progress-find')).toContainText('ошибок: 1');

  // Офлайн: казахский урок, вывод на двух предложениях
  await page.getByTestId('lesson-kk-library').click();
  await answer(page, 'a', ['s3']);
  await page.getByTestId('next').click();
  await answer(page, 'b', ['s2']);
  await page.getByTestId('next').click();
  await answer(page, 'a', ['s5']);
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-evidence', 'missing');
  await page.getByTestId('sent-s6').click();
  await page.getByTestId('check').click();
  await page.getByTestId('next').click();
  await expect(page.getByTestId('finished')).toBeVisible();
  await expect(page.getByTestId('recommendation')).toContainText('Қорытынды жасау');
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('question')).toContainText('тамшылатып');
  await page.getByText('← Сабақтарға').click();
  await expect(page.getByTestId('progress-infer')).toContainText('1 решено');
  await page.reload();
  await expect(page.getByTestId('progress-infer')).toContainText('1 решено');
  await expect(page.getByTestId('lesson-kk-library')).toContainText('Выполнено 3 из 3');
});

test('импорт: сломанный JSON отклоняется, корректный добавляется', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('import-file')).toHaveCount(0);
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-filename')).toHaveText('Файл не выбран');
  await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"id": "broken",') });
  await expect(page.getByTestId('import-errors')).toContainText('Некорректный JSON');
  const lesson = { id: 'imp-test', title: 'Импортированный', language: 'ru', grade: 8,
    sentences: [{ id: 's1', text: 'Кот спит.' }, { id: 's2', text: 'Пёс лает.' }],
    tasks: [{ id: 't1', skill: 'find', question: 'Кто спит?', options: [{ id: 'a', text: 'Кот' }, { id: 'b', text: 'Пёс' }], correctOptionId: 'a', evidenceSets: [['s1']], hint: 'Первое предложение' }] };
  await page.getByTestId('import-file').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lesson)) });
  await expect(page.getByTestId('import-ok')).toBeVisible();
  await expect(page.getByTestId('import-filename')).toContainText('ok.json');
  await expect(page.getByTestId('lesson-imp-test')).toBeVisible();
});


test('импорт урока с существующим ID: старый урок и прогресс сохраняются', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('lesson-ru-saiga').click();
  await answer(page, 'b', ['s1']);
  await page.getByText('← К урокам').click();
  await expect(page.getByTestId('lesson-ru-saiga')).toContainText('Выполнено 1 из 3');
  const original = (await import('../../lessons/ru-saiga.json', { with: { type: 'json' } })).default;
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('import-filename')).toHaveText('Файл не выбран');
  await page.getByTestId('import-file').setInputFiles({ name: 'same.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await expect(page.getByTestId('import-same')).toContainText('уже есть');
  const changed = { ...original, title: 'Сайгаки (новая версия)' };
  await page.getByTestId('import-file').setInputFiles({ name: 'changed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
  await expect(page.getByTestId('import-renamed')).toContainText('ru-saiga-v2');
  await expect(page.getByTestId('lesson-ru-saiga')).toContainText('Возвращение сайгаков');
  await expect(page.getByTestId('lesson-ru-saiga')).toContainText('Выполнено 1 из 3');
  await expect(page.getByTestId('lesson-ru-saiga-v2')).toContainText('Выполнено 0 из 3');
});

test('главная → «Начать урок» одним нажатием; два отдельных итога: ответ и доказательство', async ({ page }) => {
  await page.goto('/');
  const start = page.getByTestId('start-lesson');
  await expect(start).toHaveText(/Начать урок/);
  // Кнопка видна без прокрутки (в том числе на телефоне); навыки — ниже списка уроков.
  await expect(start).toBeInViewport();
  const lessonsY = (await page.getByTestId('lesson-ru-saiga').boundingBox())!.y;
  expect((await page.getByTestId('progress').boundingBox())!.y).toBeGreaterThan(lessonsY);
  await start.click();
  await expect(page.getByTestId('question')).toContainText('Когда у сайгаков начинается отёл?');

  // Ответ неверный, доказательство верное
  await answer(page, 'a', ['s1']);
  await expect(page.getByTestId('feedback-answer')).toHaveText('Ответ неверный');
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Доказательство верное');
  // Ответ верный, цитата неверная; исправление цитаты не сбрасывает выбранный ответ
  await page.getByTestId('opt-b').check();
  await page.getByTestId('sent-s1').click();
  await page.getByTestId('sent-s3').click();
  await expect(page.getByTestId('sent-s3')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback-answer')).toHaveText('Ответ верный');
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Цитата не подтверждает ответ');
  await page.getByTestId('sent-s3').click();
  await expect(page.getByTestId('opt-b')).toBeChecked();
  await page.getByTestId('sent-s1').click();
  await page.getByTestId('sent-s2').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Лишнее предложение');
  await expect(page.getByTestId('opt-b')).toBeChecked();
  await page.getByTestId('sent-s2').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await expect(page.getByTestId('feedback-answer')).toHaveText('Ответ верный');
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Доказательство верное');
  await expect(page.getByTestId('next')).toHaveText(/Следующее задание/);
  await page.getByTestId('next').click();
  await answer(page, 'c', ['s4']);
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Доказательства пока не хватает');

  // Урок не завершён — «Начать урок» снова открывает его первое задание
  await page.getByText('← К урокам').click();
  await expect(page.getByTestId('start-caption')).toContainText('«Возвращение сайгаков» · начнём с задания 1 из 3');
  await page.getByTestId('start-lesson').click();
  await expect(page.getByTestId('question')).toContainText('Когда у сайгаков');
});

test('қазақша: «Сабақты бастау» открывает казахский урок, итоги на языке урока', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('ui-lang').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Мәтінді оқы да, жауабыңды дәлелде');
  await expect(page.getByTestId('start-lesson')).toHaveText(/Сабақты бастау/);
  await expect(page.getByTestId('start-lesson')).toBeInViewport();
  await page.getByTestId('start-lesson').click();
  await expect(page.getByTestId('question')).toContainText('Балқаштың батысына');
  await answer(page, 'a', ['s2']);
  await expect(page.getByTestId('feedback-answer')).toHaveText('Жауап қате');
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Дәлел дұрыс');
  await page.getByTestId('opt-b').check();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback-answer')).toHaveText('Жауап дұрыс');
  await expect(page.getByTestId('next')).toHaveText(/Келесі тапсырма/);
});

test.describe('телефон 390×844 (касания)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('урок одним касанием, цитата, итоги, офлайн-перезапуск с прогрессом, ru и kk', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect(page.getByTestId('start-lesson')).toBeInViewport();
    await page.getByTestId('start-lesson').tap();
    await expect(page.getByTestId('question')).toContainText('Когда у сайгаков');
    // Вопрос виден сразу, до длинного текста
    await expect(page.getByTestId('question')).toBeInViewport();
    expect((await page.getByTestId('question').boundingBox())!.y).toBeLessThan((await page.getByTestId('text').boundingBox())!.y);
    await expect(page.getByTestId('to-text')).toBeVisible();
    await page.getByTestId('opt-b').tap();
    await page.getByTestId('to-text').tap();
    await expect(page.getByTestId('text-hint')).toBeInViewport();
    await page.getByTestId('sent-s1').tap();
    await expect(page.getByTestId('sent-s1')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('to-question').tap();
    await expect(page.getByTestId('question')).toBeInViewport();
    // Переходы не сбрасывают ни ответ, ни цитату
    await expect(page.getByTestId('opt-b')).toBeChecked();
    await expect(page.getByTestId('quotes')).toContainText('Ранней весной');
    await page.getByTestId('to-text').tap();
    await page.getByTestId('to-question').tap();
    await expect(page.getByTestId('opt-b')).toBeChecked();
    await expect(page.getByTestId('sent-s1')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('check').tap();
    await expect(page.getByTestId('feedback-answer')).toHaveText('Ответ верный');
    await expect(page.getByTestId('feedback-evidence')).toHaveText('Доказательство верное');
    await expect(page.getByTestId('next')).toBeVisible();
    await page.getByText('← К урокам').tap();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('progress-find')).toContainText('1 решено');
    await expect(page.getByTestId('lesson-ru-saiga')).toContainText('Выполнено 1 из 3');
    await page.getByTestId('ui-lang').tap();
    await expect(page.getByTestId('start-lesson')).toHaveText(/Сабақты бастау/);
    await page.getByTestId('start-lesson').tap();
    await page.getByTestId('opt-b').tap();
    await page.getByTestId('sent-s3').tap();
    await page.getByTestId('check').tap();
    await expect(page.getByTestId('feedback-answer')).toHaveText('Жауап дұрыс');
    await expect(page.getByTestId('feedback-evidence')).toHaveText('Үзінді жауапты дәлелдемейді');
  });
});

test('урок учителя (kk, docs/pitch): t2 с s3 → «екінші деректі тап», + s4 без повторного выбора ответа → засчитано', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-file').setInputFiles('docs/pitch/lesson-kk-after-teacher.json');
  await expect(page.getByTestId('import-ok')).toBeVisible();
  await expect(page.getByTestId('import-filename')).toContainText('lesson-kk-after-teacher.json');
  await page.getByTestId('lesson-gen-kk-mwyhudoe').click();
  await answer(page, 'b', ['s1']);
  await page.getByTestId('next').click();
  await answer(page, 'a', ['s3']);
  await expect(page.getByTestId('feedback-answer')).toHaveText('Жауап дұрыс');
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Дәлел әзірге жеткіліксіз');
  await expect(page.getByTestId('feedback-tip')).toHaveText('Екінші деректі тап — салыстыруға керек тағы бір сөйлем.');
  await page.getByTestId('sent-s4').click();
  await expect(page.getByTestId('opt-a')).toBeChecked();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await page.getByText('← Сабақтарға').click();
  await expect(page.getByTestId('lesson-gen-kk-mwyhudoe')).toContainText('Выполнено 2 из 3');
});

test('одновременный импорт из двух вкладок: исходный урок и прогресс целы, версии получают свои ID', async ({ context }) => {
  const base = (await import('../../lessons/ru-saiga.json', { with: { type: 'json' } })).default;
  const a = await context.newPage(), b = await context.newPage();
  await a.goto('/');
  // Прогресс по исходному уроку.
  await a.getByTestId('lesson-ru-saiga').click();
  await answer(a, 'b', ['s1']);
  await expect(a.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await a.goto('/');
  await expect(a.getByTestId('lesson-ru-saiga')).toContainText('1 из 3');
  await b.goto('/');
  for (const p of [a, b]) await p.getByTestId('import-open').click();
  const file = (title: string) => ({ name: `${title}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...base, title })) });
  await Promise.all([a.getByTestId('import-file').setInputFiles(file('Версия A')), b.getByTestId('import-file').setInputFiles(file('Версия B'))]);
  await expect(a.locator('[data-testid^="import-"][role="status"]')).toBeVisible();
  await expect(b.locator('[data-testid^="import-"][role="status"]')).toBeVisible();
  await a.reload();
  await expect(a.getByTestId('lesson-ru-saiga')).toContainText('Возвращение сайгаков');
  await expect(a.getByTestId('lesson-ru-saiga')).toContainText('1 из 3');
  await expect(a.getByTestId('lesson-ru-saiga-v2')).toBeVisible();
  await expect(a.getByTestId('lesson-ru-saiga-v3')).toBeVisible();
  const titles = [await a.getByTestId('lesson-ru-saiga-v2').innerText(), await a.getByTestId('lesson-ru-saiga-v3').innerText()].join(' ');
  expect(titles).toContain('Версия A');
  expect(titles).toContain('Версия B');
  // Повторный импорт того же файла не создаёт копию.
  await a.getByTestId('import-open').click();
  await a.getByTestId('import-file').setInputFiles(file('Версия A'));
  await expect(a.getByTestId('import-same')).toBeVisible();
  await a.reload();
  await expect(a.locator('[data-testid^="lesson-ru-saiga"]')).toHaveCount(3);
});
