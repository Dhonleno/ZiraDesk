import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Theme is driven by data-theme attribute + CSS variables — no Tailwind darkMode needed
  theme: {
    extend: {
      colors: {
        // All design system colors reference CSS variables from tokens.css
        bg: {
          DEFAULT: 'var(--bg)',
          2: 'var(--bg-2)',
          3: 'var(--bg-3)',
          4: 'var(--bg-4)',
          5: 'var(--bg-5)',
        },
        teal: {
          DEFAULT: 'var(--teal)',
          dim: 'var(--teal-dim)',
          glow: 'var(--teal-glow)',
        },
        txt: {
          DEFAULT: 'var(--txt)',
          2: 'var(--txt-2)',
          3: 'var(--txt-3)',
        },
        line: {
          DEFAULT: 'var(--line)',
          2: 'var(--line-2)',
        },
        green: {
          DEFAULT: 'var(--green)',
          dim: 'var(--green-dim)',
        },
        amber: {
          DEFAULT: 'var(--amber)',
          dim: 'var(--amber-dim)',
        },
        red: {
          DEFAULT: 'var(--red)',
          dim: 'var(--red-dim)',
        },
        blue: {
          DEFAULT: 'var(--blue)',
          dim: 'var(--blue-dim)',
        },
        purple: {
          DEFAULT: 'var(--purple)',
          dim: 'var(--purple-dim)',
        },
        pink: {
          DEFAULT: 'var(--pink)',
          dim: 'var(--pink-dim)',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: 'var(--r)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        pill: 'var(--r-pill)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
