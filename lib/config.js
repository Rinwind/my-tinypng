'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.tinypngrc');
const PROJECT_CONFIG_NAME = '.tinypngrc';

const VALID_CONFIG_KEYS = {
  apiKey: { type: 'string', description: 'TinyPNG API Key' },
  maxConcurrency: { type: 'number', description: 'Max concurrency (default: 5)' },
  retries: { type: 'number', description: 'Retry attempts on network failure (default: 3)' },
  autoStage: { type: 'boolean', description: 'Auto git-add after compress in git mode (default: true)' },
  respectGitignore: { type: 'boolean', description: 'Exclude .gitignore matched files (default: true)' },
};

function readJsonConfig(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readPackageJsonConfig(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  const pkg = readJsonConfig(pkgPath);
  if (pkg && pkg.tinypng) {
    return pkg.tinypng;
  }
  return null;
}

function readProjectConfig(projectDir) {
  const rcPath = path.join(projectDir, PROJECT_CONFIG_NAME);
  return readJsonConfig(rcPath);
}

function readGlobalConfig() {
  return readJsonConfig(GLOBAL_CONFIG_PATH);
}

function writeGlobalConfig(config) {
  const existing = readGlobalConfig() || {};
  const merged = { ...existing, ...config };
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function deleteGlobalConfigKey(key) {
  const existing = readGlobalConfig();
  if (!existing || !(key in existing)) return false;
  delete existing[key];
  if (Object.keys(existing).length === 0) {
    fs.unlinkSync(GLOBAL_CONFIG_PATH);
  } else {
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(existing, null, 2), 'utf8');
  }
  return true;
}

/**
 * Resolve config with priority:
 *   env TINYPNG_API_KEY > project .tinypngrc > package.json > global ~/.tinypngrc
 *
 * Throws if no apiKey is found (safe for both CLI and programmatic usage).
 *
 * @param {string} [projectDir]
 * @returns {{ apiKey: string, maxConcurrency: number, autoStage: boolean, source: string }}
 */
function getConfig(projectDir) {
  const cwd = projectDir || process.cwd();
  const envKey = process.env.TINYPNG_API_KEY;

  let fileConfig = null;
  let fileSource = '';

  const projectRc = readProjectConfig(cwd);
  if (projectRc && projectRc.apiKey) {
    fileConfig = projectRc;
    fileSource = 'project (.tinypngrc)';
  }

  if (!fileConfig) {
    const pkgConfig = readPackageJsonConfig(cwd);
    if (pkgConfig && pkgConfig.apiKey) {
      fileConfig = pkgConfig;
      fileSource = 'project (package.json)';
    }
  }

  if (!fileConfig) {
    const globalRc = readGlobalConfig();
    if (globalRc && globalRc.apiKey) {
      fileConfig = globalRc;
      fileSource = 'global (~/.tinypngrc)';
    }
  }

  if (envKey) {
    const merged = { ...(fileConfig || {}), apiKey: envKey };
    return normalizeConfig(merged, 'env (TINYPNG_API_KEY)');
  }

  if (fileConfig) {
    return normalizeConfig(fileConfig, fileSource);
  }

  const msg = [
    'API Key not found! Please configure it in one of the following ways:',
    '',
    '  1. Environment variable:',
    '     export TINYPNG_API_KEY=<YOUR_API_KEY>',
    '',
    '  2. Global config (recommended for global install):',
    '     tinypng config set apiKey <YOUR_API_KEY>',
    '',
    '  3. Project config (recommended for project integration):',
    '     Create .tinypngrc in project root:',
    '     { "apiKey": "YOUR_API_KEY" }',
    '',
    '  4. Add "tinypng" field in package.json:',
    '     { "tinypng": { "apiKey": "YOUR_API_KEY" } }',
  ].join('\n');

  throw new Error(msg);
}

function normalizeConfig(raw, source) {
  return {
    apiKey: raw.apiKey,
    maxConcurrency: raw.maxConcurrency || 5,
    retries: raw.retries !== undefined ? raw.retries : 3,
    autoStage: raw.autoStage !== false,
    respectGitignore: raw.respectGitignore !== false,
    source,
  };
}

module.exports = {
  getConfig,
  readGlobalConfig,
  writeGlobalConfig,
  deleteGlobalConfigKey,
  VALID_CONFIG_KEYS,
  GLOBAL_CONFIG_PATH,
};
