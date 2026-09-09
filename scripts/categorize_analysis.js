const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const toasts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/toasts.json'), 'utf8'));
const dialogs = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/dialogs.json'), 'utf8'));
const trycatches = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/trycatches.json'), 'utf8'));

// Let's analyze each toast and its surrounding context
const rendererLines = fs.readFileSync(path.join(projectRoot, 'src/renderer/renderer.js'), 'utf8').split(/\r?\n/);

const detailedToasts = toasts.map((t, idx) => {
  // Extract full showToast call if multi-line
  let start = t.line - 1;
  let fullCall = '';
  for (let i = start; i < Math.min(rendererLines.length, start + 10); i++) {
    fullCall += (fullCall ? ' ' : '') + rendererLines[i].trim();
    if (rendererLines[i].includes(');')) break;
  }
  return {
    id: idx + 1,
    file: t.file,
    line: t.line,
    fullCall,
  };
});

fs.writeFileSync(path.join(projectRoot, 'scripts/analysis_out/detailed_toasts.json'), JSON.stringify(detailedToasts, null, 2));

// Let's categorize catch blocks
const classifiedCatches = trycatches.map((c, idx) => {
  const code = c.code;
  const hasToast = code.includes('showToast') || code.includes('alert') || code.includes('dialog');
  const hasConsoleOnly = (code.includes('console.error') || code.includes('console.log') || code.includes('console.warn')) && !hasToast;
  const isIgnored = !code.includes('console') && !hasToast && !code.includes('throw') && !code.includes('return') && !code.includes('reject');
  const hasRethrow = code.includes('throw ') || code.includes('Promise.reject');
  const returnsError = code.includes('return {') || code.includes('return null') || code.includes('return false');

  let type = 'UNKNOWN';
  if (hasToast) type = 'USER_NOTIFIED';
  else if (hasRethrow) type = 'RETHROWN';
  else if (returnsError && code.includes('console')) type = 'CONSOLE_AND_RETURN_ERROR';
  else if (hasConsoleOnly) type = 'CONSOLE_ONLY_SILENT';
  else if (isIgnored) type = 'COMPLETELY_SILENT_IGNORED';

  return {
    id: idx + 1,
    file: c.file,
    line: c.line,
    type,
    code: c.code,
  };
});

fs.writeFileSync(path.join(projectRoot, 'scripts/analysis_out/classified_catches.json'), JSON.stringify(classifiedCatches, null, 2));

console.log('Detailed analysis saved.');
