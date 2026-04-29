/** @type {import('tailwindcss').Config} */
import { colors } from './src/tradebuddy/theme.js'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // All color tokens live in src/theme.js.
      // Actual values are CSS variables defined in src/index.css.
      // Change the CSS variables there to restyle the app; no recompile needed.
      colors,
    },
  },
  plugins: [],
}
