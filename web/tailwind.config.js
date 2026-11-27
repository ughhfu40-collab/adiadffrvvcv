const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** Дизайн-токены v2 «Тетрадь». Значения цветов и теней — CSS-переменные в index.css (светлая и тёмная схема). */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  darkMode: 'media',
  // hover: только на устройствах с наведением — на телефоне состояние не «залипает» после касания.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        paper: v('paper'), card: v('card'), sunken: v('sunken'), ink: v('ink'), muted: v('muted'),
        line: v('line'), 'line-strong': v('line-strong'),
        brand: v('brand'), 'brand-ink': v('brand-ink'), 'brand-soft': v('brand-soft'), 'on-brand': v('on-brand'),
        marker: v('marker'), 'marker-ink': v('marker-ink'),
        ok: v('ok'), 'ok-soft': v('ok-soft'), warn: v('warn'), 'warn-soft': v('warn-soft'), bad: v('bad'), 'bad-soft': v('bad-soft'),
      },
      fontFamily: {
        sans: ['"Golos Text Variable"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        serif: ['"Literata Variable"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      // Типографская шкала по ролям: размер + межстрочный + трекинг — одно решение.
      fontSize: {
        display: ['clamp(2.125rem, 1.55rem + 2.4vw, 3.5rem)', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        title: ['clamp(1.75rem, 1.5rem + 1vw, 2.25rem)', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        heading: ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        subheading: ['1.1875rem', { lineHeight: '1.35' }],
        reading: ['1.1875rem', { lineHeight: '1.85' }],
        body: ['1rem', { lineHeight: '1.55' }],
        caption: ['0.8125rem', { lineHeight: '1.4' }],
      },
      // Радиусы различаются по роли: метка < контрол < карточка; сегменты и значки — pill.
      borderRadius: { chip: '6px', control: '10px', card: '18px' },
      boxShadow: { card: 'var(--shadow-card)', raised: 'var(--shadow-raised)', cta: 'var(--shadow-cta)' },
      maxWidth: { measure: '68ch' },
    },
  },
  plugins: [],
};
