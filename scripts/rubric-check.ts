// Автоматическая часть рубрики: npm run rubric -- file.json ...
import { readFileSync } from 'node:fs';
import { parseLessonJson, qualityIssues, qualityIssueText } from '../shared/lesson';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Укажите JSON с уроком. Пример: npm run rubric -- docs/pitch/lesson-kk-after-teacher.json');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  const r = parseLessonJson(readFileSync(f, 'utf8'));
  if (!r.ok) { bad++; console.log(`✗ ${f}: невалиден\n  ${r.errors.join('\n  ')}`); continue; }
  const issues = qualityIssues(r.lesson);
  if (issues.length) bad++;
  console.log(`${issues.length ? '✗' : '✓'} ${f}: схема и ID корректны`);
  for (const issue of issues) console.log(`  ${qualityIssueText('ru', issue)}`);
}
process.exit(bad ? 1 : 0);
