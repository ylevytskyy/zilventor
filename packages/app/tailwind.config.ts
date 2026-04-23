import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        shell: { DEFAULT: '#1f1f1f', panel: '#252525', border: '#3a3a3a' },
        ribbon: { bg: '#1f1f1f', tab: '#252525', active: '#1f1f1f', accent: '#4f8cff' }
      }
    }
  }
} satisfies Config;
