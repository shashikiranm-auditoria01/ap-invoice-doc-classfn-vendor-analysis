/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom light theme colors
        background: '#F8FAFC',
        surface: '#FFFFFF',
        'text-primary': '#0F172A',
        'text-secondary': '#64748B',
        'text-tertiary': '#94A3B8',
        border: '#E2E8F0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
