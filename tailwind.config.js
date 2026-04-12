/** @type {import('tailwindcss').Config} */
import { colors } from './src/theme.js'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // All color tokens live in src/theme.js — edit there to restyle the app.
      colors,
    },
  },
  plugins: [],
}
