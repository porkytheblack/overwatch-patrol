import type { Config } from 'tailwindcss';

// Same token names as services/ov-dashboard so the marketing site and the
// product read as one system (spec §0 Brand).
const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Channel-triplet form so opacity modifiers (bg-bg/85, border-accent/20) work.
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'var(--surface)',
        'surface-elev': 'var(--surface-elev)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        line: 'var(--line)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-dim': 'var(--text-dim)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-strong': 'var(--accent-strong)',
        'accent-dim': 'var(--accent-dim)',
        success: 'var(--success)',
        danger: 'var(--danger)',
        wa: 'rgb(var(--wa-rgb) / <alpha-value>)',
        tg: 'rgb(var(--tg-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0' },
      maxWidth: { site: '1280px' },
      transitionDuration: { DEFAULT: '150ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0,0,0.2,1)' },
    },
  },
  plugins: [],
};

export default config;
