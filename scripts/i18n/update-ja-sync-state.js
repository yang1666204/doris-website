#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , stateFilePath, sha] = process.argv;

if (!stateFilePath || !sha) {
  console.error('Usage: node update-ja-sync-state.js <stateFilePath> <sha>');
  process.exit(1);
}

const outputPath = path.isAbsolute(stateFilePath)
  ? stateFilePath
  : path.join(process.cwd(), stateFilePath);

const nextState = {
  lastSyncedSourceSha: sha,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');

console.log(`Updated JA sync state: ${outputPath} -> ${sha}`);
