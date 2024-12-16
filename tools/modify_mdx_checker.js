const path = require('path');
const fs = require('fs');

const constantsContent = fs.readFileSync(path.join(__dirname, '../docusaurus-mdx-checker/src/main.js'), 'utf-8');
const result = constantsContent.replaceAll('format = "mdx"', 'format = "detect"');

fs.writeFileSync(path.join(__dirname, '../docusaurus-mdx-checker/src/main.js'), result, 'utf-8');

