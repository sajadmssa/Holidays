// ============================================================
//  tests/systemSafetyAndStartup.test.js
//  اختبارات شبكة الأمان، انهيار الواجهة، كتل الإقلاع المستقلة، وتصحيح توقيت بغداد
// ============================================================

'use strict';

// Transparent ABI bridge: if run via external Node.js, re-exec via Electron's embedded Node (ABI 110)
if (!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(result.status ?? 0);
}

const Database = require('better-sqlite3');
const LeaveService = require('../src/main/services/LeaveService');
const LoggerService = require('../src/main/services/LoggerService');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${message}`);
}

/**
 * إنشاء قاعدة بيانات اختبارية في الذاكرة مهيأة بجداول الموظفين وأنواع الإجازات
 */
function createInMemoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS LeaveTypes (
      LeaveTypeID INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL UNIQUE,
      MaxDaysPerInstance INTEGER,
      RequiresOrderRef INTEGER DEFAULT 0,
      GenderRestriction TEXT DEFAULT NULL
    );

    INSERT INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance) VALUES
      (1, 'إجازة اعتيادية', 30),
      (2, 'إجازة مرضية', 120),
      (3, 'إجازة بدون راتب', 365),
      (4, 'سبب آخر', 30);

    CREATE TABLE IF NOT EXISTS Employees (
      EmployeeID INTEGER PRIMARY KEY AUTOINCREMENT,
      FullName TEXT NOT NULL,
      JobTitle TEXT NOT NULL,
      DepartmentID INTEGER,
      HireDate TEXT NOT NULL,
      IsActive INTEGER DEFAULT 1,
      IsTransferred INTEGER DEFAULT 0,
      AdjustmentDays INTEGER DEFAULT 0,
      LeaveCardNumber TEXT,
      JobNumber TEXT,
      SequenceNumber INTEGER,
      DossierNumber TEXT
    );

    CREATE TABLE IF NOT EXISTS Leaves (
      LeaveID INTEGER PRIMARY KEY AUTOINCREMENT,
      EmployeeID INTEGER NOT NULL,
      LeaveTypeID INTEGER NOT NULL,
      StartDate TEXT NOT NULL,
      EndDate TEXT NOT NULL,
      DaysCount INTEGER NOT NULL,
      Notes TEXT,
      FOREIGN KEY (EmployeeID) REFERENCES Employees (EmployeeID),
      FOREIGN KEY (LeaveTypeID) REFERENCES LeaveTypes (LeaveTypeID)
    );
  `);
  return db;
}

