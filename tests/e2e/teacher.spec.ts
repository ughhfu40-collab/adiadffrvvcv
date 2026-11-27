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

async function evidenceText(page: Page, i: number, value: string) {
  await page.getByTestId(`t-ev-${i}`).locator('summary').click();
  await page.getByTestId(`t-evidence-${i}`).fill(value);
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
  await expect(page.getByTestId('t-health')).toContainText('Ollama готова · модель fake');
});

test('e2e работает только с поддельной моделью, а не с настоящей Ollama', async ({ page }) => {
  const health = await (await page.request.get('/api/health')).json();
  expect(health.ollama).toMatchObject({ ok: true, model: 'fake', url: `http://127.0.0.1:${process.env.E2E_FAKE_PORT ?? '11535'}` });
  expect(health.timeoutSec).toBe(5);
});

test('два черновика подряд: поле доказательств и экспорт показывают второй', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s3');
  await expect(page.getByTestId('t-evidence-2')).toHaveValue('s1,s2; s2,s3');
  expect((await exportJson(page)).tasks[0]!.evidenceSets).toEqual([['s3']]);

  await generate(page, 'Альфа идёт. Бета идёт. Гамма идёт. Дельта идёт. Эпсилон идёт.');
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s5');
  // Редактор не должен вылезать за ширину экрана (иначе поля перекрывают кнопки на телефоне).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId('t-evidence-1')).toHaveValue('s1,s5');
  await expect(page.getByTestId('t-evidence-2')).toHaveValue('s1,s2; s2,s5');
  const json = await exportJson(page);
  expect(json.sentences).toHaveLength(5);
  expect(json.tasks.map((t) => t.evidenceSets)).toEqual([[['s5']], [['s1', 's5']], [['s1', 's2'], ['s2', 's5']]]);
});

