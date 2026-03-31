#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, 'ja-source');
const targetRoot = path.join(repoRoot, 'i18n', 'ja');

if (!fs.existsSync(sourceRoot)) {
  console.error(`Source directory not found: ${sourceRoot}`);
  process.exit(1);
}

fs.rmSync(targetRoot, { recursive: true, force: true });
fs.mkdirSync(targetRoot, { recursive: true });

const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });

for (const entry of entries) {
  const sourcePath = path.join(sourceRoot, entry.name);
  const targetPath = path.join(targetRoot, entry.name);

  if (entry.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    continue;
  }

  if (entry.isFile()) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

console.log(`Synchronized ${entries.length} top-level entries from ja-source to i18n/ja.`);
