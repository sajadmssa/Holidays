const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING PROCESSES (ELECTRON) ===');
try {
  const tasks = execSync('tasklist').toString().split('\r\n').filter(l => l.toLowerCase().includes('electron'));
  console.log(tasks.join('\n'));
} catch (e) {
  console.error(e.message);
}

console.log('=== CHECK INDEX.HTML ===');
const indexPath = path.resolve(__dirname, '../src/renderer/index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');
const hasBtn = indexContent.includes('id="btn-transfer-emp"');
console.log('index.html path:', indexPath);
console.log('Has #btn-transfer-emp in file:', hasBtn);

// Find line 650-675
const lines = indexContent.split('\n');
console.log('Lines around btn-transfer-emp:');
for (let i = 655; i < 672; i++) {
  console.log(`${i+1}: ${lines[i]}`);
}

console.log('=== CHECK LINE 19 OF INDEX.HTML ===');
console.log('Lines 17-25:');
for (let i = 16; i < 25; i++) {
  console.log(`${i+1}: ${lines[i]}`);
}
