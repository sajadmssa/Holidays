// deep_analysis.js
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rootDir = 'C:\\Users\\3D\\Desktop\\Holidays';

// ── 1. Root Files Analysis ─────────────────────────────────────
const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
const rootFilesAnalysis = [];

for (const e of rootEntries) {
  if (e.isFile()) {
    const fullPath = path.join(rootDir, e.name);
    const stat = fs.statSync(fullPath);
    let dbDetails = null;

    if (e.name.endsWith('.db')) {
      try {
        const db = new Database(fullPath, { readonly: true });
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
        const empCount = tables.includes('Employees') ? db.prepare('SELECT COUNT(*) as c FROM Employees').get().c : 0;
        const leavesCount = tables.includes('Leaves') ? db.prepare('SELECT COUNT(*) as c FROM Leaves').get().c : 0;
        const auditCount = tables.includes('AuditLogs') ? db.prepare('SELECT COUNT(*) as c FROM AuditLogs').get().c : 0;
        
        let sampleEmployees = [];
        if (tables.includes('Employees')) {
          sampleEmployees = db.prepare('SELECT EmployeeID, FullName FROM Employees LIMIT 10').all();
        }
        
        dbDetails = {
          tablesCount: tables.length,
          tables,
          empCount,
          leavesCount,
          auditCount,
          sampleEmployees,
        };
        db.close();
      } catch (err) {
        dbDetails = { error: err.message };
      }
    }

    rootFilesAnalysis.push({
      name: e.name,
      sizeBytes: stat.size,
      created: stat.birthtime,
      modified: stat.mtime,
      dbDetails,
    });
  }
}

// ── 2. Check usages of root files across src, scripts, package.json ─────
function searchInFiles(dir, term) {
  const matches = [];
  function recurse(currentDir) {
    const list = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const item of list) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const p = path.join(currentDir, item.name);
      if (item.isDirectory()) {
        recurse(p);
      } else if (item.isFile() && (p.endsWith('.js') || p.endsWith('.json') || p.endsWith('.html') || p.endsWith('.css') || p.endsWith('.md'))) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          if (content.includes(term)) {
            matches.push(path.relative(rootDir, p));
          }
        } catch (_) {}
      }
    }
  }
  recurse(dir);
  return matches;
}

for (const rf of rootFilesAnalysis) {
  rf.codeReferences = searchInFiles(rootDir, rf.name);
}

// ── 3. Dependencies Analysis ───────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const declaredDependencies = Object.keys(pkg.dependencies || {});
const declaredDevDependencies = Object.keys(pkg.devDependencies || {});

const importedModules = new Set();
function findImports(dir) {
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    if (item.name === 'node_modules' || item.name === '.git') continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) {
      findImports(p);
    } else if (item.isFile() && (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs'))) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        // match require('...')
        const reqMatches = content.matchAll(/require\s*\(\s*['"]([^'"./\\][^'"]*)['"]\s*\)/g);
        for (const m of reqMatches) {
          const mod = m[1].split('/')[0];
          importedModules.add(mod);
        }
        // match import ... from '...'
        const impMatches = content.matchAll(/from\s*['"]([^'"./\\][^'"]*)['"]/g);
        for (const m of impMatches) {
          const mod = m[1].split('/')[0];
          importedModules.add(mod);
        }
      } catch (_) {}
    }
  }
}
findImports(path.join(rootDir, 'src'));

// ── 4. node_modules size breakdown ─────────────────────────────
const nodeModulesPath = path.join(rootDir, 'node_modules');
const packageSizes = [];
let totalNodeModulesSize = 0;

if (fs.existsSync(nodeModulesPath)) {
  const pkgs = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
  for (const p of pkgs) {
    const pkgPath = path.join(nodeModulesPath, p.name);
    let size = 0;
    function getDirSize(d) {
      try {
        const list = fs.readdirSync(d, { withFileTypes: true });
        for (const it of list) {
          const ip = path.join(d, it.name);
          if (it.isDirectory()) {
            getDirSize(ip);
          } else if (it.isFile()) {
            size += fs.statSync(ip).size;
          }
        }
      } catch (_) {}
    }
    getDirSize(pkgPath);
    totalNodeModulesSize += size;
    packageSizes.push({ name: p.name, sizeBytes: size, sizeMB: (size / (1024 * 1024)).toFixed(2) });
  }
}

packageSizes.sort((a, b) => b.sizeBytes - a.sizeBytes);

// ── 5. Output Result ───────────────────────────────────────────
const result = {
  rootFilesAnalysis,
  dotfiles: {
    gitignore: fs.existsSync(path.join(rootDir, '.gitignore')),
    git: fs.existsSync(path.join(rootDir, '.git')),
  },
  dependenciesAnalysis: {
    pkgDependencies: declaredDependencies,
    pkgDevDependencies: declaredDevDependencies,
    importedModulesInSrc: Array.from(importedModules),
    scriptsInPkg: pkg.scripts,
    buildConfig: pkg.build || null,
  },
  nodeModulesAnalysis: {
    totalSizeMB: (totalNodeModulesSize / (1024 * 1024)).toFixed(2),
    top15Packages: packageSizes.slice(0, 15),
  },
};

fs.writeFileSync(path.join(rootDir, 'scratch', 'deep_analysis_result.json'), JSON.stringify(result, null, 2), 'utf8');
console.log('✅ Analysis complete! Written to scratch/deep_analysis_result.json');
