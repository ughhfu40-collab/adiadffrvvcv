import { expect, test, type Page } from '@playwright/test';
import type { Lesson } from '../../shared/lesson';

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
  return JSON.parse(text as string) as Lesson;
}

async function evidenceText(page: Page, i: number, value: string) {
  await page.getByTestId(`t-ev-${i}`).locator('summary').click();
  await page.getByTestId(`t-evidence-${i}`).fill(value);
}

function waitForStoredQuestion(page: Page, question: string) {
  return page.waitForFunction(expected => new Promise<boolean>(resolve => {
    const open = indexedDB.open('oqy-reader');
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('drafts').objectStore('drafts').get('current');
      read.onerror = () => { db.close(); resolve(false); };
      read.onsuccess = () => {
        db.close();
        resolve(read.result?.data?.tasks?.[0]?.question === expected);
      };
    };
  }), question);
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

test('автоматическое название совпадает с языком урока в обоих режимах', async ({ page }) => {
  await page.getByTestId('t-lang').selectOption('kk');
  await generate(page, 'Бірінші сөйлем осында. Екінші сөйлем осында. Үшінші сөйлем осында.');
  expect((await exportJson(page)).title).toBe('Жаңа сабақ');
  await page.getByRole('button', { name: 'Составить вручную' }).click();
  await expect(page.getByTestId('t-draft').getByRole('textbox', { name: 'Название урока', exact: true })).toHaveValue('Жаңа сабақ');
});

test('текст, название и язык сохраняются до создания черновика', async ({ page, context }) => {
  const text = 'В первой строке цель урока.\nВо второй — расписание.';
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('t-title').fill('Расписание и цель');
  await page.getByTestId('t-lang').selectOption('kk');
  await page.getByTestId('t-text').fill(text);
  await page.getByTestId('mode-student').click();
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-title')).toHaveValue('Расписание и цель', { timeout: 4000 });
  await expect(page.getByTestId('t-lang')).toHaveValue('kk');
  await expect(page.getByTestId('t-text')).toHaveValue(text);
  await expect(page.getByTestId('t-draft')).toHaveCount(0);
});

test('поломанный JSON статуса генерации оставляет предыдущий черновик открытым', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  const question = page.getByTestId('t-task-0').getByPlaceholder('Вопрос');
  await question.fill('Ручная правка');
  await page.route('**/api/generate', route => route.fulfill({ status: 422, json: { ok: false, kind: 'structure', errors: 'Ожидался массив' } }));
  await page.getByTestId('t-generate').click();
  await expect(page.getByTestId('t-struct-error')).toBeVisible({ timeout: 4000 });
  await expect(question).toHaveValue('Ручная правка');
});

test('ответ модели не затирает правку, сделанную во время генерации', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  let release = () => {};
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/generate', async route => {
    await responseGate;
    await route.continue();
  });
  const question = page.getByTestId('t-task-0').getByPlaceholder('Вопрос');
  try {
    await page.getByTestId('t-text').fill('Первое. Второе. Третье. Четвёртое. Пятое.');
    await page.getByTestId('t-generate').click();
    await expect(page.getByTestId('t-elapsed')).toBeVisible();
    await question.fill('Правка во время генерации');
  } finally {
    release();
  }
  await expect(page.getByTestId('t-generate')).toHaveText(/Сгенерировать/);
  await expect(question).toHaveValue('Правка во время генерации', { timeout: 4000 });
  expect((await exportJson(page)).tasks[0]?.question).toBe('Правка во время генерации');
  await page.getByTestId('t-open-generated').click();
  await expect(question).toHaveValue('Вопрос t1');
  expect((await exportJson(page)).sentences).toHaveLength(5);
});

