import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Shell
        background: 'var(--background)',
        foreground:  'var(--foreground)',

        // Legacy (partner portal)
        'brand-dark': '#1a1a1a',
        'lemon-400':  '#fde047',

        // Team portal primary
        primary: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',   // ← default interactive
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },

        // Status badge semantic tokens
        status: {
          intake:      { bg: '#dbeafe', text: '#1d4ed8' },   // blue
          nurture:     { bg: '#fef9c3', text: '#a16207' },   // yellow
          documents:   { bg: '#f3e8ff', text: '#7e22ce' },   // purple
          review:      { bg: '#e0e7ff', text: '#3730a3' },   // indigo
          info:        { bg: '#ffedd5', text: '#c2410c' },   // orange
          signup:      { bg: '#ccfbf1', text: '#0f766e' },   // teal
          retained:    { bg: '#dcfce7', text: '#15803d' },   // green
          settled:     { bg: '#d1fae5', text: '#065f46' },   // emerald
          dropped:     { bg: '#fee2e2', text: '#b91c1c' },   // red
        },

        // Severity border indicators (left border on case rows)
        alarm:   '#ef4444',   // red-500   — missing required doc
        warning: '#f59e0b',   // amber-500 — info needed
        track:   '#22c55e',   // green-500 — on track
        muted:   '#d1d5db',   // gray-300  — dropped / inactive
      },

      animation: {
        'fade-in': 'fadeIn 150ms ease-out',
        'slide-up': 'slideUp 200ms ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
export default config
