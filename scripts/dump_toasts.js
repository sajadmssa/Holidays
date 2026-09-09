const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const rendererPath = path.join(projectRoot, 'src/renderer/renderer.js');
const rendererCode = fs.readFileSync(rendererPath, 'utf8');

// Regex to capture showToast calls: showToast(message, type, duration)
const toastRegex = /showToast\(\s*([\s\S]*?)\s*\);/g;
let match;
const allToasts = [];

const lines = rendererCode.split(/\r?\n/);

lines.forEach((line, idx) => {
  if (line.includes('showToast(')) {
    // extract line and subsequent lines until semicolon
    let text = line;
    let curr = idx;
    while (!text.includes(');') && curr < lines.length - 1) {
      curr++;
      text += ' ' + lines[curr].trim();
    }
    allToasts.push({
      line: idx + 1,
      snippet: text
    });
  }
});

console.log('Found', allToasts.length, 'toasts in renderer.js');
allToasts.forEach((t, i) => {
  console.log(`${i+1}. [Line ${t.line}] ${t.snippet}`);
});
