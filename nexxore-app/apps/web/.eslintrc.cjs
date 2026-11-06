module.exports = {
  root: true,
  extends: ['next/core-web-vitals'],
  rules: {
    // Legacy pages are ported via iframe, not <img>; disable Next's <img> nag
    // where it is not applicable to our shell components.
    '@next/next/no-img-element': 'off',
  },
};
