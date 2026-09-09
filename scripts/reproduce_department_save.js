const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const logFile = path.join(__dirname, 'analysis_out', 'reproduce_output.txt');
const dir = path.dirname(logFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function log(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}

fs.writeFileSync(logFile, '=== STARTING REPRODUCTION TEST ===\n', 'utf8');

const db = require('../src/main/database');
const { registerSystemHandlers } = require('../src/main/ipc/systemHandlers');

app.whenReady().then(async () => {
  try {
    log('--- INITIALIZING DB ---');
    db.initialize();

    log('--- REGISTERING SYSTEM HANDLERS ---');
    registerSystemHandlers(ipcMain);

    const rawDb = db.getDb();
    
    // Check current state of _AppSettings
    const currentRows = rawDb.prepare('SELECT * FROM _AppSettings').all();
    log('Current _AppSettings:', currentRows);

    // Mock electron ipcRenderer invoke:
    log('\n--- TEST 1: Payload as object { key, value } ---');
    // Note: ipcMain.handle stores handlers in internal map
    // Let's invoke systemHandlers functions or test the logic directly
    const handlers = ipcMain._invokeHandlers;
    log('Registered invokeHandlers count:', handlers ? handlers.size : 0);

    if (handlers && handlers.has('system:setSetting')) {
      const fn = handlers.get('system:setSetting');
      const res1 = await fn({}, { key: 'department_name', value: 'دائرة توزيع كهرباء الجنوب' });
      log('Result 1 ({key, value}):', res1);

      log('\n--- TEST 2: If payload passed as key, value directly ---');
      const res2 = await fn({}, 'department_name', 'دائرة توزيع كهرباء الجنوب');
      log('Result 2 (direct args):', res2);

      log('\n--- TEST 3: Empty string value ---');
      const res3 = await fn({}, { key: 'department_name', value: '' });
      log('Result 3 (empty val):', res3);
    }

    if (handlers && handlers.has('system:getSetting')) {
      const getFn = handlers.get('system:getSetting');
      const res4 = await getFn({}, 'department_name');
      log('Result 4 (getSetting):', res4);
    }

    // Clean up
    rawDb.prepare("DELETE FROM _AppSettings WHERE Key = 'department_name'").run();
    log('Cleaned up. Finished successfully.');
    app.quit();
  } catch (err) {
    log('Fatal error:', err.stack || err.message);
    app.quit();
  }
});
