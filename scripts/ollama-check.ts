// Реальная генерация на казахском и русском текстах через локальную Ollama.
import { generateLesson, ollamaStatus } from '../server/ollama';

const samples = [
  { language: 'kk' as const, title: 'Алма бағы', text: 'Алматы маңында алма бағы көп. Ең танымал сорт — апорт. Апорт алмасы өте ірі болады. Бұрын бір алманың салмағы жарты келіге дейін жететін. Қазір бақтар азайып, апортты сирек кездестіреміз. Сондықтан бағбандар жаңа көшеттер отырғызып жатыр.' },
  { language: 'ru' as const, title: 'Метеостанция', text: 'В школе появилась своя метеостанция. Её собрали ученики восьмого класса. Датчики измеряют температуру, влажность и ветер. Данные каждые десять минут записываются на карту памяти. Когда пропадает интернет, запись не прерывается. Летом по этим данным ребята предсказали сильный ветер за день до бури.' },
];

const st = await ollamaStatus();
console.log('Ollama:', st);
if (!st.ok) { console.error(`Пропуск: ${st.reason}`); process.exit(2); }
let fail = 0;
for (const s of samples) {
  const t0 = Date.now();
  const r = await generateLesson(s);
  console.log(`\n[${s.language}] ${r.ok ? 'OK' : 'INVALID'} за ${((Date.now() - t0) / 1000).toFixed(1)} c`);
  console.log(JSON.stringify(r.ok ? r.lesson.tasks : r, null, 2));
  if (!r.ok) fail++;
}
process.exit(fail ? 1 : 0);
