import { LessonSchema, type Lesson } from './lesson';
import ruSaiga from '../lessons/ru-saiga.json';
import ruSolar from '../lessons/ru-solar.json';
import kkLibrary from '../lessons/kk-library.json';
import kkBalkhash from '../lessons/kk-balkhash.json';

export const BUILTIN_LESSONS: Lesson[] = [ruSaiga, ruSolar, kkLibrary, kkBalkhash].map((l) => LessonSchema.parse(l));
