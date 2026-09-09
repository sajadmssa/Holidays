// find_modal_styles.js
'use strict';
const fs = require('fs');
const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
const lines = css.split('\n');

console.log('--- Matching Lines in styles.css ---');
lines.forEach((line, idx) => {
  if (line.includes('dialog') || line.includes('modal') || line.includes('system-settings') || line.includes('edit-leave')) {
    console.log(`Line ${(idx + 1).toString().padStart(4)}: ${line}`);
  }
});
