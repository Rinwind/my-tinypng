'use strict';

const { compressImage, compressBatch, printSummary } = require('./lib/compress');
const { getConfig, writeGlobalConfig, readGlobalConfig } = require('./lib/config');

module.exports = {
  compressImage,
  compressBatch,
  printSummary,
  getConfig,
  writeGlobalConfig,
  readGlobalConfig,
};
