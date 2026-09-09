const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const toasts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/detailed_toasts.json'), 'utf8'));
const dialogs = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/dialogs.json'), 'utf8'));
const catches = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/classified_catches.json'), 'utf8'));

console.log('=== ALL TOASTS (' + toasts.length + ') ===');
toasts.forEach(t => {
  console.log(`[Line ${t.line}] ${t.fullCall}`);
});

console.log('\n=== ALL DIALOGS (' + dialogs.length + ') ===');
dialogs.forEach(d => {
  console.log(`[${d.file}:${d.line}] ${d.text}`);
});

console.log('\n=== ALL CATCHES (' + catches.length + ') ===');
catches.forEach(c => {
  console.log(`[${c.type}] [${c.file}:${c.line}]\n${c.code}\n-------------------`);
});
