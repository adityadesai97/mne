import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Type scale: Tailwind's defaults (12 14 16 18 20 24 30 36 48 60 72) are
      // the scale — don't add arbitrary text-[Npx] sizes.
      fontFamily: {
        display: ['var(--display-font)', 'Georgia', 'serif'],
        sans: ['var(--body-font)', 'system-ui', 'sans-serif'],
      },
      colors: {
        amber: {
          DEFAULT: 'hsl(var(--amber))',
          foreground: 'hsl(var(--amber-foreground))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
        gain: 'hsl(var(--gain))',
        loss: 'hsl(var(--loss))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: {
          DEFAULT: 'hsl(var(--border))',
          strong: 'hsl(var(--border-strong))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        hover: 'var(--hover)',
        active: 'var(--active)',
        // Landing page only. It is a fixed light-theme marketing surface (it
        // does not follow html.light), so these are plain hex ramps, not the
        // theme tokens above. Three section families: blue (hero/sign-in),
        // slate (features), sand (examples), green (workflow). 50 = lightest.
        // Every text/surface pair here is verified >= 4.5:1.
        landing: {
          canvas: '#f5f7fb',
          ink: { 900: '#0f1b36', 800: '#1f2a44', 700: '#33405b', 600: '#4e5b77' },
          blue: { 50: '#f5f8ff', 100: '#e5efff', 200: '#c7dbff', 300: '#8eb7ff', 400: '#92b3ff', 500: '#6ca6ff', 600: '#0b5ed7', 700: '#1a4aa6' },
          slate: { 100: '#e8edf6', 200: '#cbd8f0' },
          sand: { 50: '#fffaf3', 100: '#f8eee0', 200: '#ffeacd', 300: '#ebd5bc', 500: '#a2723d', 600: '#745535', 700: '#4f3f2d', 900: '#2b2016', 950: '#231f1a', fg: '#ece6da', 'fg-muted': '#d2c4ac' },
          green: { 100: '#dfede2', 200: '#c6dacd', 700: '#3b6a4c', 800: '#345543', 900: '#0f2a1a' },
          mint: '#9fe8d1',
          gain: '#0a7a35',
          red: { 50: '#fff1f1', 200: '#f3b6b6', 700: '#a81d1d' },
        },
      },
      // Radius roles (design system): sm 10px = inputs/small tags, md 14px =
      // rows/inset tiles, lg 24px = cards/sheets/command bar, full = buttons,
      // chips and segmented controls (pills), 3xl = Landing section panels.
      // (rounded-xl/2xl are the same sizes as md/lg — don't use them.)
      borderRadius: {
        lg: 'var(--radius)',
        md: '0.875rem',
        sm: '0.625rem',
      },
      // Five elevations, chosen by z-axis position (see refactoring-ui):
      // sm = barely raised, DEFAULT/md = dropdown, lg = popover, xl = dialog, 2xl = modal
      boxShadow: {
        sm: '0 1px 2px hsla(25,30%,10%,.18)',
        DEFAULT: '0 4px 6px hsla(25,30%,10%,.18)',
        md: '0 4px 6px hsla(25,30%,10%,.18)',
        lg: '0 5px 15px hsla(25,30%,10%,.18)',
        xl: '0 10px 24px hsla(25,30%,10%,.18)',
        '2xl': '0 15px 35px hsla(25,30%,10%,.18)',
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card), 0 0 0 1px hsl(var(--primary) / 0.25)',
      },
      keyframes: {
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        popIn: {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to:   { opacity: '1', transform: 'scale(1)' },
        },
        pageIn: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        slideDown: 'slideDown 0.15s ease-out',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        popIn: 'popIn 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
        pageIn: 'pageIn 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}

export default config
