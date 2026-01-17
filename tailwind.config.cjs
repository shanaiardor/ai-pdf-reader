module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f1e1b",
        accent: "#ff7a1a",
      },
      boxShadow: {
        card: "0 20px 60px rgba(15, 20, 30, 0.12)",
      },
    },
  },
  plugins: [],
};
