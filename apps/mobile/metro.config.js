// Expo's default Metro config detects the pnpm monorepo on its own (watches
// the workspace root, resolves packages/*). NativeWind compiles global.css.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './src/global.css' });
