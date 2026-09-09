const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (filePath.endsWith('.js') || filePath.endsWith('.html')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

const allFiles = getAllFiles(srcDir);

const toasts = [];
const dialogs = [];
const tryCatches = [];

allFiles.forEach(filePath => {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const relPath = path.relative(projectRoot, filePath);

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    if (line.includes('showToast(')) {
      toasts.push({ file: relPath, line: lineNum, text: line.trim() });
    }
    if (line.includes('showConfirmModal(') || line.includes('dialog.showMessageBox') || line.includes('dialog.showErrorBox') || line.includes('dialog.showSaveDialog') || line.includes('dialog.showOpenDialog') || line.includes('new Notification(')) {
      dialogs.push({ file: relPath, line: lineNum, text: line.trim() });
    }
  });

  // Analyze try-catch blocks
  let inCatch = false;
  let catchStartLine = 0;
  let catchBlock = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (!inCatch && (line.match(/\bcatch\s*\(/) || line.match(/\bcatch\s*\{/))) {
      inCatch = true;
      catchStartLine = lineNum;
      catchBlock = [line];
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      braceDepth = openCount - closeCount;
      if (braceDepth <= 0 && openCount > 0) {
        // Single line catch
        tryCatches.push({
          file: relPath,
          line: catchStartLine,
          code: catchBlock.join('\n'),
        });
        inCatch = false;
      }
      continue;
    }

    if (inCatch) {
      catchBlock.push(line);
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;
      braceDepth += openCount - closeCount;
      if (braceDepth <= 0) {
        tryCatches.push({
          file: relPath,
          line: catchStartLine,
          code: catchBlock.join('\n'),
        });
        inCatch = false;
      }
    }
  }
});

console.log('=== ANALYSIS COMPLETE ===');
console.log('Total Toasts:', toasts.length);
console.log('Total Dialogs/Alerts:', dialogs.length);
console.log('Total Catch Blocks:', tryCatches.length);

const outDir = path.join(projectRoot, 'scripts', 'analysis_out');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'toasts.json'), JSON.stringify(toasts, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'dialogs.json'), JSON.stringify(dialogs, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'trycatches.json'), JSON.stringify(tryCatches, null, 2), 'utf8');
