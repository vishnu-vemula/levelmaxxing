const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const reactNative = path.dirname(require.resolve('react-native/package.json'));

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [path.resolve(__dirname, '..')],
  transformer: { assetRegistryPath: path.join(reactNative, 'Libraries', 'Image', 'AssetRegistry.js') },
  serializer: { getModulesRunBeforeMainModule: () => [path.join(reactNative, 'Libraries', 'Core', 'InitializeCore.js')] },
  resolver: { extraNodeModules: { '@babel/runtime': path.dirname(require.resolve('@babel/runtime/package.json')) } },
});
