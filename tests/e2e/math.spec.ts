import { expect, test, type Page } from '@playwright/test';

const RU7 = 'math-ru-7-trip';

async function solveT1(page: Page) {
  await page.getByTestId('opt-a').check();
  await page.getByTestId('sent-s3').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await page.getByTestId('next').click();
}

test('раздел «Математика»: свои уроки и прогресс, выбор раздела, класса и языка восстанавливается после перезагрузки', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('subject-reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="lesson-math-"]')).toHaveCount(0);
  await page.getByTestId('subject-math').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Разбери ситуацию');
  await expect(page.locator('[data-testid^="lesson-"]')).toHaveCount(6);
  await expect(page.getByTestId('lesson-ru-saiga')).toHaveCount(0);
  await expect(page.getByTestId('progress-match')).toContainText('Посчитать');
  await page.getByTestId('grade-9').click();
  await expect(page.locator('[data-testid^="lesson-"]')).toHaveCount(2);
  await page.getByTestId('ui-lang').click();
  await page.reload();
  await expect(page.getByTestId('subject-math')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('grade-9')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lesson-math-kk-9-internet')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Жағдайды талдап');
  // Чтение не пострадало
  await page.getByTestId('subject-reading').click();
  await expect(page.getByTestId('lesson-ru-noise')).toBeVisible();
});

test('обязательный сценарий: верный ответ с неполными данными → подсказка → добавить данные → расчёт → офлайн → перезагрузка → прогресс', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('subject-math').click();
  await page.getByTestId(`lesson-${RU7}`).click();
  await solveT1(page);
  // t2: верный ответ, но только цена билета и число учеников — без автобуса и собранной суммы.
  await page.getByTestId('opt-a').check();
  await page.getByTestId('sent-s1').click();
  await page.getByTestId('sent-s2').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-evidence', 'missing');
  await expect(page.getByTestId('feedback-answer')).toHaveText('Ответ верный');
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Данных пока не хватает');
  await expect(page.getByTestId('feedback-evidence-mark')).toHaveAttribute('data-state', 'partial');
  await expect(page.getByTestId('feedback-tip')).toContainText('Найди, какой величины не хватает');
  await expect(page.getByTestId('feedback-tip')).toContainText('цена автобуса');
  await expect(page.getByTestId('opt-a')).toBeChecked();
  // Добавляем данные без повторного выбора ответа → засчитано и виден расчёт с единицами.
  await page.getByTestId('sent-s3').click();
  await page.getByTestId('sent-s4').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await expect(page.getByTestId('solution')).toContainText('24 × 600 ₸ = 14 400 ₸');
  await expect(page.getByTestId('solution')).toContainText('2 600 ₸');
  // Проверка на прочность: без суммы, собранной родителями, ответ не получить.
  await page.getByTestId('proof-test').locator('summary').click();
  await page.getByTestId('proof-remove-s4').check();
  await page.getByTestId('proof-insufficient').click();
  await expect(page.getByTestId('proof-feedback')).toHaveAttribute('data-correct', 'true');
  await expect(page.getByTestId('proof-feedback')).toContainText('Без этого данного');
  // Офлайн и перезагрузка — прогресс и раздел на месте.
  await context.setOffline(true);
  await page.reload();
  const blocked = await page.evaluate(() => fetch(`${location.origin}/__probe?${Date.now()}`, { cache: 'no-store' }).then(() => false, () => true));
  expect(blocked).toBe(true);
  await expect(page.getByTestId('subject-math')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`lesson-${RU7}`)).toContainText('2 из 3');
  await expect(page.getByTestId('progress-match')).toContainText('1');
  // Чтение не получило чужой прогресс.
  await page.getByTestId('subject-reading').click();
  await expect(page.getByTestId('lesson-ru-garden')).toContainText('0 из 3');
});

test('неверная строка данных — «не нужны для ответа», красный крестик', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('subject-math').click();
  await page.getByTestId(`lesson-${RU7}`).click();
  await page.getByTestId('opt-a').check();
  await page.getByTestId('sent-s6').click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback-evidence')).toHaveText('Эти данные не нужны для ответа');
  await expect(page.getByTestId('feedback-evidence-mark')).toHaveAttribute('data-state', 'bad');
});

test('старый JSON урока чтения без поля subject импортируется в «Чтение»', async ({ page }) => {
  const old = (await import('../../lessons/ru-saiga.json', { with: { type: 'json' } })).default as Record<string, unknown>;
  const legacy = { ...old, id: 'legacy-reading', title: 'Старый урок' };
  delete (legacy as { subject?: string }).subject;
  await page.goto('/');
  await page.getByTestId('subject-math').click();
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await expect(page.getByTestId('import-ok')).toBeVisible();
  await expect(page.getByTestId('subject-reading')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lesson-legacy-reading')).toBeVisible();
});
