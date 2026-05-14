/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      screens: {
        phone: "600px",
        tablet: "1000px",
        desktop: "1280px",
      },
      colors: {
        va: {
          bg: "#fafafb",
          surface: "#ffffff",
          surface2: "#f4f2fb",
          border: "#1d1b211f",
          border2: "#1d1b2114",
          text: "#1d1b21",
          muted: "#6f6b7c",
          subtle: "#908b9b",
          amber: "#7f77dd",
          red: "#e95d8a",
          green: "#3f8656",
          blue: "#7f77dd",
        },
        x: {
          black: "#fafafb",
          primary: "#1d1b21",
          secondary: "#6f6b7c",
          blue: "#7f77dd",
          border: "#1d1b211f",
          hover: "#f4f2fb",
          pink: "#e95d8a",
          green: "#3f8656",
          red: "#b3261e",
        },
      },
      fontFamily: {
        sans: ["Roboto", "SF Pro Text", "Segoe UI", "system-ui", "sans-serif"],
        display: ["Roboto", "SF Pro Text", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        focus: "0 0 0 3px rgba(127,119,221,0.18)",
        lift: "none",
        glow: "none",
      },
      animation: {
        shimmer: "shimmer 1.5s linear infinite",
        pulseRing: "record-pulse 2s ease-in-out infinite",
      },
      keyframes: {
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "record-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(224,91,75,0.5)" },
          "50%":      { boxShadow: "0 0 0 12px rgba(224,91,75,0)" },
        },
      },
    },
  },
  plugins: [],
};
