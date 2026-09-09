const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Create in-memory database for clean, isolated benchmarking
const db = new Database(':memory:');

// Apply migrations
const migrationsDir = path.join(__dirname, '../src/main/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  try {
    db.exec(sql);
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      throw err;
    }
  }
}

console.log('Seeding 5,000 employees and 15,000 leave records...');
const insertEmp = db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive, AdjustmentDays)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
`);

const insertLeave = db.prepare(`
  INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover, OrderRef)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const seedStart = Date.now();
db.transaction(() => {
  for (let i = 1; i <= 5000; i++) {
    const year = 2015 + (i % 9);
    const month = String(1 + (i % 12)).padStart(2, '0');
    const day = String(1 + (i % 28)).padStart(2, '0');
    const hireDate = `${year}-${month}-${day}`;
    const adj = (i % 10 === 0) ? -20 : ((i % 15 === 0) ? 15 : 0);
    
    insertEmp.run(
      i,
      `موظف تجريبي ${i}`,
      i % 2 === 0 ? 'Male' : 'Female',
      hireDate,
      `عنوان وظيفي ${i % 20}`,
      `موقع عمل ${i % 10}`,
      `CARD-${i}`,
      'المدير العام',
      adj
    );
  }

  const regTypeId = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة اعتيادية'").get().LeaveTypeID;
  const unpaidTypeId = db.prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة بدون راتب'").get().LeaveTypeID;

  // Seed leaves: 3 leaves per employee (some regular, some unpaid)
  for (let i = 1; i <= 5000; i++) {
    // 1 regular leave
    insertLeave.run(i, regTypeId, '2024-03-01', '2024-03-10', 10, 'المدير العام', 'ORDER-REG');
    // 1 unpaid leave for some
    if (i % 3 === 0) {
      insertLeave.run(i, unpaidTypeId, '2024-05-01', '2024-05-30', 30, 'المدير العام', 'ORDER-UNPAID-123');
    }
    // 1 recent regular leave
    if (i % 2 === 0) {
      insertLeave.run(i, regTypeId, '2025-01-05', '2025-01-14', 10, 'المدير العام', 'ORDER-REG-2');
    }
  }
})();

console.log(`Seeding complete in ${Date.now() - seedStart}ms.`);

const { calculateRegularLeaveBalance } = require('../src/main/services/LeaveService');

// ─── BENCHMARK 1: OLD METHOD (N+1 JS LOOP) ───
console.log('\n--- Running Benchmark 1: Old Method (N+1 Loop) ---');
const t1Start = Date.now();
const activeEmployees = db.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, HireDate FROM Employees WHERE IsActive = 1 ORDER BY FullName ASC').all();

const oldCriticalList = [];
for (const emp of activeEmployees) {
  const balanceData = calculateRegularLeaveBalance(emp.EmployeeID, db);
  if (balanceData.finalBalance <= 50) {
    oldCriticalList.push({
      EmployeeID: emp.EmployeeID,
      FullName: emp.FullName,
      FinalBalance: balanceData.finalBalance
    });
  }
}
const t1Elapsed = Date.now() - t1Start;
const oldQueryCount = 1 + (5000 * 6);
console.log(`Old Method Elapsed: ${t1Elapsed}ms`);
console.log(`Old Method Total SQL Queries Executed: ${oldQueryCount}`);
console.log(`Old Method Critical Found (threshold <= 50): ${oldCriticalList.length}`);

// ─── BENCHMARK 2: NEW METHOD (SINGLE VECTORIZED SQL QUERY) ───
console.log('\n--- Running Benchmark 2: New Method (Single Vectorized Query) ---');
const t2Start = Date.now();

const sqlCriticalQuery = `
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
SELECT 
  EmployeeID,
  FullName,
  JobTitle,
  WorkLocation,
  LeaveCardNumber,
  HireDate,
  FinalBalance,
  FinalBalance AS RemainingBalance,
  RegularLeavesTaken,
  GrossEarnedBalance,
  NetServiceDays
FROM EmployeeCalculations
WHERE FinalBalance <= ?
ORDER BY FinalBalance ASC, FullName ASC
LIMIT ? OFFSET ?;
`;

const newResults = db.prepare(sqlCriticalQuery).all(50, 15, 0);
const newCountRow = db.prepare(`
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
    MIN(MAX(((MAX(0, CAST(ROUND(julianday(date('now', 'localtime')) - julianday(e.HireDate)) AS INTEGER) - COALESCE(al.UnpaidDays, 0)) / 10) + COALESCE(e.AdjustmentDays, 0) - COALESCE(al.RegularLeavesTaken, 0)), 0), 180) AS FinalBalance
  FROM Employees e
  LEFT JOIN AggregatedLeaves al ON al.EmployeeID = e.EmployeeID
  WHERE e.IsActive = 1
)
SELECT COUNT(*) as total FROM EmployeeCalculations WHERE FinalBalance <= ?;
`).get(50);

const t2Elapsed = Date.now() - t2Start;
const newQueryCount = 2; // 1 count query + 1 paginated data query

console.log(`New Method Elapsed: ${t2Elapsed}ms`);
console.log(`New Method Total SQL Queries Executed: ${newQueryCount}`);
console.log(`New Method Total Critical Count (threshold <= 50): ${newCountRow.total}`);
console.log(`Counts match perfectly: ${oldCriticalList.length === newCountRow.total}`);
console.log(`Speedup Factor: ${(t1Elapsed / t2Elapsed).toFixed(1)}x faster!`);
console.log(`Query Count Reduction: from ${oldQueryCount} down to ${newQueryCount} queries (${((1 - (newQueryCount / oldQueryCount)) * 100).toFixed(2)}% reduction)!`);