for (const marker of ['МАРКЕР-TASKS', 'МАРКЕР-OPTIONS']) {
  test(`неверная структура (${marker}): ошибка и сохранённый предыдущий черновик`, async ({ page }) => {
    await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
    await page.getByTestId('t-ev-0-s2').click();
    await page.getByTestId('t-ev-0-s3').click();
    await expect(page.getByTestId('t-evidence-0')).toHaveValue('s2');
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
  await evidenceText(page, 0, 's1');
  await page.getByTestId('t-task-1').locator('input[type=radio]').first().check();
  await expect(page.getByTestId('t-errors')).toHaveCount(0);
  const json = await exportJson(page);
  expect(json.tasks[0]!.evidenceSets).toEqual([['s1']]);
});

test('сопоставление на одном предложении: задание подсвечено, учитель добавляет второе нажатием', async ({ page }) => {
  await generate(page, 'МАРКЕР-QUALITY первое. Второе предложение. Третье предложение.');
  await expect(page.getByTestId('t-quality')).toContainText('минимум два разных предложения');
  await expect(page.getByTestId('t-task-1')).toHaveAttribute('data-issue', 'true');
  await expect(page.getByTestId('t-export')).toBeDisabled();
  await page.getByTestId('t-ev-1-s3').click();
  await expect(page.getByTestId('t-ev-1-s3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('t-quality')).toHaveCount(0);
  await expect(page.getByTestId('t-task-1')).toHaveAttribute('data-issue', 'false');
  expect((await exportJson(page)).tasks[1]!.evidenceSets).toEqual([['s2', 's3']]);
});

test('несколько допустимых наборов доказательств задаются нажатиями', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение.');
  await page.getByTestId('t-ev-1-add').click();
  await page.getByTestId('t-ev-1-s2').click();
  await page.getByTestId('t-ev-1-s3').click();
  await expect(page.getByTestId('t-ev-1-set-1')).toContainText('s2, s3');
  await page.getByTestId('t-ev-1-set-0').click();
  await expect(page.getByTestId('t-ev-1-s1')).toHaveAttribute('aria-pressed', 'true');
  expect((await exportJson(page)).tasks[1]!.evidenceSets).toEqual([['s1', 's4'], ['s2', 's3']]);
  await page.getByTestId('t-ev-1-del-0').click();
  expect((await exportJson(page)).tasks[1]!.evidenceSets).toEqual([['s2', 's3']]);
});

test('отмена генерации: виден таймер, черновик и правки сохраняются', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  await page.getByTestId('t-ev-0-s2').click();
  await page.getByTestId('t-text').fill('МАРКЕР-SLOW первое. Второе предложение. Третье предложение.');
  await page.getByTestId('t-generate').click();
  await expect(page.getByTestId('t-elapsed')).toContainText(/0:0[1-9]/);
  await page.getByTestId('t-cancel').click();
  await expect(page.getByTestId('t-msg-cancelled')).toBeVisible();
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s2,s3');
  expect((await exportJson(page)).tasks[0]!.evidenceSets).toEqual([['s2', 's3']]);
});

test('таймаут: отдельное сообщение, черновик сохраняется', async ({ page }) => {
  test.setTimeout(30_000);
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  await page.getByTestId('t-ev-0-s1').click();
  await page.getByTestId('t-text').fill('МАРКЕР-SLOW первое. Второе предложение. Третье предложение.');
  await page.getByTestId('t-generate').click();
  await expect(page.getByTestId('t-msg-timeout')).toContainText('5 с', { timeout: 15_000 });
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s1,s3');
});

test('интерфейс переключается на қазақша и запоминает выбор', async ({ page }) => {
  await page.getByTestId('ui-lang').click();
  await expect(page.getByTestId('t-generate')).toHaveText('Жоба жасау (Ollama)');
  await expect(page.getByTestId('mode-student')).toHaveText('Оқушы');
  await page.reload();
  await expect(page.getByTestId('mode-teacher')).toHaveText('Мұғалім');
  await page.getByTestId('mode-student').click();
  await expect(page.getByText('Дағдылар бойынша прогресс')).toBeVisible();
  await page.getByTestId('ui-lang').click();
  await expect(page.getByText('Прогресс по навыкам')).toBeVisible();
});

test('разрыв соединения во время генерации: черновик и правки целы, повторный запрос успешен', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  await page.getByTestId('t-ev-0-s2').click();
  await page.getByTestId('t-task-0').getByPlaceholder(/Вопрос/).fill('Правка учителя');
  // Соединение рвётся на середине запроса генерации.
  await page.route('**/api/generate', (route) => route.abort('connectionreset'), { times: 1 });
  await page.getByTestId('t-text').fill('Альфа идёт. Бета идёт. Гамма идёт. Дельта идёт.');
  await page.getByTestId('t-generate').click();
  await expect(page.getByTestId('t-msg-server-down')).toBeVisible();
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s2,s3');
  await expect(page.getByTestId('t-task-0').getByPlaceholder(/Вопрос/)).toHaveValue('Правка учителя');
  // После перезагрузки черновик восстанавливается из IndexedDB.
  await page.reload();
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-task-0').getByPlaceholder(/Вопрос/)).toHaveValue('Правка учителя');
  // Повтор проходит.
  await generate(page, 'Альфа идёт. Бета идёт. Гамма идёт. Дельта идёт.');
  await expect(page.getByTestId('t-evidence-0')).toHaveValue('s4');
});

test('пустой текст из пробелов и точек: генерация недоступна, модель не вызывается', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/generate', (route) => { calls++; return route.continue(); });
  await page.getByTestId('t-text').fill('   .   .   .   .   .   .   ');
  await expect(page.getByTestId('t-generate')).toBeDisabled();
  const res = await page.request.post('/api/generate', { data: { text: ' '.repeat(40), language: 'ru' } });
  expect(res.status()).toBe(400);
  expect(calls).toBe(0);
});
