import { expect, test, type Page } from '@playwright/test';

async function generate(page: Page, text: string) {
  await page.getByTestId('t-text').fill(text);
  await page.getByTestId('t-generate').click();
  await expect(page.getByTestId('t-generate')).toHaveText(/Сгенерировать/);
}

/** Экспорт: содержимое берём из Blob, переданного в URL.createObjectURL (работает на всех профилях);
 *  на ноутбучном профиле дополнительно проверяем, что браузер действительно скачал файл. */
async function exportJson(page: Page) {
  const mobile = page.viewportSize()!.width < 768;
  const dl = mobile ? null : page.waitForEvent('download');
  await page.evaluate(() => { (window as unknown as { __exports: string[] }).__exports = []; });
  await page.getByTestId('t-export').click();
  const text = await page.waitForFunction(() => (window as unknown as { __exports: string[] }).__exports[0]).then((h) => h.jsonValue());
  if (dl) {
    const { readFile } = await import('node:fs/promises');
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    expect(await readFile((await download.path())!, 'utf8')).toBe(text);
  }
  return JSON.parse(text as string) as { sentences: { id: string }[]; tasks: { evidenceSets: string[][] }[] };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob) void obj.text().then((t) => (window as unknown as { __exports?: string[] }).__exports?.push(t));
      return orig(obj);
    };
  });
  await page.goto('/');
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-health')).toContainText('Ollama готова');
});

test('два черновика подряд: поле доказательств и экспорт показывают второй', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s3');
  await expect(page.getByTestId('t-evidence-2')).toHaveValue('s1,s2; s2,s3');
  expect((await exportJson(page)).tasks[0]!.evidenceSets).toEqual([['s3']]);

  await generate(page, 'Альфа идёт. Бета идёт. Гамма идёт. Дельта идёт. Эпсилон идёт.');
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s5');
  await expect(page.getByTestId('t-evidence-1')).toHaveValue('s1,s5');
  await expect(page.getByTestId('t-evidence-2')).toHaveValue('s1,s2; s2,s5');
  const json = await exportJson(page);
  expect(json.sentences).toHaveLength(5);
  expect(json.tasks.map((t) => t.evidenceSets)).toEqual([[['s5']], [['s1', 's5']], [['s1', 's2'], ['s2', 's5']]]);
});

for (const marker of ['МАРКЕР-TASKS', 'МАРКЕР-OPTIONS']) {
  test(`неверная структура (${marker}): ошибка и сохранённый предыдущий черновик`, async ({ page }) => {
    await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
    await page.getByTestId('t-evidence-0').fill('s2');
    await generate(page, `${marker} первое. Второе. Третье.`);
    await expect(page.getByTestId('t-struct-error')).toContainText('неверную структуру');
    await expect(page.getByTestId('t-struct-error')).toContainText('Предыдущий черновик сохранён');
    await expect(page.getByTestId('t-evidence-0')).toHaveValue('s2');
    expect((await exportJson(page)).tasks[0]!.evidenceSets).toEqual([['s2']]);
  });
}

test('ошибка только в ID: черновик открывается, учитель исправляет и экспортирует', async ({ page }) => {
  await generate(page, 'МАРКЕР-ID первое. Второе. Третье.');
  await expect(page.getByTestId('t-draft')).toContainText('исправьте поля');
  await expect(page.getByTestId('t-errors')).toContainText('s99');
  await expect(page.getByTestId('t-export')).toBeDisabled();
  await page.getByTestId('t-evidence-0').fill('s1');
  await page.getByTestId('t-draft').locator('fieldset').nth(1).locator('input[type=radio]').first().check();
  await expect(page.getByTestId('t-errors')).toHaveCount(0);
  const json = await exportJson(page);
  expect(json.tasks[0]!.evidenceSets).toEqual([['s1']]);
});
