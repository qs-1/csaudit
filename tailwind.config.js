import animate from 'tailwindcss-animate';

const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        surface: { DEFAULT: c('surface'), 2: c('surface-2'), 3: c('surface-3') },
        line: c('line'),
        fg: { DEFAULT: c('fg'), 2: c('fg-2'), 3: c('fg-3') },
        accent: { DEFAULT: c('accent'), fg: c('accent-fg') },
        good: c('good'),
        info: c('info'),
        prog: c('prog'),
        done: c('done'),
        'done-on': c('done-on'),
        doing: c('doing'),
        'done-ink': c('done-ink'),
        'doing-ink': c('doing-ink'),
        warn: c('warn'),
        bad: c('bad'),
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '14px'],
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['14px', '20px'],
        md: ['15px', '22px'],
      },
      opacity: { 4: '0.04', 6: '0.06', 8: '0.08', 12: '0.12', 14: '0.14', 18: '0.18' },
      borderRadius: { card: '20px', inner: '10px' },
      boxShadow: {
        card: '0 0 0 1px rgb(var(--line))',
        soft: 'var(--card-shadow)',
        float: '0 8px 24px rgb(var(--shadow) / 0.08), 0 0 0 1px rgb(var(--line))',
        pop: '0 12px 32px rgb(var(--shadow) / 0.12), 0 0 0 1px rgb(var(--line))',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        reveal: { from: { clipPath: 'inset(0 100% 0 0)' }, to: { clipPath: 'inset(0 0 0 0)' } },
      },
      animation: {
        rise: 'rise .35s cubic-bezier(0.22, 1, 0.36, 1) both',
        reveal: 'reveal .9s cubic-bezier(0.22, 1, 0.36, 1) .1s both',
      },
    },
  },
  plugins: [animate],
};
