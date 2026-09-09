/**
 * test_threshold_behavior.js
 * Verifies getCriticalBalancesPaginated with various threshold values.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const { getCriticalBalancesPaginated } = require('../src/main/services/ReportService');

// Use isolated DB with standard schema
const testDbPath = path.join(__dirname, 'test_threshold.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma('foreign_keys = ON');

const migrationsDir = path.join(__dirname, '../src/main/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
        db.exec(sql);
    } catch (err) {
        if (!err.message.includes('duplicate column name')) throw err;
    }
}

db.exec(`
    INSERT OR IGNORE INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef) 
    VALUES (1, 'إجازة اعتيادية', 30, 0), (29, 'إجازة مرضية', 30, 0);
`);

// Insert employees with varying hire dates so they have different balances
// Today is assumed ~ 2026-09-06
db.exec(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, AdjustmentDays, IsActive) VALUES 
        (1, 'علي الرافدين', 'Male', '2026-08-01', 'مهندس', 'بغداد', 'C-1', 0, 1),      -- ~36 days -> ~3.6 days earned -> balance ~3
        (2, 'زينب حسن', 'Female', '2026-05-01', 'باحث', 'البصرة', 'C-2', 0, 1),       -- ~128 days -> ~12.8 days earned -> balance ~12
        (3, 'مصطفى كريم', 'Male', '2025-01-01', 'مدقق', 'أربيل', 'C-3', 0, 1),        -- ~600 days -> ~60 days earned -> balance ~60
        (4, 'نور الهدى', 'Female', '2020-01-01', 'مدير', 'بغداد', 'C-4', 0, 1);       -- ~2400 days -> 180 max -> balance ~180
`);

console.log('Testing threshold = 5:');
const res5 = getCriticalBalancesPaginated(db, { threshold: 5, page: 1, pageSize: 15 });
console.log(`Count matching threshold 5: ${res5.data.length} employees:`, res5.data.map(e => `${e.FullName} (Balance: ${e.RemainingBalance})`));

console.log('\nTesting threshold = 20:');
const res20 = getCriticalBalancesPaginated(db, { threshold: 20, page: 1, pageSize: 15 });
console.log(`Count matching threshold 20: ${res20.data.length} employees:`, res20.data.map(e => `${e.FullName} (Balance: ${e.RemainingBalance})`));

console.log('\nTesting threshold = 100:');
const res100 = getCriticalBalancesPaginated(db, { threshold: 100, page: 1, pageSize: 15 });
console.log(`Count matching threshold 100: ${res100.data.length} employees:`, res100.data.map(e => `${e.FullName} (Balance: ${e.RemainingBalance})`));

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
