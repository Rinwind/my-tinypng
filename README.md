# my-tinypng

[![npm version](https://img.shields.io/npm/v/my-tinypng.svg)](https://www.npmjs.com/package/my-tinypng)
[![license](https://img.shields.io/npm/l/my-tinypng.svg)](https://github.com/user/my-tinypng/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/my-tinypng.svg)](https://nodejs.org)

Image compression CLI powered by TinyPNG API. Supports both global installation and project-level integration.

## Installation

### Global

```bash
npm install -g my-tinypng
tinypng config set apiKey YOUR_TINYPNG_API_KEY
```

### Project

```bash
npm install my-tinypng --save-dev
```

Create a `.tinypngrc` file in the project root (remember to add it to `.gitignore`):

```json
{
  "apiKey": "YOUR_TINYPNG_API_KEY"
}
```

Or add a `tinypng` field in `package.json`:

```json
{
  "tinypng": {
    "apiKey": "YOUR_TINYPNG_API_KEY"
  }
}
```

## Config Priority

1. Environment variable `TINYPNG_API_KEY`
2. Project `.tinypngrc` file
3. `"tinypng"` field in project `package.json`
4. Global `~/.tinypngrc`

## Config Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `apiKey` | string | — | TinyPNG API Key (required) |
| `maxConcurrency` | number | `5` | Max concurrent uploads |
| `retries` | number | `3` | Retry attempts per image on network failure |
| `autoStage` | boolean | `true` | Auto `git add` after compress in git mode |
| `respectGitignore` | boolean | `true` | Exclude `.gitignore` matched files in git mode |

## CLI Usage

```bash
# Show help
tinypng --help

# Compress images in current directory (top-level only)
tinypng compress

# Compress images recursively
tinypng compress --deep

# Compress a specific directory (short flag -d)
tinypng compress src/assets/ -d

# Compress specific files
tinypng compress logo.png banner.jpg

# Preview without compressing
tinypng compress --dry-run

# Compress git staged images (auto re-stages after compress)
tinypng git

# Override config for this run
tinypng git --no-stage --no-ignore

# Manage config
tinypng config set apiKey YOUR_API_KEY
tinypng config set maxConcurrency 10
tinypng config set autoStage false
tinypng config get
tinypng config delete apiKey
tinypng config list
```

## Programmatic Usage

```js
const { compressImage, compressBatch, getConfig } = require('my-tinypng');

const config = getConfig();

compressImage('logo.png', config.apiKey).then(result => {
  console.log(result);
});

compressBatch(['a.png', 'b.jpg'], config.apiKey, 5).then(({ totalOldSize, totalNewSize }) => {
  console.log(`Saved: ${totalOldSize - totalNewSize} bytes`);
});
```

> Note: `getConfig()` throws an error if no API Key is found, so you can wrap it in try/catch.

## Git Hooks Integration

### With husky

```bash
npm install husky --save-dev
npx husky init
```

Add to `.husky/pre-commit`:

```bash
npx tinypng git
```

Compressed images are automatically re-staged (controlled by the `autoStage` config key).

## Supported Formats

- PNG
- JPG / JPEG
- WebP

## License

MIT
