/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        navy: { 950: "#08132a", 900: "#0d1d3a", 800: "#15294d", 700: "#1f3763", 600: "#2c4a80", 500: "#3d5f9c", 100: "#e3e9f4", 50: "#f1f4fa" },
        steel: { 600: "#2563c9", 500: "#3b78dc", 100: "#e2ecfb" },
        ink: { 900: "#111827", 700: "#374151", 500: "#5b6478", 400: "#8a93a6", 300: "#b8bfcc" },
        line: { DEFAULT: "#e1e5ec", strong: "#cbd2dd" },
        canvas: "#f4f6f9",
        ok: { 600: "#15803d", 100: "#dcf3e4", 50: "#effaf3" },
        warn: { 600: "#b45309", 100: "#fdecc8", 50: "#fff8eb" },
        bad: { 600: "#b42318", 100: "#fbe0dd", 50: "#fef3f2" },
        signal: { 500: "#e8a33d", 100: "#fbefd9" },
      },
      borderRadius: { DEFAULT: "4px", md: "6px", lg: "8px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 1px 1px rgba(16,24,40,.03)",
        pop: "0 12px 32px -8px rgba(8,19,42,.28), 0 2px 6px rgba(8,19,42,.08)",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } },
        pulse2: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
      },
      animation: { "fade-in": "fade-in .18s ease-out", pulse2: "pulse2 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
