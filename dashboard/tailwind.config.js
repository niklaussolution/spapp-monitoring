/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0F3460",
        "primary-dark": "#16213E",
        accent: "#1A73E8",
        background: "#F7F7FB",
      },
    },
  },
  plugins: [],
};
