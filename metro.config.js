const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
  resolver: {
    extraNodeModules: {
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer'),
      events: require.resolve('events'),
      readline: require.resolve('readline'),
      path: require.resolve('path-browserify'),
      os: require.resolve('os-browserify'),
      assert: require.resolve('assert'),
      fs: require.resolve('react-native-fs'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);