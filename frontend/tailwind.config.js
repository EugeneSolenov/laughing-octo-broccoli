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
        x: {
          black: "#000000",
          primary: "#E7E9EA",
          secondary: "#71767B",
          blue: "#1D9BF0",
          border: "#2F3336",
          hover: "#16181C",
          pink: "#F91880",
          green: "#00BA7C",
          red: "#F4212E",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        focus: "0 0 0 1px rgba(29, 155, 240, 0.6)",
        lift: "0 24px 60px rgba(0, 0, 0, 0.35)",
      },
      animation: {
        shimmer: "shimmer 1.4s linear infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        float: "float 6s ease-in-out infinite",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseRing: {
          "0%": { transform: "scale(1)", opacity: "0.9" },
          "100%": { transform: "scale(1.28)", opacity: "0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
    },
  },
  plugins: [],
};
