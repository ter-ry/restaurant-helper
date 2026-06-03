import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16202a",
        muted: "#64748b",
        line: "#dbe4ed",
        brand: {
          50: "#eefbf6",
          100: "#d5f4e7",
          500: "#14a06f",
          600: "#0d805c",
          700: "#0b664c"
        },
        caution: "#b45309",
        danger: "#b42318",
        ocean: "#1d6fa5"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(22, 32, 42, 0.08)"
      }
    },
  },
  plugins: [],
} satisfies Config;
