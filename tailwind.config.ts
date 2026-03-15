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
        // Brand
        lemon: {
          300: '#FFE433',
          400: '#FFD600',   // ← primary accent, matches referrals.easylemon.com
          500: '#F5C800',
        },

        // Semantic status badges — matches partner portal style
        status: {
          intake:    { bg: '#dbeafe', text: '#1d4ed8' },
          nurture:   { bg: '#fef9c3', text: '#a16207' },
          documents: { bg: '#f3e8ff', text: '#7e22ce' },
          review:    { bg: '#e0e7ff', text: '#3730a3' },
          info:      { bg: '#ffedd5', text: '#c2410c' },
          signup:    { bg: '#ccfbf1', text: '#0f766e' },
          retained:  { bg: '#dcfce7', text: '#15803d' },
          settled:   { bg: '#d1fae5', text: '#065f46' },
          dropped:   { bg: '#fee2e2', text: '#b91c1c' },
        },

        // Severity row indicators
        alarm:   '#ef4444',
        warning: '#f59e0b',
        track:   '#22c55e',
        muted:   '#d1d5db',
      },

      boxShadow: {
        card:    '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-md': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
      },

      animation: {
        'fade-in':  'fadeIn 150ms ease-out',
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
