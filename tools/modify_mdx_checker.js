const path = require('path');
const fs = require('fs');

const constantsContent = fs.readFileSync(path.join(__dirname, '../docusaurus-mdx-checker/src/constants.js'), 'utf-8');
const result = constantsContent.replaceAll('**/*.{md,mdx}', '**/*.{mdx}');

fs.writeFileSync(path.join(__dirname, '../docusaurus-mdx-checker/src/constants.js'), result, 'utf-8');
