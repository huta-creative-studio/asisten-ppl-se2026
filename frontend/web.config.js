// web.config.js - Web-specific optimization configuration
const path = require('path');

module.exports = {
  // Enable production optimizations
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',

  // Optimization settings
  optimization: {
    minimize: true,
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
          reuseExistingChunk: true,
        },
        common: {
          minChunks: 2,
          priority: 5,
          reuseExistingChunk: true,
          name: 'common',
        },
      },
    },
    usedExports: true, // Enable tree-shaking
    sideEffects: false,
  },

  // Module compression
  performance: {
    hints: 'warning',
    maxEntrypointSize: 512000,
    maxAssetSize: 512000,
  },

  // Output optimization
  output: {
    filename: '[name].[contenthash].js',
    chunkFilename: '[name].[contenthash].chunk.js',
    publicPath: '/',
  },
};
