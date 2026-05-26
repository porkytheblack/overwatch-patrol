import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-elev': 'var(--surface-elev)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        'text-dim': 'var(--text-dim)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'accent-dim': 'var(--accent-dim)',
        success: 'var(--success)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0' },
      transitionDuration: { DEFAULT: '150ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0,0,0.2,1)' },
    },
  },
  plugins: [],
};

export default config;
