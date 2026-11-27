import { createContext, useContext, useState, type ReactNode } from 'react';

export type UiLang = 'kk' | 'ru';

const ru = {
  appTitle: 'Oqy · читать и понимать',
  offlineReady: '✓ Готово к офлайну',
  offlineLoading: 'Загрузка для офлайна…',
  noNetwork: 'Нет сети',
  modeStudent: 'Ученик',
  modeTeacher: 'Учитель',
  loading: 'Загрузка…',
  switchLang: 'Қазақша',
  build: 'сборка {sha}',
  progressTitle: 'Прогресс по навыкам',
  solved: 'решено',
  errorsAttempts: 'ошибок: {e} · попыток: {a}',
  lessons: 'Уроки',
  grade: '{g} класс',
  imported: 'импорт',
  doneOf: 'Выполнено {d} из {n}',
  importTitle: 'Импорт урока (JSON)',
  importOk: 'Урок «{title}» импортирован',
  importSame: 'Урок «{title}» уже есть — ничего не изменено, прогресс на месте',
  importConflict: 'Урок с ID «{id}» уже есть в другой версии. Он и прогресс по нему сохранены без изменений; новая версия добавлена как «{title}» (ID {newId}).',
  importFailed: 'Урок не импортирован:',
  tText: '1. Текст',
  tTitle: 'Название урока',
  tPaste: 'Вставьте текст (6–12 предложений)',
  tChecking: 'Проверяю сервер…',
  tReady: 'Ollama готова · модель {model}',
  tStart: 'Запустите:',
  tGenerate: 'Сгенерировать черновик (Ollama)',
  tGenerating: 'Генерация…',
  tCancel: 'Отменить',
  tElapsed: 'Идёт генерация: {time}. На ноутбуке обычно 3–4 минуты, лимит {limit}.',
  tManual: 'Составить вручную',
  tNoModel: 'Без модели доступны ручной черновик, просмотр и импорт.',
  tCancelled: 'Генерация отменена. Черновик и ваши правки не изменены.',
  tTimeout: 'Модель не ответила за {sec} с. Черновик и правки сохранены. Попробуйте ещё раз, текст покороче или модель полегче (OLLAMA_MODEL).',
  tUnavailable: '{reason} — команда: {command}',
  tServerDown: 'Сервер генерации недоступен: {reason}. Запустите: npm run server',
  tInputRejected: 'Запрос отклонён: {errors}',
  tStructTitle: 'Черновик не загружен: модель вернула неверную структуру.',
  tStructKept: 'Предыдущий черновик сохранён ниже.',
  tStructRetry: 'Попробуйте сгенерировать ещё раз или составьте вручную.',
  tDraftTitle: '2. Черновик — проверьте и исправьте',
  tRefErrors: 'Модель ошиблась в ссылках — исправьте поля ниже:',
  tQualityTitle: 'Требует правки — проблемные задания выделены:',
  tQuestion: 'Вопрос',
  tHint: 'Подсказка',
  tCorrect: 'Правильный ответ',
  tEvidence: 'Доказательства: нажмите на предложения',
  tSet: 'Набор {n}',
  tAddSet: '+ ещё один допустимый набор',
  tRemoveSet: 'Удалить набор {n}',
  tEvidenceText: 'Наборы текстом (через «;», ID через «,»):',
  tSave: 'Сохранить урок',
  tExport: 'Экспорт JSON',
  tDelete: 'Удалить черновик',
  tSaved: 'Урок сохранён и доступен в режиме ученика',
  tSkillFind: 'find — факт',
  tSkillMatch: 'match — сопоставить',
  tSkillInfer: 'infer — вывод',
  tNewLesson: 'Новый урок',
} as const;

type Key = keyof typeof ru;

