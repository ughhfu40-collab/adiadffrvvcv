// Автоматическая часть рубрики (критерии 1 и 3-длина): npx tsx scripts/rubric-check.ts file.json ...
import { readFileSync } from 'node:fs';
import { parseLessonJson } from '../shared/lesson';

let bad = 0;
for (const f of process.argv.slice(2)) {
  const r = parseLessonJson(readFileSync(f, 'utf8'));
  if (!r.ok) { bad++; console.log(`✗ ${f}: невалиден\n  ${r.errors.join('\n  ')}`); continue; }
  for (const t of r.lesson.tasks) {
    const optionsOk = new Set(t.options.map((o) => o.text.trim().toLowerCase())).size === t.options.length;
    const inferOk = t.skill !== 'infer' || t.evidenceSets.every((s) => s.length >= 2);
    const ok = optionsOk && inferOk;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${f} ${t.id} [${t.skill}] схема ок${optionsOk ? '' : ', повтор вариантов'}${inferOk ? '' : ', вывод на одном предложении'}`);
  }
}
process.exit(bad ? 1 : 0);
