'use strict';

function color(str, code) {
  if (!process.stdout.isTTY) return str;
  return `\x1b[${code}m${str}\x1b[0m`;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  return (bytes / 1024).toFixed(2) + ' KB';
}

function log(message) {
  console.log(message);
}

function success(message) {
  console.log(color(message, '1;32'));
}

function warn(message) {
  console.log(color(message, '1;33'));
}

function error(message) {
  console.error(color(message, '1;31'));
}

function info(message) {
  console.log(color(message, '1;36'));
}

module.exports = {
  color,
  formatSize,
  log,
  success,
  warn,
  error,
  info,
};
