/** @type {import('tailwindcss').Config} */

// Tema yüzeyleri CSS değişkenlerinden gelir (index.css): html.dark koyu,
// yoksa açık. rgb(var(...)) formatı /60 gibi opaklık eklerini korur.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#5f4bf0',
          700: '#4f46e5',
          800: '#4338ca',
          900: '#3730a3'
        },
        ink: {
          bg: v('--nx-bg'), // uygulama zemini
          panel: v('--nx-panel'), // kenar çubuğu / paneller
          card: v('--nx-card'), // kartlar, modallar, girişler
          hi: v('--nx-hi'), // hover / vurgulu yüzey
          line: v('--nx-line'), // kenarlıklar
          text: v('--nx-text'), // birincil metin
          mut: v('--nx-mut'), // ikincil metin
          dim: v('--nx-dim') // üçüncül metin
        }
      }
    }
  },
  plugins: []
}
