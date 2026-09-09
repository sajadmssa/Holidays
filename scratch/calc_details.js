const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
const db = new Database(dbPath, { readonly: true });
const LeaveService = require('../src/main/services/LeaveService');

const employees = db.prepare('SELECT * FROM Employees ORDER BY EmployeeID ASC').all();
const leaves = db.prepare(`
  SELECT l.*, lt.Name as LeaveTypeName 
  FROM Leaves l 
  JOIN LeaveTypes lt ON l.LeaveTypeID = lt.LeaveTypeID 
  ORDER BY l.LeaveID ASC
`).all();

const balances = db.prepare('SELECT * FROM LeaveBalances ORDER BY EmployeeID ASC, LeaveTypeID ASC').all();

const detailedReport = [];

for (const emp of employees) {
  const regBalance = LeaveService.calculateRegularLeaveBalance(emp.EmployeeID, db);
  const empLeaves = leaves.filter(l => l.EmployeeID === emp.EmployeeID);
  const empBalances = balances.filter(b => b.EmployeeID === emp.EmployeeID);
  
  detailedReport.push({
    employee: emp,
    leavesCount: empLeaves.length,
    leaves: empLeaves,
    regularCalculation: regBalance,
    storedBalances: empBalances
  });
}

fs.writeFileSync(path.join(__dirname, 'detailed_balance_report.json'), JSON.stringify(detailedReport, null, 2));
console.log('Done');
