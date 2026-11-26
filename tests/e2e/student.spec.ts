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
  await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"id": "broken",') });
  await expect(page.getByTestId('import-errors')).toContainText('Некорректный JSON');
  const lesson = { id: 'imp-test', title: 'Импортированный', language: 'ru', grade: 8,
    sentences: [{ id: 's1', text: 'Кот спит.' }, { id: 's2', text: 'Пёс лает.' }],
    tasks: [{ id: 't1', skill: 'find', question: 'Кто спит?', options: [{ id: 'a', text: 'Кот' }, { id: 'b', text: 'Пёс' }], correctOptionId: 'a', evidenceSets: [['s1']], hint: 'Первое предложение' }] };
  await page.getByTestId('import-file').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lesson)) });
  await expect(page.getByTestId('import-ok')).toBeVisible();
  await expect(page.getByTestId('lesson-imp-test')).toBeVisible();
});

