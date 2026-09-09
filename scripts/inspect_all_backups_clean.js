const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
const tempDir = path.join(__dirname, '..', 'scratch', 'temp_check_dbs');
if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

function checkDb(filePath, label) {
  try {
    const tempFile = path.join(tempDir, 'temp_' + path.basename(filePath));
    fs.copyFileSync(filePath, tempFile);
    const db = new Database(tempFile);
    const emps = db.prepare('SELECT EmployeeID, FullName, HireDate, LeaveCardNumber, LeaveApprover FROM Employees').all();
    console.log(`\n=== [${label}] ===`);
    console.log('Employees:', emps.map(e => `[${e.EmployeeID}] ${e.FullName}`).join(' | '));
    const target = emps.find(e => e.EmployeeID == 223452354 || e.FullName.includes('يس'));
    console.log('Found 223452354?', target ? JSON.stringify(target) : 'NO');
    db.close();
    fs.unlinkSync(tempFile);
  } catch (e) {
    console.log(`=== [${label}] Error: ${e.message} ===`);
  }
}

// Check live DB
checkDb(path.join(appData, 'leave_management.db'), 'LIVE DB');

// Check backups in backups/
const backupsDir = path.join(appData, 'backups');
if (fs.existsSync(backupsDir)) {
  fs.readdirSync(backupsDir).filter(f => f.endsWith('.db')).forEach(f => {
    checkDb(path.join(backupsDir, f), `Backup: ${f}`);
  });
}

// Check auto-backups/
const autoBackupsDir = path.join(appData, 'auto-backups');
if (fs.existsSync(autoBackupsDir)) {
  fs.readdirSync(autoBackupsDir).filter(f => f.endsWith('.db')).forEach(f => {
    checkDb(path.join(autoBackupsDir, f), `AutoBackup: ${f}`);
  });
}

// Check root backups
checkDb(path.join(appData, 'leave_management_backup_2026-09-02.db'), 'leave_management_backup_2026-09-02.db');

fs.rmSync(tempDir, { recursive: true, force: true });
