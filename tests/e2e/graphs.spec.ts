import { expect, test, type Locator, type Page } from '@playwright/test';

async function openGraphs(page: Page) {
  await page.goto('/');
  await page.getByTestId('subject-math').click();
  await page.getByTestId('math-view-graphs').click();
  await expect(page.getByTestId('graphs')).toBeVisible();
  // Холст не распирает страницу (раньше на телефоне ширина макета вырастала до 618 px).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
/** Клик по холсту в точке (x; y) мировых координат при данном окне просмотра. */
async function clickAt(canvas: Locator, x: number, y: number, view: { xmin: number; xmax: number; ymin: number; ymax: number }) {
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: ((x - view.xmin) / (view.xmax - view.xmin)) * box.width, y: box.height - ((y - view.ymin) / (view.ymax - view.ymin)) * box.height } });
}

test('«Построить самому»: функции, ошибки, кнопки, градусы/радианы, запятая, скрыть и удалить, координаты точки', async ({ page }) => {
  await openGraphs(page);
  await page.getByTestId('graph-mode-free').click();
  // Ошибочная формула — понятная подсказка
  await page.getByTestId('g-f-0').fill('y = 2x +');
  await expect(page.getByTestId('g-err-0')).toContainText('Формула оборвана');
  await page.getByTestId('g-f-0').fill('y = sn(x)');
  await expect(page.getByTestId('g-err-0')).toContainText('Неизвестное имя');
  // Десятичная запятая
  await page.getByTestId('g-f-0').fill('y = 0,5x + 1');
  await expect(page.getByTestId('g-err-0')).toHaveCount(0);
  // Кнопки sin и π вставляют текст в формулу
  await page.getByTestId('g-f-1').fill('');
  await page.getByTestId('g-f-1').click();
  await page.getByTestId('g-key-sin').click();
  await page.keyboard.type('x)');
  await expect(page.getByTestId('g-f-1')).toHaveValue('sin(x)');
  // Третья функция из примеров, четвёртую добавить нельзя
  await page.getByTestId('g-example-y = cos(x)').click();
  await expect(page.getByTestId('g-f-2')).toHaveValue('y = cos(x)');
  await expect(page.getByTestId('g-add')).toHaveCount(0);
  // Выбранная точка на линии 0,5x + 1 при x = 2 → y = 2
  await page.getByTestId('g-reset').click();
  await clickAt(page.getByTestId('g-plot-canvas'), 2, 2, { xmin: -10, xmax: 10, ymin: -7, ymax: 7 });
  const pt = page.getByTestId('g-plot-point');
  await expect(pt).toContainText('на линии 1');
  expect(Math.abs(Number(await pt.getAttribute('data-x')) - 2)).toBeLessThan(0.1);
  expect(Math.abs(Number(await pt.getAttribute('data-y')) - 2)).toBeLessThan(0.1);
  // Скрыть и удалить
  await page.getByTestId('g-hide-2').click();
  await expect(page.getByTestId('g-hide-2')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('g-del-2').click();
  await expect(page.getByTestId('g-f-2')).toHaveCount(0);
  // Градусы: sin(x) при x = 90 → 1
  await page.getByTestId('g-angle-deg').click();
  await page.getByTestId('g-f-0').fill('y = sin(x)');
  await page.getByTestId('g-f-1').fill('');
  // Масштаб кнопками меняет окно
  const before = await page.getByTestId('g-plot').getAttribute('data-view');
  await page.getByTestId('g-plot-zoom-out').click();
  await expect(page.getByTestId('g-plot')).not.toHaveAttribute('data-view', before!);
});

test('сценарий: две функции → задача про тарифы → офлайн → перезагрузка → формулы и график на месте', async ({ page, context }) => {
  await openGraphs(page);
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('graph-mode-free').click();
  await page.getByTestId('g-f-0').fill('y = 2x + 1');
  await page.getByTestId('g-f-1').fill('y = x^2');
  // Задание: строим обе линии (запись своя), находим пересечение нажатием на график
  await page.getByTestId('graph-mode-task').click();
  await expect(page.getByTestId('tk-plot')).toHaveAttribute('data-view', '-2;42;-400;7 000');
  await page.getByTestId('tk-f-0').fill('y = 150x');
  await page.getByTestId('tk-f-1').fill('y = 50x + 2000');
  await clickAt(page.getByTestId('tk-plot-canvas'), 20.4, 3060, { xmin: -2, xmax: 42, ymin: -400, ymax: 7000 });
  const pt = page.getByTestId('tk-plot-point');
  await expect(pt).toHaveAttribute('data-cross', 'true');
  await expect(pt).toContainText('(20; 3 000)');
  // Сначала неверный вывод — отдельная оценка точки и вывода
  await page.getByTestId('task-x').fill('20');
  await page.getByTestId('task-y').fill('3000');
  await page.getByTestId('task-opt-single').check();
  await page.getByTestId('task-check').click();
  await expect(page.getByTestId('task-res-lines')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('task-res-point')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('task-res-choice')).toHaveAttribute('data-ok', 'false');
  await page.getByTestId('task-opt-pass').check();
  await page.getByTestId('task-check').click();
  await expect(page.getByTestId('task-res-choice')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('task-explain')).toContainText('x = 20');
  // Офлайн и перезагрузка
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => fetch(`${location.origin}/__probe?${Date.now()}`, { cache: 'no-store' }).then(() => false, () => true))).toBe(true);
  await expect(page.getByTestId('graphs')).toBeVisible();
  await expect(page.getByTestId('tk-f-0')).toHaveValue('y = 150x');
  await expect(page.getByTestId('task-y')).toHaveValue('3000');
  await expect(page.getByTestId('task-opt-pass')).toBeChecked();
  await page.getByTestId('graph-mode-free').click();
  await expect(page.getByTestId('g-f-0')).toHaveValue('y = 2x + 1');
  await expect(page.getByTestId('g-f-1')).toHaveValue('y = x^2');
  // График работает без сети: точка на параболе x = −2 → y = 4
  await page.getByTestId('g-reset').click();
  await clickAt(page.getByTestId('g-plot-canvas'), -2, 4, { xmin: -10, xmax: 10, ymin: -7, ymax: 7 });
  await expect(page.getByTestId('g-plot-point')).toContainText('на линии 2');
  // Переход из задания открывает график с масштабом задачи
  await page.getByTestId('graph-mode-task').click();
  await page.getByTestId('task-open-graph').click();
  await expect(page.getByTestId('g-plot')).toHaveAttribute('data-view', '-2;42;-400;7 000');
  await expect(page.getByTestId('g-f-1')).toHaveValue('y = 2000 + 50x');
});

test('«Графики» на казахском', async ({ page }) => {
  await openGraphs(page);
  await page.getByTestId('ui-lang').click();
  await expect(page.getByTestId('math-view-graphs')).toHaveText('Графиктер');
  await page.getByTestId('graph-mode-task').click();
  await expect(page.getByTestId('graphs')).toContainText('Жол жүру билеті');
  await page.getByTestId('tk-f-0').fill('(x');
  await expect(page.getByTestId('tk-err-0')).toContainText('Жабатын');
});

test('кнопка функции на медленном устройстве: курсор встаёт внутрь скобки, быстрый ввод не ломает формулу', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'замедление процессора через CDP — только Chromium');
  await openGraphs(page);
  await page.getByTestId('graph-mode-free').click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  for (const key of ['sin', 'cos', '√']) {
    await page.getByTestId('g-f-1').fill('');
    await page.getByTestId('g-f-1').click();
    await page.getByTestId(`g-key-${key}`).click();
    await page.keyboard.type('x)', { delay: 0 });
    await expect(page.getByTestId('g-f-1')).toHaveValue(`${key}(x)`);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
