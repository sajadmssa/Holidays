const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const liveDbPath = path.join(process.env.APPDATA || '.', 'leave-management-system', 'leave_management.db');
console.log('Checking live database at:', liveDbPath);

if (!fs.existsSync(liveDbPath)) {
  console.log('Live DB path does not exist directly. Skipping live DB read.');
  process.exit(0);
}

try {
  const db = new Database(liveDbPath, { readonly: true });
  const emps = db.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, IsActive FROM Employees').all();
  console.log(`\nFound ${emps.length} employees in live database:`);
  emps.forEach(e => {
    console.log(`  [ID: ${e.EmployeeID}] ${e.FullName} | ${e.JobTitle} | Card: ${e.LeaveCardNumber || 'None'} | Active: ${e.IsActive}`);
  });

  const ReportService = require('../src/main/services/ReportService');
  const crit = ReportService.getCriticalAndAccumulatedLeaves(db, { threshold: 30, year: 2026 });
  console.log('\nCritical & Accumulation Report Calculation on Live DB:');
  console.log('  KPIs:', crit.kpis);
  console.log(`  Critical Employees (<= 30d): ${crit.criticalEmployees.length}`);
  crit.criticalEmployees.forEach(e => {
    console.log(`    - ${e.FullName}: RemainingBalance = ${e.RemainingBalance} days`);
  });
  console.log(`  Accumulated Leaves count: ${crit.accumulatedLeaves.length}`);
  crit.accumulatedLeaves.forEach(e => {
    console.log(`    - ${e.FullName}: TotalConsumed = ${e.TotalConsumedDays} days (${e.RegularDays} regular, ${e.SickDays} sick, ${e.OtherDays} other)`);
  });

  const AuditService = require('../src/main/services/AuditService');
  const audit = AuditService.getAuditLogs(db, { page: 1, pageSize: 5 });
  console.log(`\nAudit Logs in Live DB (Total: ${audit.totalCount}):`);
  audit.data.forEach(log => {
    console.log(`  #${log.LogID} [${log.ActionType}] ${log.EntityType} | ${log.Details || '-'}`);
  });

  console.log('\nAll Live DB queries completed successfully!');
} catch (err) {
  console.log('Live DB check output:', err.message);
}
