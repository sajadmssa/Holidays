const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'leave-management-system', 'leave_management.db');
const db = new Database(dbPath);

const { calculateRegularLeaveBalance } = require('../src/main/services/LeaveService');

const employees = db.prepare('SELECT EmployeeID, FullName, HireDate, AdjustmentDays FROM Employees WHERE IsActive = 1').all();

console.log(`Checking ${employees.length} active employees:`);

const sqlQuery = `
WITH AggregatedLeaves AS (
  SELECT 
    l.EmployeeID,
    COALESCE(SUM(CASE WHEN lt.Name = 'إجازة بدون راتب' THEN l.DaysCount ELSE 0 END), 0) AS UnpaidDays,
    COALESCE(SUM(CASE WHEN lt.Name IN ('إجازة اعتيادية', 'سبب آخر') THEN l.DaysCount ELSE 0 END), 0) AS RegularLeavesTaken
  FROM Leaves l
  JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
  GROUP BY l.EmployeeID
),
EmployeeCalculations AS (
  SELECT
    e.EmployeeID,
    e.FullName,
    e.JobTitle,
    e.WorkLocation,
    e.LeaveCardNumber,
    e.HireDate,
    COALESCE(e.AdjustmentDays, 0) AS AdjustmentDays,
    COALESCE(al.UnpaidDays, 0) AS UnpaidDays,
    COALESCE(al.RegularLeavesTaken, 0) AS RegularLeavesTaken,
    CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) AS TotalDays,
    MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) AS NetServiceDays,
    (MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) AS GrossEarnedBalance,
    ((MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) + COALESCE(e.AdjustmentDays, 0) - COALESCE(al.RegularLeavesTaken, 0)) AS AvailableBalance,
    MIN(MAX(((MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) + COALESCE(e.AdjustmentDays, 0) - COALESCE(al.RegularLeavesTaken, 0)), 0), 180) AS FinalBalance
  FROM Employees e
  LEFT JOIN AggregatedLeaves al ON al.EmployeeID = e.EmployeeID
  WHERE e.IsActive = 1
)
SELECT * FROM EmployeeCalculations ORDER BY EmployeeID ASC;
`;

const sqlResults = db.prepare(sqlQuery).all();

let allMatch = true;
for (const emp of employees) {
  const jsResult = calculateRegularLeaveBalance(emp.EmployeeID, db);
  const sqlRes = sqlResults.find(r => r.EmployeeID === emp.EmployeeID);
  
  const match = (
    jsResult.totalDays === sqlRes.TotalDays &&
    jsResult.unpaidDays === sqlRes.UnpaidDays &&
    jsResult.netServiceDays === sqlRes.NetServiceDays &&
    jsResult.grossEarnedBalance === sqlRes.GrossEarnedBalance &&
    jsResult.regularLeavesTaken === sqlRes.RegularLeavesTaken &&
    jsResult.availableBalance === sqlRes.AvailableBalance &&
    jsResult.finalBalance === sqlRes.FinalBalance
  );
  
  console.log(`Emp ${emp.EmployeeID} (${emp.FullName}): Match = ${match}`);
  if (!match) {
    allMatch = false;
    console.log('JS:', jsResult);
    console.log('SQL:', sqlRes);
  }
}

console.log('All employees match 100%:', allMatch);