const kk: Record<Key, string> = {
  appTitle: 'Oqy · оқу және түсіну',
  offlineReady: '✓ Офлайнға дайын',
  offlineLoading: 'Офлайнға жүктелуде…',
  noNetwork: 'Желі жоқ',
  modeStudent: 'Оқушы',
  modeTeacher: 'Мұғалім',
  loading: 'Жүктелуде…',
  switchLang: 'Русский',
  build: 'нұсқа {sha}',
  progressTitle: 'Дағдылар бойынша прогресс',
  solved: 'шешілді',
  errorsAttempts: 'қате: {e} · әрекет: {a}',
  lessons: 'Сабақтар',
  grade: '{g}-сынып',
  imported: 'импорт',
  doneOf: '{n} тапсырманың {d}-і орындалды',
  importTitle: 'Сабақты импорттау (JSON)',
  importOk: '«{title}» сабағы импортталды',
  importSame: '«{title}» сабағы бұрыннан бар — ештеңе өзгерген жоқ, прогресс сақталды',
  importConflict: '«{id}» ID-мен басқа нұсқадағы сабақ бұрыннан бар. Ол және оның прогресі өзгеріссіз сақталды; жаңа нұсқа «{title}» (ID {newId}) ретінде қосылды.',
  importFailed: 'Сабақ импортталмады:',
  tText: '1. Мәтін',
  tTitle: 'Сабақтың атауы',
  tPaste: 'Мәтінді қойыңыз (6–12 сөйлем)',
  tChecking: 'Серверді тексеріп жатырмын…',
  tReady: 'Ollama дайын · модель {model}',
  tStart: 'Іске қосыңыз:',
  tGenerate: 'Жоба жасау (Ollama)',
  tGenerating: 'Жасалуда…',
  tCancel: 'Тоқтату',
  tElapsed: 'Жоба жасалуда: {time}. Ноутбукта әдетте 3–4 минут, шегі {limit}.',
  tManual: 'Қолмен құрастыру',
  tNoModel: 'Модельсіз қолмен құрастыру, қарау және импорт қолжетімді.',
  tCancelled: 'Жоба жасау тоқтатылды. Жоба мен түзетулеріңіз өзгерген жоқ.',
  tTimeout: 'Модель {sec} с ішінде жауап бермеді. Жоба мен түзетулер сақталды. Қайталап көріңіз, мәтінді қысқартыңыз немесе жеңілірек модель таңдаңыз (OLLAMA_MODEL).',
  tUnavailable: '{reason} — команда: {command}',
  tServerDown: 'Жоба жасау сервері қолжетімсіз: {reason}. Іске қосыңыз: npm run server',
  tInputRejected: 'Сұрау қабылданбады: {errors}',
  tStructTitle: 'Жоба жүктелмеді: модель құрылымы қате жауап қайтарды.',
  tStructKept: 'Алдыңғы жоба төменде сақталды.',
  tStructRetry: 'Қайта жасап көріңіз немесе қолмен құрастырыңыз.',
  tDraftTitle: '2. Жоба — тексеріп, түзетіңіз',
  tRefErrors: 'Модель сілтемелерде қателесті — төмендегі өрістерді түзетіңіз:',
  tQualityTitle: 'Түзету керек — мәселелі тапсырмалар белгіленген:',
  tQuestion: 'Сұрақ',
  tHint: 'Кеңес',
  tCorrect: 'Дұрыс жауап',
  tEvidence: 'Дәлелдер: сөйлемдерді басыңыз',
  tSet: '{n}-жиын',
  tAddSet: '+ тағы бір рұқсат етілген жиын',
  tRemoveSet: '{n}-жиынды өшіру',
  tEvidenceText: 'Жиындар мәтінмен («;» арқылы, ID «,» арқылы):',
  tSave: 'Сабақты сақтау',
  tExport: 'JSON экспорттау',
  tDelete: 'Жобаны өшіру',
  tSaved: 'Сабақ сақталды, оқушы режимінде қолжетімді',
  tSkillFind: 'find — дерек',
  tSkillMatch: 'match — салыстыру',
  tSkillInfer: 'infer — қорытынды',
  tNewLesson: 'Жаңа сабақ',
};

const DICT: Record<UiLang, Record<Key, string>> = { ru, kk };
const STORAGE_KEY = 'oqy-ui-lang';

function initialLang(): UiLang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'kk' || saved === 'ru') return saved;
  } catch { /* приватный режим */ }
  return navigator.language?.toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

const Ctx = createContext<{ lang: UiLang; setLang: (l: UiLang) => void }>({ lang: 'ru', setLang: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(initialLang);
  const setLang = (l: UiLang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* приватный режим */ }
    document.documentElement.lang = l;
  };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const { lang, setLang } = useContext(Ctx);
  const t = (k: Key, v: Record<string, string | number> = {}) => DICT[lang][k].replace(/\{(\w+)\}/g, (_, n: string) => String(v[n] ?? ''));
  return { lang, setLang, t };
}
