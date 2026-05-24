/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#ececef",
          200: "#d3d3d8",
          300: "#abacb4",
          400: "#7f8089",
          500: "#5f6068",
          600: "#48494f",
          700: "#33343a",
          800: "#1e1f24",
          900: "#0f1014",
        },
      },
    },
  },
  plugins: [],
};
