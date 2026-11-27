// Реальная генерация через экран учителя для набора текстов; сохраняет черновики ДО правки учителем.
// Требует: npm run server (с настоящей Ollama) и npm run build && npm run preview (порт 4173).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const texts = JSON.parse(readFileSync(process.argv[2] ?? 'docs/pitch/gemma-run-texts.json', 'utf8'));
const out = process.argv[3] ?? 'docs/gemma-run';
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const results = [];
for (const c of texts) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(process.env.LOCAL_URL ?? 'http://127.0.0.1:4173/');
  await p.getByTestId('mode-teacher').click();
  const model = (await p.getByTestId('t-health').innerText()).match(/модель (\S+)/)?.[1];
  await p.getByTestId('t-title').fill(c.title);
  await p.getByTestId('t-lang').selectOption(c.language);
  await p.getByTestId('t-text').fill(c.text);
  const t0 = Date.now();
  await p.getByTestId('t-generate').click();
  await p.getByTestId('t-generate').filter({ hasText: 'Сгенерировать' }).waitFor({ timeout: 700_000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  const grab = async (id) => ((await p.getByTestId(id).count()) ? await p.getByTestId(id).innerText() : null);
  const draft = await p.evaluate(async () => {
    const r = indexedDB.open('oqy-reader'); await new Promise((ok) => (r.onsuccess = ok));
    const q = r.result.transaction('drafts').objectStore('drafts').get('current');
    await new Promise((ok) => (q.onsuccess = ok)); return q.result?.data ?? null;
  });
  const res = { key: c.key, model, secs, structureError: await grab('t-struct-error'), referenceOrSchemaErrors: await grab('t-errors'), qualityIssues: await grab('t-quality'), message: await p.locator('[data-testid^="t-msg-"]').allInnerTexts(), draft };
  writeFileSync(`${out}/${c.key}.json`, JSON.stringify(res, null, 2));
  results.push({ key: c.key, model, secs, structure: !!res.structureError, refs: !!res.referenceOrSchemaErrors, quality: res.qualityIssues });
  console.log(JSON.stringify(results.at(-1)));
  await ctx.close();
}
await b.close();
