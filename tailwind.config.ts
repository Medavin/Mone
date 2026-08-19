import type { Config } from "tailwindcss";

/**
 * The palette is the aging ladder.
 *
 * Everyone who reads these screens all day reads one thing first: how old the
 * money is. Current, 30, 60, 90, 120+. So the colour scale is not decoration
 * picked to brighten the app — it runs cool to hot across exactly those five
 * buckets, and the rest of the interface borrows from it. A figure shown in
 * age120 rust means the same thing on every screen it appears on.
 *
 * Module colours in the nav come from the same family, so the header reads as
 * one set rather than a bag of highlighters.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink:      "#101A20",
        muted:    "#5C6B75",
        hairline: "#DCE4E8",
        canvas:   "#EDF2F4",
        surface:  "#FFFFFF",

        // Momentum Billing's own brand, taken from their logo file: navy
        // #004A80, mid #0095D8, cyan #00B9F1. The app carries the client's
        // colours in its chrome — header, buttons, links — while the aging
        // ramp below stays exactly as it was, because those five colours mean
        // something and are not decoration to be re-themed.
        accent:     "#004A80",
        accentDeep: "#003558",
        accentSoft: "#E4F3FB",
        brand:      "#00B9F1",
        brandMid:   "#0095D8",

        age0:   "#0E8577",
        age30:  "#4E9A4B",
        age60:  "#C08D21",
        age90:  "#CB6B22",
        age120: "#A93226",

        warn: "#B4761A",
        bad:  "#A33A3F",
        good: "#2F7A57",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Helvetica Neue", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,26,32,0.04), 0 8px 24px -14px rgba(16,26,32,0.20)",
        lift: "0 2px 4px rgba(16,26,32,0.06), 0 16px 32px -18px rgba(16,26,32,0.30)",
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
  safelist: [
    "border-l-good", "border-l-warn", "border-l-bad", "border-l-muted",
    "text-age0", "text-age30", "text-age60", "text-age90", "text-age120",
    "bg-age0", "bg-age30", "bg-age60", "bg-age90", "bg-age120",
  ],
  plugins: [],
};
export default config;
