const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const catches = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/full_catch_audit.json'), 'utf8'));

const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
catches.forEach(c => {
  counts[c.severity] = (counts[c.severity] || 0) + 1;
});

console.log('Severity distribution:', counts);

console.log('\n--- CRITICAL ISSUES ---');
catches.filter(c => c.severity === 'CRITICAL').forEach(c => {
  console.log(`[#${c.index}] [${c.file}:${c.line}] ${c.category}`);
  console.log(`الوصف: ${c.description}`);
  console.log(`الأثر: ${c.userImpact}\n`);
});

console.log('\n--- MEDIUM ISSUES (Silent UI failures) ---');
catches.filter(c => c.severity === 'MEDIUM').forEach(c => {
  console.log(`[#${c.index}] [${c.file}:${c.line}] ${c.category}`);
  console.log(`الوصف: ${c.description}`);
  console.log(`الأثر: ${c.userImpact}\n`);
});
