import { LessonSchema, type Lesson } from './lesson';
import ruGarden from '../lessons/ru-garden.json';
import kkFeeder from '../lessons/kk-feeder.json';
import ruSaiga from '../lessons/ru-saiga.json';
import ruSolar from '../lessons/ru-solar.json';
import kkLibrary from '../lessons/kk-library.json';
import kkBalkhash from '../lessons/kk-balkhash.json';
import ruNoise from '../lessons/ru-noise.json';
import kkCanteen from '../lessons/kk-canteen.json';
import mathRu7 from '../lessons/math-ru-7-trip.json';
import mathKk7 from '../lessons/math-kk-7-trip.json';
import mathRu8 from '../lessons/math-ru-8-shop.json';
import mathKk8 from '../lessons/math-kk-8-shop.json';
import mathRu9 from '../lessons/math-ru-9-tariff.json';
import mathKk9 from '../lessons/math-kk-9-internet.json';

/** Встроенные уроки 7–9 классов. Чтение: по kk и ru на 7 и 9 класс, по два на 8. Математика: по kk и ru на каждый класс. */
export const BUILTIN_LESSONS: Lesson[] = [ruSaiga, ruSolar, kkLibrary, kkBalkhash, ruGarden, kkFeeder, ruNoise, kkCanteen, mathRu7, mathKk7, mathRu8, mathKk8, mathRu9, mathKk9].map((l) => LessonSchema.parse(l));