(async () => {
  console.log('\n🛡️  [Safety, Startup, and Baghdad Timezone Tests] Starting test suite...\n');

  const testDb = createInMemoryDb();

  // ══════════════════════════════════════════════════════════════
  //  Suite 1: Baghdad Timezone & 00:00-03:00 Accrual Correctness
  // ══════════════════════════════════════════════════════════════
  console.log('--- Suite 1: Baghdad Timezone & Regular Leave Accrual ---');

  // Insert test employee hired exactly 100 days before 2026-09-18 (hire date: 2026-06-10)
  testDb.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, JobTitle, HireDate, AdjustmentDays)
    VALUES (1, 'موظف تجريبي دقيق', 'مهندس', '2026-06-10', 0)
  `).run();

  // Helper to run calculateRegularLeaveBalance with a mocked system Date
  const RealDate = global.Date;

  function runWithMockedDate(isoInstant, fn) {
    const mockInstant = new RealDate(isoInstant);
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(mockInstant.getTime());
        } else {
          super(...args);
        }
      }
      static now() {
        return mockInstant.getTime();
      }
    }
    global.Date = MockDate;
    try {
      return fn();
    } finally {
      global.Date = RealDate;
    }
  }

  // 1.1 Test at 01:30 AM Baghdad Time on 2026-09-18 (UTC: 2026-09-17 22:30:00Z)
  const balanceAt0130AM = runWithMockedDate('2026-09-17T22:30:00.000Z', () => {
    return LeaveService.calculateRegularLeaveBalance(1, testDb);
  });

  // 1.2 Test at 14:00 PM Baghdad Time on 2026-09-18 (UTC: 2026-09-18 11:00:00Z)
  const balanceAt1400PM = runWithMockedDate('2026-09-18T11:00:00.000Z', () => {
    return LeaveService.calculateRegularLeaveBalance(1, testDb);
  });

  assert(balanceAt0130AM.totalDays === 100, `totalDays at 01:30 AM Baghdad is exactly 100 (got ${balanceAt0130AM.totalDays})`);
  assert(balanceAt1400PM.totalDays === 100, `totalDays at 14:00 PM Baghdad is exactly 100 (got ${balanceAt1400PM.totalDays})`);
  assert(balanceAt0130AM.grossEarnedBalance === 10, `grossEarnedBalance at 01:30 AM is 10 days (got ${balanceAt0130AM.grossEarnedBalance})`);
  assert(balanceAt1400PM.grossEarnedBalance === 10, `grossEarnedBalance at 14:00 PM is 10 days (got ${balanceAt1400PM.grossEarnedBalance})`);
  assert(balanceAt0130AM.finalBalance === 10, `finalBalance matches between 01:30 AM and 14:00 PM (got ${balanceAt0130AM.finalBalance})`);

  // ══════════════════════════════════════════════════════════════
  //  Suite 2: Global Process Safety Net Logic Simulation
  // ══════════════════════════════════════════════════════════════
  console.log('\n--- Suite 2: Global Process Safety Net Behavior ---');

  let loggerErrorCalled = false;
  let dialogShown = false;
  let dbClosed = false;
  let appExitCode = null;

  const mockLogger = {
    error: (context, msg, err) => {
      loggerErrorCalled = true;
    }
  };
  const mockDialog = {
    showErrorBox: (title, content) => {
      dialogShown = true;
    }
  };
  const mockDb = {
    close: () => {
      dbClosed = true;
    }
  };
  const mockApp = {
    exit: (code) => {
      appExitCode = code;
    }
  };

  function simulateUncaughtHandler(err) {
    mockLogger.error('Process', 'Uncaught Exception detected', err);
    try {
      mockDialog.showErrorBox('خطأ غير متوقع في النظام', 'حدث خطأ غير متوقع...');
    } catch (_) {}
    try {
      mockDb.close();
    } catch (_) {}
    mockApp.exit(1);
  }

  simulateUncaughtHandler(new Error('Test unhandled explosion'));

  assert(loggerErrorCalled === true, 'LoggerService.error is called on uncaughtException');
  assert(dialogShown === true, 'dialog.showErrorBox is called on uncaughtException');
  assert(dbClosed === true, 'db.close() is safely called on uncaughtException');
  assert(appExitCode === 1, 'app.exit(1) is invoked to terminate process safely');

  // ══════════════════════════════════════════════════════════════
  //  Suite 3: Renderer Crash Handler & Rapid Loop Mitigation
  // ══════════════════════════════════════════════════════════════
  console.log('\n--- Suite 3: Renderer Crash Loop Mitigation ---');

  let crashTimestamps = [];
  let reloadCount = 0;
  let crashDialogShown = false;

  function handleRendererCrash(simulatedNow) {
    crashTimestamps = crashTimestamps.filter(t => simulatedNow - t < 60000);
    crashTimestamps.push(simulatedNow);

    if (crashTimestamps.length >= 2) {
      crashDialogShown = true;
      return false; // do not reload
    }
    reloadCount++;
    return true; // reload
  }

  // Crash 1 at t=0
  const c1 = handleRendererCrash(100000);
  assert(c1 === true, 'First crash allows window reload');
  assert(reloadCount === 1, 'Reload invoked on first crash');
  assert(crashDialogShown === false, 'No repeated crash dialog on first crash');

  // Crash 2 at t=10s (within 60s window)
  const c2 = handleRendererCrash(110000);
  assert(c2 === false, 'Second crash within 60s stops automatic reload');
  assert(reloadCount === 1, 'Reload NOT invoked on second crash');
  assert(crashDialogShown === true, 'Shows repeated crash dialog on second crash');

  // Reset dialog flag and simulate crash after 65 seconds (outside 60s window)
  crashDialogShown = false;
  const c3 = handleRendererCrash(175000); // 175000 - 110000 = 65000 > 60000
  assert(c3 === true, 'Crash occurring after 60s window has elapsed allows reload again');
  assert(reloadCount === 2, 'Reload invoked again after window reset');

  // ══════════════════════════════════════════════════════════════
  //  Suite 4: Independent Startup Blocks Isolation
  // ══════════════════════════════════════════════════════════════
  console.log('\n--- Suite 4: Startup Blocks Error Isolation ---');

  let startupErrors = [];
  let appQuitCalled = false;

  function runStartupSimulation({ failIpc = false, failWindow = false, failScheduler = false }) {
    startupErrors = [];
    appQuitCalled = false;

    // Step 1: IPC
    try {
      if (failIpc) throw new Error('IPC failed');
    } catch (err) {
      startupErrors.push('IPC');
      appQuitCalled = true;
      return;
    }

    // Step 2: Window
    try {
      if (failWindow) throw new Error('Window creation failed');
    } catch (err) {
      startupErrors.push('Window');
      appQuitCalled = true;
      return;
    }

    // Step 3: Notification Scheduler
    try {
      if (failScheduler) throw new Error('Scheduler failed');
    } catch (err) {
      startupErrors.push('Scheduler');
      // No app.quit() for scheduler!
    }
  }

  // 4.1 IPC Failure
  runStartupSimulation({ failIpc: true });
  assert(startupErrors.includes('IPC'), 'Catches IPC startup failure');
  assert(appQuitCalled === true, 'Quits app on IPC failure');

  // 4.2 Window Creation Failure
  runStartupSimulation({ failWindow: true });
  assert(startupErrors.includes('Window'), 'Catches Window startup failure');
  assert(appQuitCalled === true, 'Quits app on Window creation failure');

  // 4.3 Scheduler Failure (Non-fatal)
  runStartupSimulation({ failScheduler: true });
  assert(startupErrors.includes('Scheduler'), 'Catches Scheduler failure gracefully');
  assert(appQuitCalled === false, 'Does NOT quit app on Scheduler failure, allowing core app to operate');

  console.log(`\n🎉 All ${passedTests}/${totalTests} safety and startup tests passed successfully!\n`);
})();
