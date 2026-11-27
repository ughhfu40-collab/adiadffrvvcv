import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Lesson } from '../../shared/lesson';

test.use({ locale: 'ru-RU' });

const source = 'В школьной библиотеке устроили выставку. Ученики принесли книги. Выставка открыта до пятницы.';

function builtin(id: string): Lesson {
  return JSON.parse(readFileSync(`lessons/${id}.json`, 'utf8')) as Lesson;
}

async function startTeacher(page: Page) {
  await page.addInitScript(() => {
    const target = window as Window & { exportedLesson?: string };
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (value: Blob | MediaSource) => {
      if (value instanceof Blob && value.type === 'application/json') {
        void value.text().then((json) => { target.exportedLesson = json; });
      }
      return createObjectURL(value);
    };
  });
  await page.goto('/');
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-grade')).toHaveValue('8');
}

async function exportLesson(page: Page): Promise<Lesson> {
  await page.evaluate(() => { delete (window as Window & { exportedLesson?: string }).exportedLesson; });
  await page.getByTestId('t-export').click();
  const result = await page.waitForFunction(() => (window as Window & { exportedLesson?: string }).exportedLesson);
  const json = await result.jsonValue();
  if (typeof json !== 'string') throw new Error('Экспорт урока не создал JSON');
  return JSON.parse(json) as Lesson;
}

test('каталог 7–9 классов, запуск нужного урока и его прогресс после офлайн-перезагрузки', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('grade-all')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('grade-8').click();
  await expect(page.getByTestId('lesson-ru-saiga')).toBeVisible();
  await expect(page.getByTestId('lesson-kk-balkhash')).toBeVisible();
  await expect(page.getByTestId('lesson-ru-garden')).toHaveCount(0);

  await page.getByTestId('grade-9').click();
  await expect(page.getByTestId('grade-9')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lesson-ru-noise')).toBeVisible();
  await expect(page.getByTestId('lesson-kk-canteen')).toBeVisible();
  await expect(page.getByTestId('lesson-ru-saiga')).toHaveCount(0);

  const lesson = builtin('ru-garden');
  const firstTask = lesson.tasks[0]!;
  await page.getByTestId('grade-7').click();
  await expect(page.getByTestId('lesson-ru-garden')).toBeVisible();
  await expect(page.getByTestId('lesson-kk-feeder')).toBeVisible();
  await expect(page.getByTestId('lesson-ru-noise')).toHaveCount(0);
  await expect(page.getByTestId('start-caption')).toContainText(lesson.title);
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('grade-7')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('start-lesson').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(lesson.title);
  await expect(page.getByTestId('question')).toHaveText(firstTask.question);
  await page.getByTestId(`opt-${firstTask.correctOptionId}`).check();
  for (const sentence of firstTask.evidenceSets[0]!) {
    await page.getByTestId(`sent-${sentence}`).click();
  }
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await page.reload();
  await expect(page.getByTestId('grade-7')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lesson-ru-garden')).toContainText('Выполнено 1 из 3');
});

test('импорт урока другого класса показывает его в нужном каталоге', async ({ page }) => {
  const imported = { ...builtin('ru-noise'), id: 'import-grade9', title: 'Мой урок для девятого класса' };
  await page.goto('/');
  await page.getByTestId('grade-8').click();
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'lesson-grade9.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.getByTestId('grade-9')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lesson-import-grade9')).toContainText(imported.title);
  await expect(page.getByTestId('lesson-ru-saiga')).toHaveCount(0);
  await page.getByTestId('grade-8').click();
  await expect(page.getByTestId('lesson-import-grade9')).toHaveCount(0);
  await page.getByTestId('grade-9').click();
  await expect(page.getByTestId('lesson-import-grade9')).toContainText('9 класс');
});

test('генерация учителя передаёт выбранный класс в запросе и JSON', async ({ page }) => {
  await startTeacher(page);
  await page.getByTestId('t-grade').selectOption('9');
  await page.getByTestId('t-text').fill(source);
  const generating = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/generate');
  await page.getByTestId('t-generate').click();
  const response = await generating;
  expect(response.request().postDataJSON()).toMatchObject({ grade: 9 });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, lesson: { grade: 9 } });
  expect((await exportLesson(page)).grade).toBe(9);
});

test('ручной черновик сохраняет класс при офлайн-перезагрузке и экспорте', async ({ page, context }) => {
  const example = builtin('ru-garden');
  await startTeacher(page);
  await page.getByTestId('t-grade').selectOption('7');
  await page.getByTestId('t-text').fill(example.sentences.map(({ text }) => text).join(' '));
  await page.getByRole('button', { name: 'Составить вручную' }).click();
  for (const [i, task] of example.tasks.entries()) {
    const block = page.getByTestId(`t-task-${i}`);
    await block.getByPlaceholder('Вопрос').fill(task.question);
    await block.getByPlaceholder('Подсказка').fill(task.hint);
    for (const option of task.options) {
      await block.getByRole('textbox', { name: `Вариант ${option.id}`, exact: true }).fill(option.text);
    }
    await block.getByRole('radio', { name: `Правильный ответ: ${task.correctOptionId}`, exact: true }).check();
    for (const sentence of task.evidenceSets[0]!) {
      await page.getByTestId(`t-ev-${i}-${sentence}`).click();
    }
  }
  expect((await exportLesson(page)).grade).toBe(7);
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-grade')).toHaveValue('7');
  expect((await exportLesson(page)).grade).toBe(7);
});

test('старый запрос без класса генерирует урок для 8 класса, а неизвестный класс отклоняется', async ({ request }) => {
  const valid = await request.post('/api/generate', { data: { text: source, language: 'ru' } });
  expect(valid.ok()).toBe(true);
  expect(await valid.json()).toMatchObject({ ok: true, lesson: { grade: 8 } });

  const invalid = await request.post('/api/generate', { data: { text: source, language: 'ru', grade: 10 } });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({ ok: false, kind: 'input' });
});
