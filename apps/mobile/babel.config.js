// Babel compiles the app's JS/TS for Metro (React Native's bundler, its
// equivalent of webpack/Turbopack). NativeWind hooks in here so `className`
// props are converted into React Native style objects.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
