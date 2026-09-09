const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
console.log('AppData directory:', appData);
const files = fs.readdirSync(appData);
console.log('All files in AppData:', files);

files.forEach(f => {
  const fullPath = path.join(appData, f);
  const stat = fs.statSync(fullPath);
  console.log(`- ${f} (Size: ${stat.size}, Modified: ${stat.mtime.toISOString()}, Created: ${stat.birthtime.toISOString()})`);
  if (f.endsWith('.db') && !f.includes('-wal') && !f.includes('-shm')) {
    try {
      const db = new Database(fullPath, { readonly: true });
      const emp = db.prepare('SELECT EmployeeID, FullName, HireDate, LeaveCardNumber, LeaveApprover FROM Employees WHERE EmployeeID = 223452354').get();
      const allE = db.prepare('SELECT EmployeeID, FullName FROM Employees').all();
      console.log(`   Employees in ${f}:`, allE.map(e => `${e.EmployeeID}: ${e.FullName}`).join(', '));
      console.log(`   -> Found 223452354 in ${f}? ${emp ? JSON.stringify(emp) : 'NO'}`);
      db.close();
    } catch (e) {
      console.log(`   -> Error reading ${f}: ${e.message}`);
    }
  }
});
