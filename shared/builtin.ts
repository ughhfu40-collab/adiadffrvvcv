import { LessonSchema, type Lesson } from './lesson';
import ruGarden from '../lessons/ru-garden.json';
import kkFeeder from '../lessons/kk-feeder.json';
import ruSaiga from '../lessons/ru-saiga.json';
import ruSolar from '../lessons/ru-solar.json';
import kkLibrary from '../lessons/kk-library.json';
import kkBalkhash from '../lessons/kk-balkhash.json';
import ruNoise from '../lessons/ru-noise.json';
import kkCanteen from '../lessons/kk-canteen.json';

/** Встроенные уроки для 7–9 классов: по одному казахскому и одному русскому на 7 и 9 класс, по два — на 8. */
export const BUILTIN_LESSONS: Lesson[] = [ruSaiga, ruSolar, kkLibrary, kkBalkhash, ruGarden, kkFeeder, ruNoise, kkCanteen].map((l) => LessonSchema.parse(l));
