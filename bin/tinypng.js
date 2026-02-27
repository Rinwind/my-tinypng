#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getConfig, writeGlobalConfig, readGlobalConfig, deleteGlobalConfigKey, VALID_CONFIG_KEYS, GLOBAL_CONFIG_PATH } = require('../lib/config');
const { compressBatch, printSummary } = require('../lib/compress');
const { color, success, warn, error, info } = require('../lib/utils');

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
${color('my-tinypng', '1;36')} - Image compression tool powered by TinyPNG

${color('Usage:', '1')}
  tinypng git [--no-stage] [--no-ignore]   Compress git staged images
  tinypng compress [path] [--deep] [--dry-run]
                                           Compress images in current dir or given path
  tinypng config set <key> <value>         Set a global config property
  tinypng config get [key]                 Show config info (optionally for a specific key)
  tinypng config delete <key>              Delete a global config property
  tinypng config list                      List all available config keys
  tinypng --help, -h                       Show help
  tinypng --version, -v                    Show version

${color('Commands:', '1')}
  git        Compress images in git staging area (ideal for pre-commit hooks)
  compress   Compress images, top-level only by default, use --deep for recursive
  config     Manage configuration

${color('Git Options:', '1')}
  --no-stage     Skip auto git-add for this run
  --no-ignore    Skip .gitignore filtering for this run

${color('Compress Options:', '1')}
  [path]       File or directory path, multiple allowed, defaults to cwd
  --deep, -d   Recursively traverse subdirectories (default: top-level only)
  --dry-run    Preview files to be compressed without actually compressing

${color('Config Keys:', '1')}
  apiKey             TinyPNG API Key
  maxConcurrency     Max concurrency (default: 5)
  retries            Retry attempts on network failure (default: 3)
  autoStage          Auto git-add after compress in git mode (default: true)
  respectGitignore   Exclude .gitignore matched files (default: true)

${color('Config Priority:', '1')}
  1. Environment variable TINYPNG_API_KEY
  2. Project .tinypngrc file
  3. "tinypng" field in project package.json
  4. Global config ~/.tinypngrc

${color('Examples:', '1')}
  tinypng config set apiKey RtncqVftzcYrN40xxx    Set API Key
  tinypng config set maxConcurrency 10            Set max concurrency
  tinypng config set autoStage false              Disable auto git-add
  tinypng config set respectGitignore false       Disable .gitignore filter
  tinypng config get                              Show all config
  tinypng git                                     Compress staged images
  tinypng git --no-stage --no-ignore              Override config for this run
  tinypng compress                                Compress cwd images (top-level)
  tinypng compress --deep                         Compress cwd images (recursive)
  tinypng compress src/assets/ -d                 Compress a directory recursively
  tinypng compress --dry-run                      Preview without compressing
  tinypng compress logo.png banner.jpg            Compress specific files
