const Database = require('better-sqlite3');
const path = require('path');

const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const dbPath = path.join(appData, 'leave-management-system', 'leave_management.db');

console.log('Target DB path:', dbPath);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('--- ALL TABLES ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
console.log(tables.map(t => t.name));

console.log('\n--- LEAVES TABLE PRAGMA ---');
console.log(db.prepare("PRAGMA table_info(Leaves)").all());

console.log('\n--- EMPLOYEES TABLE PRAGMA ---');
console.log(db.prepare("PRAGMA table_info(Employees)").all());

console.log('\n--- ALL LEAVES IN DB ---');
const leaves = db.prepare(`
    SELECT l.LeaveID, l.EmployeeID, e.FullName, l.OrderNumber, l.OrderRef, l.MemoNumber, l.StartDate, l.EndDate
    FROM Leaves l
    JOIN Employees e ON l.EmployeeID = e.EmployeeID
`).all();
console.log(JSON.stringify(leaves, null, 2));

console.log('\n--- CHECK FOR NON-NUMERIC VALUES (^\d+$) ---');
const isNumeric = (val) => val !== null && val !== undefined && /^\d+$/.test(String(val).trim());

leaves.forEach(l => {
    const checks = [
        { field: 'OrderNumber', val: l.OrderNumber },
        { field: 'OrderRef', val: l.OrderRef },
        { field: 'MemoNumber', val: l.MemoNumber }
    ];
    checks.forEach(c => {
        if (c.val !== null && c.val !== undefined && String(c.val).trim() !== '') {
            const valid = isNumeric(c.val);
            console.log(`LeaveID: ${l.LeaveID}, Employee: ${l.FullName}, Field: ${c.field}, Value: "${c.val}", ValidNumeric: ${valid}`);
        } else {
            console.log(`LeaveID: ${l.LeaveID}, Employee: ${l.FullName}, Field: ${c.field}, Value: [EMPTY/NULL], ValidNumeric: N/A`);
        }
    });
});

db.close();
