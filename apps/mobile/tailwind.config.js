/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 uses Tailwind v3 (the admin app uses Tailwind v4; the configs are independent).
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
