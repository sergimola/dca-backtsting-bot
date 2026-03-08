module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        success: {
          50: '#f0fdf4',
          500: '#22c55e',
          900: '#166534',
        },
        danger: {
          50: '#fef2f2',
          500: '#ef4444',
          900: '#7f1d1d',
        },
      },
    },
  },
  plugins: [],
}
