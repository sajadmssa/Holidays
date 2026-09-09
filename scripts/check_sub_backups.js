const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');

['backups', 'auto-backups'].forEach(dirName => {
  const dir = path.join(appData, dirName);
  if (fs.existsSync(dir)) {
    console.log(`\n=== Directory: ${dirName} ===`);
    const files = fs.readdirSync(dir);
    files.forEach(f => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      console.log(`- ${f} (Size: ${stat.size}, Modified: ${stat.mtime.toISOString()})`);
      if (f.endsWith('.db')) {
        try {
          const db = new Database(fullPath, { readonly: true });
          const emp = db.prepare('SELECT EmployeeID, FullName FROM Employees WHERE EmployeeID = 223452354').get();
          const allE = db.prepare('SELECT EmployeeID, FullName FROM Employees').all();
          console.log(`   Employees in ${f}:`, allE.map(e => `${e.EmployeeID}: ${e.FullName}`).join(', '));
          console.log(`   -> Found 223452354 in ${f}? ${emp ? JSON.stringify(emp) : 'NO'}`);
          db.close();
        } catch (e) {
          console.log(`   -> Error reading ${f}: ${e.message}`);
        }
      }
    });
  }
});
