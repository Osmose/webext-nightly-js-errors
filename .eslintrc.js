module.exports = {
  extends: "eslint:recommended",
  parserOptions: {
    ecmaVersion: 9,
  },
  env: {
    browser: true,
    es6: true,
    webextensions: true,
  },
  rules: {
    "no-console": "off",
    "semi": ["error", "always"],
  },
};
