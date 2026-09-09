const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const rendererCode = fs.readFileSync(path.join(projectRoot, 'src/renderer/renderer.js'), 'utf8');
const lines = rendererCode.split(/\r?\n/);

const checkLines = [725, 953, 1045, 1087, 1352, 1454, 1545, 1576, 1605, 1638, 1669, 1937, 2010, 2197, 2236, 2507];

checkLines.forEach(l => {
  const start = Math.max(0, l - 3);
  const end = Math.min(lines.length, l + 6);
  console.log(`=== LINE ${l} ===`);
  for (let i = start; i < end; i++) {
    console.log(`${i+1}: ${lines[i]}`);
  }
});
