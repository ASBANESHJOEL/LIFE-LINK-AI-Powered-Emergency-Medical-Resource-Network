/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        surface: {
          50: '#111827',
          100: '#0f172a',
          200: '#1e293b',
          300: '#334155',
        },
        primary: {
          DEFAULT: '#dc2626',
          hover: '#ef4444',
          subtle: 'rgba(239, 68, 68, 0.12)',
        },
        medical: {
          blue: '#0284c7',
          'blue-subtle': 'rgba(2, 132, 199, 0.12)',
          emerald: '#10b981',
          'emerald-subtle': 'rgba(16, 185, 129, 0.12)',
          amber: '#f59e0b',
          'amber-subtle': 'rgba(245, 158, 11, 0.12)',
          slate: '#0f172a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
