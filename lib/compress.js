'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { color, formatSize, info, warn, error: logError } = require('./utils');

const NON_RETRYABLE_STATUS = new Set([401, 415]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single compression attempt (upload + download)
 * Resolves with { file, oldSize, newSize, success, retryable }
 */
function compressOnce(file, apiKey) {
  return new Promise((resolve) => {
    const oldSize = fs.statSync(file).size;
    const buffer = fs.readFileSync(file);
    const auth = 'Basic ' + Buffer.from('api:' + apiKey).toString('base64');

    const req = https.request({
      hostname: 'api.tinify.com',
      path: '/shrink',
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
      },
    }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(data).toString();
        if (res.statusCode === 201 && res.headers.location) {
          downloadCompressed(res.headers.location, auth, file, oldSize, resolve);
        } else {
          let msg = `HTTP ${res.statusCode}`;
          try {
            const err = JSON.parse(body);
            msg = `${err.error}, ${err.message}`;
          } catch {}
          const retryable = !NON_RETRYABLE_STATUS.has(res.statusCode);
          resolve({ file, oldSize, newSize: oldSize, success: false, retryable, errorMsg: msg });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ file, oldSize, newSize: oldSize, success: false, retryable: true, errorMsg: e.message });
    });

    req.write(buffer);
    req.end();
  });
}

function downloadCompressed(url, auth, file, oldSize, resolve) {
  https.get(url, { headers: { 'Authorization': auth } }, (imgRes) => {
    let imgData = [];
    imgRes.on('data', chunk => imgData.push(chunk));
    imgRes.on('end', () => {
      fs.writeFileSync(file, Buffer.concat(imgData));
      const newSize = fs.statSync(file).size;
      resolve({ file, oldSize, newSize, success: true, retryable: false, errorMsg: null });
    });
  }).on('error', (e) => {
    resolve({ file, oldSize, newSize: oldSize, success: false, retryable: true, errorMsg: e.message });
  });
}

/**
 * Compress a single image with retry support
 * @param {string} file
 * @param {string} apiKey
 * @param {{ index: number, total: number }} [progress]
 * @param {number} [retries=3]
 * @returns {Promise<{ file: string, oldSize: number, newSize: number, success: boolean }>}
 */
async function compressImage(file, apiKey, progress, retries) {
  const maxAttempts = (retries || 0) + 1;
  const tag = progress ? color(`[${progress.index}/${progress.total}]`, '1;35') + ' ' : '';

  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await compressOnce(file, apiKey);

    if (result.success) {
      const saved = result.oldSize - result.newSize;
      const percent = result.oldSize ? ((saved / result.oldSize) * 100).toFixed(2) : 0;
      console.log(
        tag +
        color('✔ Compressed:', '1;32') + ' ' +
        color(file, '1') + ', ' +
        color(`saved ${formatSize(saved)}`, '33') + ', ' +
        color(`${percent}% smaller`, '34')
      );
      return result;
    }

    if (!result.retryable || attempt === maxAttempts) {
      logError(`${tag}✖ Failed: ${file}, ${result.errorMsg}`);
      return result;
    }

    warn(`${tag}⚠ Attempt ${attempt}/${maxAttempts} failed: ${file}, ${result.errorMsg} — retrying in ${attempt}s...`);
    await sleep(attempt * 1000);
  }

  return result;
}

/**
 * Batch compress images with concurrency control
 * @param {string[]} files
 * @param {string} apiKey
 * @param {number} [maxConcurrency=5]
 * @param {number} [retries=3]
 * @returns {Promise<{ totalOldSize: number, totalNewSize: number, failCount: number, results: Array }>}
 */
function compressBatch(files, apiKey, maxConcurrency, retries) {
  maxConcurrency = maxConcurrency || 5;
  retries = retries !== undefined ? retries : 3;

  return new Promise((resolve) => {
    let index = 0;
    let running = 0;
    let progressIndex = 0;
    const total = files.length;
    const results = [];

    function next() {
      while (running < maxConcurrency && index < files.length) {
        running++;
        const currentFile = files[index++];
        progressIndex++;
        const progress = { index: progressIndex, total };

        compressImage(currentFile, apiKey, progress, retries).then((result) => {
          running--;
          results.push(result);
          if (results.length === total) {
            const totalOldSize = results.reduce((sum, r) => sum + r.oldSize, 0);
            const totalNewSize = results.reduce((sum, r) => sum + r.newSize, 0);
            const failCount = results.filter(r => !r.success).length;
            resolve({ totalOldSize, totalNewSize, failCount, results });
          }
          next();
        });
      }
    }

    next();
  });
}

/**
 * Print compression summary
 */
function printSummary(totalOldSize, totalNewSize, fileCount, failCount) {
  const totalSaved = totalOldSize - totalNewSize;
  const totalPercent = totalOldSize ? ((totalSaved / totalOldSize) * 100).toFixed(2) : 0;
  info('\n=== Summary ===');
  info(`Files: ${fileCount}` + (failCount > 0 ? color(` (${failCount} failed)`, '1;31') : ''));
  console.log(color(`Before: ${formatSize(totalOldSize)}`, '33'));
  console.log(color(`After:  ${formatSize(totalNewSize)}`, '32'));
  console.log(color(`Saved:  ${formatSize(totalSaved)}`, '1;33'));
  console.log(color(`Ratio:  ${totalPercent}%`, '1;34'));
}

module.exports = {
  compressImage,
  compressBatch,
  printSummary,
};
