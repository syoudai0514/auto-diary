import type { Config } from 'tailwindcss';

/**
 * デザインハンドオフ「ウォーム・ペーパー」のトークンを CSS 変数経由で参照する。
 * ライト / ダークの実際の値は globals.css の :root / [data-theme] で定義する。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        text: 'var(--c-text)',
        'text-secondary': 'var(--c-text-secondary)',
        'text-tertiary': 'var(--c-text-tertiary)',
        border: 'var(--c-border)',
        accent: 'var(--c-accent)',
        'accent-on': 'var(--c-accent-on)',
        recording: 'var(--c-recording)',
        error: 'var(--c-error)',
        'error-soft': 'var(--c-error-soft)',
        warning: 'var(--c-warning)',
        'warning-soft': 'var(--c-warning-soft)',
        success: 'var(--c-success)',
      },
      fontFamily: {
        sans: [
          "'Noto Sans JP'",
          '-apple-system',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        cta: '0 10px 22px rgba(193, 101, 46, 0.30)',
        toast: '0 12px 28px rgba(0, 0, 0, 0.22)',
      },
      borderRadius: {
        card: '16px',
        chip: '14px',
        sheet: '26px',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.85)' },
        },
        spin360: {
          to: { transform: 'rotate(360deg)' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.1)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'screen-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.2s ease-in-out infinite',
        spin360: 'spin360 1s linear infinite',
        'pop-in': 'pop-in 320ms ease-out',
        'screen-in': 'screen-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
