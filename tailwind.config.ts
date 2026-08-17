import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:     "#0D1215",
        muted:   "#5B6770",
        hairline:"#E1E6E9",
        canvas:  "#F7F8F9",
        accent:  "#12586B",
        warn:    "#B4761A",
        bad:     "#A33A3F",
        good:    "#2F6B4F",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Helvetica Neue", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
