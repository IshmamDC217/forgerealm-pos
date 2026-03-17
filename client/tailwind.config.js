/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: '#0a1628',
        gold: '#d4a843',
        'gold-light': '#e4c373',
        'gold-dark': '#b8912e',
        surface: '#111827',
        card: '#1f2937',
        'card-hover': '#2a3649',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
