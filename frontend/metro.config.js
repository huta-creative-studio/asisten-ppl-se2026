// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];

// Optimize for web builds
if (process.env.EXPO_OS === 'web') {
  // Enable minification
  config.transformer.minifierConfig = {
    compress: {
      drop_console: true, // Remove console.logs in production
      unsafe_methods: true,
    },
    mangle: true,
    output: {
      comments: false, // Remove comments to reduce bundle size
    },
  };

  // Web-specific optimizations
  config.transformer.getTransformOptions = () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true, // Inline require statements for better tree-shaking
    },
  });
}

// Exclude unnecessary directories from Metro watching
config.watchFolders = [__dirname];
config.resolver.blacklistRE = /(.*)\/(__tests__|\.git|node_modules\/.*\/(android|ios|windows|macos))(\/.*)?$/;

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

// Cache strategy optimization
config.cacheVersion = '1.0.0';

module.exports = config;
