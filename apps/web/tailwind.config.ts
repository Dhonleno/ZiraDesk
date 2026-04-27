import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4ff',
          100: '#dce8ff',
          200: '#c0d3ff',
          300: '#93b4ff',
          400: '#6090ff',
          500: '#3d6eff',
          600: '#2550f5',
          700: '#1d3de1',
          800: '#1e33b6',
          900: '#1e308f',
          950: '#161f57',
        },
        // ── Design System ZiraDesk ──────────────────────────────
        bg: {
          DEFAULT: '#0E0F11',
          2: '#141518',
          3: '#1A1C20',
          4: '#22252B',
          5: '#2A2E36',
        },
        teal: {
          DEFAULT: '#00C9A7',
          hover: '#00E8C0',
          dim: 'rgba(0,201,167,.15)',
        },
        txt: {
          DEFAULT: '#F0F1F3',
          2: '#9DA3AE',
          3: '#5C6370',
        },
        line: {
          DEFAULT: 'rgba(255,255,255,.07)',
          2: 'rgba(255,255,255,.12)',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
