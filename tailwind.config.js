/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './core/templates/**/*.html',
    './core/**/*.py',
    './config/**/*.py',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#C4847A',
          dark: '#865047',
          sidebar: '#1C1A18',
        },
        cream: {
          DEFAULT: '#F4F2EE',
          header: '#FCF9F4',
        },
      },
      fontFamily: {
        editorial: ['Newsreader', 'serif'],
      },
    },
  },
  plugins: [],
};