`);
}

function showVersion() {
  const pkg = require('../package.json');
  console.log(pkg.version);
}

function loadConfig() {
  try {
    return getConfig();
  } catch (e) {
    error(e.message);
    process.exit(1);
  }
}

// ── config ──────────────────────────────────────────────────────────────

function printConfigSource(label, configObj, filterKey) {
  if (!configObj) return;
  const keys = filterKey ? [filterKey] : Object.keys(configObj);
  const entries = keys.filter(k => configObj[k] !== undefined);
  if (entries.length === 0) return;

  console.log(color(label, '1'));
  for (const k of entries) {
    console.log(`  ${k}: ${configObj[k]}`);
  }
}

function validateConfigKey(key) {
  if (!VALID_CONFIG_KEYS[key]) {
    error(`Unknown config key: ${key}`);
    console.log('');
    console.log('Available keys:');
    for (const [k, v] of Object.entries(VALID_CONFIG_KEYS)) {
      console.log(`  ${color(k, '1')}  ${v.description}`);
    }
    process.exit(1);
  }
}

function parseConfigValue(key, raw) {
  const def = VALID_CONFIG_KEYS[key];
  if (def.type === 'number') {
    const num = Number(raw);
    if (isNaN(num)) {
      error(`Config key "${key}" expects a number, got: ${raw}`);
      process.exit(1);
    }
    return num;
  }
  if (def.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    error(`Config key "${key}" expects true or false, got: ${raw}`);
    process.exit(1);
  }
  return raw;
}

function handleConfig() {
  const subCmd = args[1];

  if (subCmd === 'set') {
    const key = args[2];
    const value = args[3];
    if (!key || value === undefined) {
      error('Usage: tinypng config set <key> <value>');
      error('Example: tinypng config set apiKey YOUR_API_KEY');
      process.exit(1);
    }
    validateConfigKey(key);
    const parsed = parseConfigValue(key, value);
    writeGlobalConfig({ [key]: parsed });
    success(`✔ ${key} saved to ${GLOBAL_CONFIG_PATH}`);
    return;
  }

  if (subCmd === 'get') {
    const filterKey = args[2];
    if (filterKey) validateConfigKey(filterKey);

    info('=== Configuration ===\n');

    const envKey = process.env.TINYPNG_API_KEY;
    if (envKey && (!filterKey || filterKey === 'apiKey')) {
      console.log(color('Environment:', '1'));
      console.log(`  TINYPNG_API_KEY: ${envKey}`);
      console.log('');
    }

    const globalCfg = readGlobalConfig();
    printConfigSource(`Global (${GLOBAL_CONFIG_PATH}):`, globalCfg, filterKey);
    if (!globalCfg) warn('Global config: not set');

    const projectRcPath = path.join(process.cwd(), '.tinypngrc');
    if (fs.existsSync(projectRcPath)) {
      try {
        const projectCfg = JSON.parse(fs.readFileSync(projectRcPath, 'utf8'));
        console.log('');
        printConfigSource(`Project (${projectRcPath}):`, projectCfg, filterKey);
      } catch {}
    }

    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.tinypng) {
          console.log('');
          printConfigSource('Package.json:', pkg.tinypng, filterKey);
        }
      } catch {}
    }
    return;
  }

  if (subCmd === 'delete') {
    const key = args[2];
    if (!key) {
      error('Usage: tinypng config delete <key>');
      error('Example: tinypng config delete apiKey');
      process.exit(1);
    }
    validateConfigKey(key);
    if (deleteGlobalConfigKey(key)) {
      success(`✔ Deleted global config key: ${key}`);
    } else {
      warn(`Key "${key}" not found in global config, nothing to delete`);
    }
    return;
  }

  if (subCmd === 'list') {
    info('=== Available Config Keys ===\n');
    for (const [k, v] of Object.entries(VALID_CONFIG_KEYS)) {
      console.log(`  ${color(k, '1')}  ${v.description}`);
    }
    return;
  }

  if (!subCmd) {
    error('Missing subcommand');
  } else {
    error(`Unknown config subcommand: ${subCmd}`);
  }
  console.log('Available subcommands: set, get, delete, list');
  process.exit(1);
}

// ── file collection ─────────────────────────────────────────────────────

function getGitStagedImages() {
  try {
    const unstaged = execSync('git diff --name-only', { encoding: 'utf8' });
    if (unstaged.trim() !== '') {
      error('Working tree has unstaged changes. Please stage all changes first.');
      error('Try running: git add -A');
      process.exit(1);
    }
  } catch (e) {
    error('Not a git repository or git is not available.');
    process.exit(1);
  }

  const output = execSync('git diff --cached --name-only', { encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .map(f => f.trim())
    .filter(f => f && /\.(png|jpg|jpeg|webp)$/i.test(f) && fs.existsSync(f));
}

function collectImages(targetPath, deep) {
  const images = [];
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    if (/\.(png|jpg|jpeg|webp)$/i.test(targetPath)) {
      images.push(path.resolve(targetPath));
    }
    return images;
  }

  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const fullPath = path.join(targetPath, entry);
      try {
        const entryStat = fs.statSync(fullPath);
        if (entryStat.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry)) {
          images.push(path.resolve(fullPath));
        } else if (entryStat.isDirectory() && deep) {
          images.push(...collectImages(fullPath, true));
        }
      } catch {}
    }
  }

  return images;
}

function dedupe(files) {
  return [...new Set(files)];
}

/**
 * Filter out files matching .gitignore patterns
 */
function filterGitIgnored(files) {
  if (files.length === 0) return files;
  try {
    const input = files.join('\n');
    const result = execSync('git check-ignore --stdin', { input, encoding: 'utf8' });
    const ignored = new Set(result.split(/\r?\n/).map(f => f.trim()).filter(Boolean));
    if (ignored.size > 0) {
      for (const f of ignored) {
        warn(`Skipping gitignored file: ${f}`);
      }
    }
    return files.filter(f => !ignored.has(f));
  } catch {
    return files;
  }
}

// ── arg parsing ─────────────────────────────────────────────────────────

const FLAG_OPTIONS = ['--deep', '-d', '--dry-run'];

function parseCompressArgs() {
  const subArgs = args.slice(1);
  const deep = subArgs.includes('--deep') || subArgs.includes('-d');
  const dryRun = subArgs.includes('--dry-run');
  const paths = subArgs.filter(a => !FLAG_OPTIONS.includes(a));
  return { paths, deep, dryRun };
}

// ── handlers ────────────────────────────────────────────────────────────

async function handleCompress() {
  const config = loadConfig();
  info(`Config source: ${config.source}`);

  const { paths, deep, dryRun } = parseCompressArgs();
  let files = [];

  if (paths.length === 0) {
    info(`Compressing images in cwd${deep ? ' (recursive)' : ' (top-level only)'}...`);
    files = collectImages(process.cwd(), deep);
  } else {
    for (const p of paths) {
      const resolved = path.resolve(p);
      if (!fs.existsSync(resolved)) {
        warn(`Skipping non-existent path: ${p}`);
        continue;
      }
      files.push(...collectImages(resolved, deep));
    }
  }

  files = dedupe(files);

  if (files.length === 0) {
    warn('No images found.');
    process.exit(0);
  }

  if (dryRun) {
    info(`Dry run: ${files.length} image(s) would be compressed:\n`);
    for (const f of files) {
      console.log(`  ${f}`);
    }
    return;
  }

  info(`Found ${files.length} image(s), compressing...\n`);

  const { totalOldSize, totalNewSize, failCount } = await compressBatch(
    files,
    config.apiKey,
    config.maxConcurrency,
    config.retries
  );

  printSummary(totalOldSize, totalNewSize, files.length, failCount);

  if (failCount > 0) process.exit(1);
}

function parseGitArgs() {
  const subArgs = args.slice(1);
  return {
    noStage: subArgs.includes('--no-stage'),
    noIgnore: subArgs.includes('--no-ignore'),
  };
}

async function handleGit() {
  const config = loadConfig();
  const gitArgs = parseGitArgs();
  info(`Config source: ${config.source}`);

  let files = getGitStagedImages();

  const useIgnore = config.respectGitignore && !gitArgs.noIgnore;
  if (useIgnore) {
    files = filterGitIgnored(files);
  }

  if (files.length === 0) {
    warn('No staged images found.');
    process.exit(0);
  }

  info(`Found ${files.length} staged image(s), compressing...\n`);

  const { totalOldSize, totalNewSize, failCount, results } = await compressBatch(
    files,
    config.apiKey,
    config.maxConcurrency,
    config.retries
  );

  printSummary(totalOldSize, totalNewSize, files.length, failCount);

  if (failCount > 0) {
    const failed = results.filter(r => !r.success).map(r => r.file);
    const compressed = results.filter(r => r.success).map(r => r.file);
    console.log('');
    error(`${failCount} image(s) failed to compress:`);
    for (const f of failed) {
      console.log(color(`  - ${f}`, '31'));
    }
    if (compressed.length > 0) {
      console.log('');
      warn(`${compressed.length} image(s) compressed successfully and left in working tree (not staged).`);
    }
    process.exit(1);
  }

  const doStage = config.autoStage && !gitArgs.noStage;
  if (doStage) {
    const compressed = results.filter(r => r.success).map(r => r.file);
    if (compressed.length > 0) {
      execSync(`git add ${compressed.map(f => `"${f}"`).join(' ')}`);
      success(`✔ Auto-staged ${compressed.length} compressed image(s)`);
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  if (command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    showVersion();
    return;
  }

  if (command === 'config') {
    handleConfig();
    return;
  }

  if (command === 'compress') {
    await handleCompress();
    return;
  }

  if (command === 'git') {
    await handleGit();
    return;
  }

  if (command) {
    error(`Unknown command: ${command}`);
  }
  showHelp();
}

main().catch((err) => {
  error(`Error: ${err.message}`);
  process.exit(1);
});
