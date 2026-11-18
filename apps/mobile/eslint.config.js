// @ts-check
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = (async () => {
  const { base } = await import('@deltaguard/eslint-config/base');
  return defineConfig([
    ...expoConfig,
    ...base,
    { ignores: ['.expo/**', 'dist/**', 'ios/**', 'android/**'] },
  ]);
})();
