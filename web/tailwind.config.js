const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** Цвета задаются CSS-переменными в index.css (светлая и тёмная схема). */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        paper: v('paper'), card: v('card'), ink: v('ink'), muted: v('muted'), line: v('line'),
        brand: v('brand'), 'brand-ink': v('brand-ink'), 'brand-soft': v('brand-soft'), 'on-brand': v('on-brand'),
        marker: v('marker'), 'marker-ink': v('marker-ink'),
        ok: v('ok'), 'ok-soft': v('ok-soft'), warn: v('warn'), 'warn-soft': v('warn-soft'), bad: v('bad'), 'bad-soft': v('bad-soft'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        serif: ['"Literata Variable"', 'Georgia', '"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [],
};
