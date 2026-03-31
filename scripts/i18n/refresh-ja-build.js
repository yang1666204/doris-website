#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, 'build');
const buildJaDir = path.join(buildDir, 'ja');
const jaBuildDir = path.join(repoRoot, 'ja-build');
const i18nJaDir = path.join(repoRoot, 'i18n', 'ja');

function removeDir(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run(process.execPath, [path.join('scripts', 'i18n', 'sync-ja-source-to-i18n.js')]);
removeDir(buildDir);

const githubInfoResult = spawnSync(process.execPath, [path.join('scripts', 'update_github_info.js')], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (githubInfoResult.status !== 0) {
  console.warn('Skipped GitHub star refresh; continuing with local ja-build generation.');
}

run(
  process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
  ['docusaurus', 'build', '--locale', 'en', '--locale', 'ja'],
  { PWA_SERVICE_WORKER_URL: 'https://doris.apache.org/sw.js' },
);

if (!fs.existsSync(buildJaDir)) {
  console.error(`Japanese build output not found: ${buildJaDir}`);
  process.exit(1);
}

removeDir(jaBuildDir);
fs.cpSync(buildJaDir, jaBuildDir, { recursive: true });
removeDir(buildDir);
removeDir(i18nJaDir);

console.log('Refreshed ja-build from build/ja.');
