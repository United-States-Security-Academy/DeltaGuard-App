// Babel compiles the app's JS/TS for Metro (React Native's bundler, its
// equivalent of webpack/Turbopack). NativeWind hooks in here so `className`
// props are converted into React Native style objects.
//
// Production bundles (EAS builds, `eas update`, `expo export`) drop every
// console.log / info / debug / warn call, so nothing a phone logs can carry
// tokens, locations or personal data into device logs. console.error stays
// (crash reporting); the app's error calls log messages and codes only.
module.exports = function (api) {
  const production = api.env('production') || process.env.NODE_ENV === 'production';
  api.cache.using(() => production);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: production ? [['transform-remove-console', { exclude: ['error'] }]] : [],
  };
};
