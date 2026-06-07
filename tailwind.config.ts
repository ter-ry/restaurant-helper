import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        muted: "#64748B",
        line: "#E2E8F0",
        brand: {
          50: "#E6FFFA",
          100: "#DDF7F3",
          500: "#0D9488",
          600: "#0D9488",
          700: "#0F766E"
        },
        caution: "#b45309",
        danger: "#b42318",
        ocean: "#0D9488"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(15, 23, 42, 0.08)"
      }
    },
  },
  plugins: [],
} satisfies Config;
