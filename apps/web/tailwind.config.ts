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
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
