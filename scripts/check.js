// Syntax-checks every source file. Run with `npm run check`.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
};
['src', 'scripts', 'test'].forEach((dir) => walk(path.join(__dirname, '..', dir)));
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`checked ${files.length} files`);
