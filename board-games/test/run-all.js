'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function discover(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return ['data', 'node_modules'].includes(entry.name) ? [] : discover(file);
    return entry.name.endsWith('.test.js') ? [file] : [];
  });
}
const result = spawnSync(process.execPath, ['--test', ...discover(root)], { stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exit(result.status === null ? 1 : result.status);
