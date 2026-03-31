#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = process.cwd();
const tempLocaleRoot = path.join(repoRoot, 'i18n', 'ja');
const jaSourceRoot = path.join(repoRoot, 'ja-source', 'docusaurus-plugin-content-docs');
const AWS_API_KEY = process.env.AWS_API_KEY;

if (!AWS_API_KEY) {
  console.error('Missing AWS_API_KEY');
  process.exit(1);
}

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

async function translateText(text) {
  const payload = {
    messages: [
      {
        role: 'assistant',
        content: [
          {
            text: `You are a professional technical documentation translator.

Translate the following English UI/sidebar text into concise, natural Japanese.

Strict rules:
1. Preserve the meaning exactly.
2. Keep product names and common technical terms in English when that is natural in Japanese docs.
3. Output only the translated text.
4. Do not add punctuation, notes, or explanations unless the source contains them.
`,
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            text: `Translate the text inside the markers below.

<<<BEGIN>>>
${text}
<<<END>>>`,
          },
        ],
      },
    ],
  };

  const url =
    'https://bedrock-runtime.us-east-1.amazonaws.com/model/' +
    'us.anthropic.claude-sonnet-4-20250514-v1:0/converse';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AWS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Claude API error: ${res.status} ${msg}`);
  }

  const data = await res.json();
  const output = data?.output?.message?.content?.[0]?.text;
  if (!output) {
    throw new Error('Invalid Claude API response');
  }
  return output.trim();
}

function listSidebarFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => file === 'current.json' || /^version-.*\.json$/.test(file))
    .sort();
}

async function main() {
  removeDir(tempLocaleRoot);
  run(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', [
    'docusaurus',
    'write-translations',
    '--locale',
    'ja',
    '--override',
  ]);

  const tempDocsRoot = path.join(tempLocaleRoot, 'docusaurus-plugin-content-docs');
  if (!fs.existsSync(tempDocsRoot)) {
    console.error(`Temporary sidebar translations not found: ${tempDocsRoot}`);
    process.exit(1);
  }

  fs.mkdirSync(jaSourceRoot, { recursive: true });

  const files = listSidebarFiles(tempDocsRoot);
  let changedFiles = 0;
  let translatedKeys = 0;
  let removedKeys = 0;

  for (const file of files) {
    const sourcePath = path.join(tempDocsRoot, file);
    const targetPath = path.join(jaSourceRoot, file);

    const sourceJson = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const targetJson = fs.existsSync(targetPath)
      ? JSON.parse(fs.readFileSync(targetPath, 'utf8'))
      : {};

    const nextJson = {};
    let fileChanged = false;

    for (const [key, value] of Object.entries(sourceJson)) {
      const existing = targetJson[key];
      if (
        existing &&
        existing.description === value.description &&
        typeof existing.message === 'string' &&
        existing.message.trim()
      ) {
        nextJson[key] = existing;
        continue;
      }

      const translatedMessage = await translateText(value.message);
      nextJson[key] = {
        ...value,
        message: translatedMessage,
      };
      translatedKeys += 1;
      fileChanged = true;
    }

    for (const key of Object.keys(targetJson)) {
      if (!(key in sourceJson)) {
        removedKeys += 1;
        fileChanged = true;
      }
    }

    const before = `${JSON.stringify(targetJson, null, 2)}\n`;
    const after = `${JSON.stringify(nextJson, null, 2)}\n`;

    if (!fs.existsSync(targetPath) || before !== after || fileChanged) {
      fs.writeFileSync(targetPath, after, 'utf8');
      changedFiles += 1;
    }
  }

  removeDir(tempLocaleRoot);
  console.log(
    `Updated sidebar translation files: ${changedFiles}, translatedKeys=${translatedKeys}, removedKeys=${removedKeys}`,
  );
}

main().catch((error) => {
  removeDir(tempLocaleRoot);
  console.error(error);
  process.exit(1);
});
