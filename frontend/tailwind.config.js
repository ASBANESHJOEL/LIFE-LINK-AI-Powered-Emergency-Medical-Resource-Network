/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#f8fafc',
        surface: {
          50: '#ffffff',
          100: '#f8fafc',
          200: '#f1f5f9',
          300: '#e2e8f0',
        },
        primary: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          subtle: 'rgba(37, 99, 235, 0.08)',
        },
        medical: {
          blue: '#2563eb',
          'blue-subtle': '#eff6ff',
          emerald: '#16a34a',
          'emerald-subtle': '#f0fdf4',
          amber: '#d97706',
          'amber-subtle': '#fffbeb',
          slate: '#0f172a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
