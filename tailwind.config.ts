import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // warm-paper neutrals
        paper: "#F7F4EE",
        surface: "#FFFFFF",
        ink: "#211E18",
        muted: "#6B665C",
        faint: "#9A9388",
        line: "#E7E1D4",
        // brand — a calm ledger green
        brand: { DEFAULT: "#234E42", soft: "#E9F0EC", ink: "#16352D" },
        // semantic — used ONLY for meaning
        danger: { DEFAULT: "#B0291C", soft: "#FAEBE8", ink: "#7C160C" },
        warn: { DEFAULT: "#8F5A09", soft: "#FBF0DC", ink: "#623D04" },
        ok: { DEFAULT: "#2E6B4F", soft: "#E8F1EB", ink: "#1D4733" },
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(33,30,24,0.04), 0 1px 14px -8px rgba(33,30,24,0.10)",
        panel: "0 2px 4px rgba(33,30,24,0.04), 0 18px 40px -28px rgba(33,30,24,0.22)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in": "fade-in 0.4s ease both",
      },
    },
  },
  plugins: [],
};
export default config;