test('повторяющиеся ID можно исправить без удаления вопросов и вариантов', async ({ page }) => {
  await generate(page, 'МАРКЕР-ПОВТОР-ID в тексте. Второе предложение. Третье предложение.');
  const first = page.getByTestId('t-task-0');
  await expect(page.getByTestId('t-export')).toBeDisabled();
  await page.getByTestId('t-fix-ids-0').click({ timeout: 4000 });
  await expect(first.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(first.getByRole('textbox', { name: 'Вариант a', exact: true })).toHaveValue('Первый вариант');
  await expect(first.getByRole('textbox', { name: 'Вариант b', exact: true })).toHaveValue('Второй вариант');
  await expect(page.getByTestId('t-export')).toBeDisabled();
  await first.getByRole('radio', { name: 'Правильный ответ: b', exact: true }).check();
  await page.getByTestId('t-fix-ids-1').click();
  const lesson = await exportJson(page);
  expect(lesson.tasks.map(t => t.id)).toEqual(['t1', 't2', 't3']);
  expect(lesson.tasks[0]?.correctOptionId).toBe('b');
  expect(lesson.tasks.map(t => t.question)).toEqual(['Вопрос t1', 'Вопрос t1', 'Вопрос t3']);
});

test('одинаковые по тексту варианты блокируют экспорт до исправления', async ({ page }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  const option = page.getByTestId('t-task-0').getByRole('textbox', { name: 'Вариант b', exact: true });
  await option.fill('  ДА  ');
  await expect(page.getByTestId('t-task-issue-0')).toContainText('одинаковые варианты', { timeout: 4000 });
  await expect(page.getByTestId('t-export')).toBeDisabled();
  await option.fill('Нет');
  expect((await exportJson(page)).tasks[0]?.options.map(o => o.text)).toEqual(['Да', 'Нет']);
});

test('устаревшая правка в другой вкладке не стирает сохранённый черновик', async ({ page, context }) => {
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  const question = (p: Page) => p.getByTestId('t-task-0').getByPlaceholder('Вопрос');
  const initial = await question(page).inputValue();
  await waitForStoredQuestion(page, initial);
  const another = await context.newPage();
  try {
    await another.goto('/');
    await another.getByTestId('mode-teacher').click();
    await expect(question(another)).toHaveValue(initial);
    await question(page).fill('Правка из первой вкладки');
    await waitForStoredQuestion(page, 'Правка из первой вкладки');
    await question(another).fill('Правка из устаревшей вкладки');
    await expect(another.getByTestId('t-draft-storage-error')).toContainText('Черновик изменился в другой вкладке', { timeout: 4000 });
    await expect(question(another)).toHaveValue('Правка из устаревшей вкладки');
    await page.reload();
    await page.getByTestId('mode-teacher').click();
    await expect(question(page)).toHaveValue('Правка из первой вкладки');
  } finally {
    await another.close();
  }
});

test('сохранение отредактированного урока создаёт версию и сохраняет прежний прогресс', async ({ page }) => {
  const title = 'Урок с двумя версиями';
  await page.getByTestId('t-title').fill(title);
  await generate(page, 'Первое предложение. Второе предложение. Третье предложение.');
  const lesson = await exportJson(page);
  const first = lesson.tasks[0]!;
  const save = async () => {
    await page.getByTestId('t-save').click();
    await expect(page.getByTestId('t-saved')).toBeVisible();
  };
  await save();
  await page.getByTestId('mode-student').click();
  const original = page.getByTestId(`lesson-${lesson.id}`);
  await original.click();
  await page.getByTestId(`opt-${first.correctOptionId}`).check();
  for (const id of first.evidenceSets[0]!) await page.getByTestId(`sent-${id}`).click();
  await page.getByTestId('check').click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
  await page.getByTestId('mode-teacher').click();
  const changedQuestion = 'Как звучит новый вопрос?';
  await page.getByTestId('t-task-0').getByPlaceholder('Вопрос').fill(changedQuestion);
  await save();
  await save();
  expect((await exportJson(page)).id).toBe(`${lesson.id}-v2`);
  await page.getByTestId('mode-student').click();
  await expect(original).toContainText('Выполнено 1 из 3');
  const revised = page.getByTestId(`lesson-${lesson.id}-v2`);
  await expect(revised).toContainText('Выполнено 0 из 3', { timeout: 4000 });
  await expect(page.getByTestId(`lesson-${lesson.id}-v3`)).toHaveCount(0);
  await original.click();
  await expect(page.getByTestId('question')).toHaveText(first.question);
  await page.getByRole('button', { name: '← К урокам' }).click();
  await revised.click();
  await expect(page.getByTestId('question')).toHaveText(changedQuestion);
});

test('незаполненный ручной черновик восстанавливается после офлайн-перезагрузки', async ({ page, context }) => {
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const question = 'Как меняется расписание?';
  await page.getByTestId('t-title').fill('Расписание');
  await page.getByTestId('t-text').fill('Первая встреча состоится утром. Вторую встречу перенесли на вечер.');
  await page.getByRole('button', { name: 'Составить вручную' }).click();
  await page.getByTestId('t-task-0').getByPlaceholder('Вопрос').fill(question);
  await waitForStoredQuestion(page, question);
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-task-0').getByPlaceholder('Вопрос')).toHaveValue(question, { timeout: 4000 });
  await expect(page.getByTestId('t-save')).toBeDisabled();
  await expect(page.getByTestId('t-export')).toBeDisabled();
});

test('черновик с повтором и пропуском типа можно исправить и экспортировать', async ({ page }) => {
  await generate(page, 'МАРКЕР-ДУБЛЬ начинается урок. Второе предложение. Третье предложение.');
  await expect(page.getByTestId('t-quality')).toContainText('Нет задания типа «Сделать вывод»');
  await page.getByTestId('t-remove-task-2').click({ timeout: 4000 });
  await page.getByTestId('t-add-task').click();
  const task = page.getByTestId('t-task-2');
  await expect(task.getByRole('combobox')).toHaveValue('infer');
  await task.getByPlaceholder('Вопрос').fill('Какой вывод можно сделать?');
  await task.getByPlaceholder('Подсказка').fill('Свяжи первое и второе предложения.');
  await task.getByRole('textbox', { name: 'Вариант a', exact: true }).fill('Верный вариант');
  await task.getByRole('textbox', { name: 'Вариант b', exact: true }).fill('Неверный вариант');
  await task.getByRole('textbox', { name: 'Вариант c', exact: true }).fill('Ещё один вариант');
  await page.getByTestId('t-ev-2-s1').click();
  await page.getByTestId('t-ev-2-s2').click();
  const lesson = await exportJson(page);
  expect(lesson.tasks.map(t => t.skill)).toEqual(['find', 'match', 'infer']);
  expect(lesson.tasks[2]?.evidenceSets).toEqual([['s1', 's2']]);
});

test('повреждённый статус API не ломает редактор и ручной черновик доступен', async ({ page }) => {
  await page.getByTestId('mode-student').click();
  await page.route('**/api/health', route => route.fulfill({ json: { server: 'ok' } }));
  await page.getByTestId('mode-teacher').click();
  await expect(page.getByTestId('t-health')).toContainText('Сервер генерации недоступен', { timeout: 4000 });
  await page.getByTestId('t-text').fill('Первое предложение. Второе предложение.');
  await page.getByRole('button', { name: 'Составить вручную' }).click();
  await expect(page.getByTestId('t-task-0')).toBeVisible();
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

test('учитель → экспорт → импорт в новом профиле → решение офлайн и сохранение прогресса', async ({ page, browser, baseURL }, info) => {
  await page.getByTestId('t-title').fill('Кітап көрмесі');
  await page.getByTestId('t-lang').selectOption('kk');
  await generate(page, 'Ертең мектепте кітап көрмесі ашылады. Көрмеге оқушылар үйден кітап әкеледі. Көрме жұма күні жабылады.');
  const firstTask = page.getByTestId('t-task-0');
  await firstTask.getByPlaceholder('Вопрос').fill('Көрме қашан ашылады?');
  await firstTask.getByRole('radio').first().check();
  await page.getByTestId('t-ev-0-s3').click();
  await page.getByTestId('t-ev-0-s1').click();
  await page.getByTestId('t-save').click();
  await expect(page.getByTestId('t-saved')).toBeVisible();
  const lesson = await exportJson(page);
  expect(lesson.tasks[0]).toMatchObject({ question: 'Көрме қашан ашылады?', evidenceSets: [['s1']] });

  const mobile = info.project.name === 'mobile';
  const learner = await browser.newContext({ baseURL, viewport: page.viewportSize(), isMobile: mobile, hasTouch: mobile });
  try {
    const pupil = await learner.newPage();
    await pupil.goto('/');
    await expect(pupil.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await pupil.getByTestId('ui-lang').click();
    await pupil.getByTestId('import-open').click();
    await pupil.getByTestId('import-file').setInputFiles({ name: 'lesson.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lesson)) });
    await expect(pupil.getByTestId('import-ok')).toBeVisible();
    await learner.setOffline(true);
    await pupil.reload();
    const networkBlocked = await pupil.evaluate(() => fetch('/version.json?probe=' + Date.now(), { cache: 'no-store' }).then(() => false, () => true));
    expect(networkBlocked).toBe(true);
    const lessonCard = pupil.getByTestId(`lesson-${lesson.id}`);
    await lessonCard.click();
    await pupil.getByTestId(`opt-${lesson.tasks[0]!.correctOptionId}`).check();
    await pupil.getByTestId('sent-s1').click();
    await pupil.getByTestId('check').click();
    await expect(pupil.getByTestId('feedback')).toHaveAttribute('data-solved', 'true');
    await pupil.reload();
    await expect(lessonCard).toContainText('3 тапсырманың 1-і орындалды');
    await expect(pupil.getByText('Дағдылар бойынша прогресс')).toBeVisible();
  } finally {
    await learner.close();
  }
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
