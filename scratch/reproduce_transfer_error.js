'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Catch all uncaught exceptions
process.on('uncaughtException', (err) => {
  fs.writeFileSync(path.join(__dirname, 'reproduce_error.log'), 'UNCAUGHT EXCEPTION: ' + err.stack);
});
process.on('unhandledRejection', (err) => {
  fs.writeFileSync(path.join(__dirname, 'reproduce_error.log'), 'UNHANDLED REJECTION: ' + (err && err.stack ? err.stack : err));
});

// Set isolated user data dir inside workspace so sandbox allows it
const testUserDataDir = path.join(__dirname, 'temp_test_user_data');
if (fs.existsSync(testUserDataDir)) {
  fs.rmSync(testUserDataDir, { recursive: true, force: true });
}
fs.mkdirSync(testUserDataDir, { recursive: true });
app.setPath('userData', testUserDataDir);

const db = require('../src/main/database');
const { registerLeaveHandlers } = require('../src/main/ipc/leaveHandlers');
const { registerEmployeeHandlers } = require('../src/main/ipc/employeeHandlers');
const { registerReportHandlers } = require('../src/main/ipc/reportHandlers');
const { registerSystemHandlers } = require('../src/main/ipc/systemHandlers');
const { registerAuditHandlers } = require('../src/main/ipc/auditHandlers');
const { registerDocumentHandlers } = require('../src/main/ipc/documentHandlers');

function logStep(msg) {
  fs.appendFileSync(path.join(__dirname, 'reproduce_steps.log'), msg + '\n');
}

logStep('Script loaded');

app.whenReady().then(async () => {
  logStep('app.whenReady');
  try {
    db.initialize();
    logStep('db.initialize done');
    const liveDb = db.getDb();
    registerLeaveHandlers(ipcMain, liveDb);
    registerEmployeeHandlers(ipcMain, liveDb);
    registerReportHandlers(ipcMain, liveDb);
    registerSystemHandlers(ipcMain, liveDb);
    registerAuditHandlers(ipcMain, liveDb);
    registerDocumentHandlers(ipcMain, liveDb);
    logStep('handlers registered');

    ipcMain.handle('leaveTypes:getAll', () => {
      return { success: true, data: liveDb.prepare('SELECT * FROM LeaveTypes ORDER BY LeaveTypeID ASC').all() };
    });

    // Create an isolated dummy employee with ID 9999
    liveDb.prepare(`
      INSERT OR REPLACE INTO Employees (
        EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive
      ) VALUES (
        9999, 'موظف اختباري معزول (وهمي)', 'Male', '2023-01-01', 'مطور برمجيات', 'الفرع التجريبي', 'TEST-9999', 'المدير التجريبي', 1
      )
    `).run();

    logStep('Isolated employee created');

    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, '../src/main/preload.js')
      }
    });

    const consoleLogs = [];
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      consoleLogs.push({ level, message, line, sourceId });
      logStep(`[RENDERER CONSOLE level=${level}] ${message} (line ${line})`);
    });

    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    logStep('Window loaded HTML');
    await new Promise(r => setTimeout(r, 1500));

    // Execute reproduction in renderer
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const diagnostics = {
          errors: [],
          toasts: [],
          steps: []
        };

        // Listen for unhandled errors
        window.addEventListener('unhandledrejection', (e) => {
          diagnostics.errors.push({ type: 'unhandledrejection', reason: String(e.reason && e.reason.stack ? e.reason.stack : e.reason) });
        });
        window.addEventListener('error', (e) => {
          diagnostics.errors.push({ type: 'error', message: e.message, filename: e.filename, lineno: e.lineno });
        });

        // Track toasts
        const toastContainer = document.getElementById('toast-container');
        if (toastContainer) {
          const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
              for (const node of m.addedNodes) {
                if (node.nodeType === 1) {
                  diagnostics.toasts.push({
                    text: node.textContent.trim(),
                    className: node.className
                  });
                }
              }
            }
          });
          observer.observe(toastContainer, { childList: true, subtree: true });
        }

        // Step 1: Switch to manage employee tab
        diagnostics.steps.push('Switching to btn-tab-manage-employee');
        const tabBtn = document.getElementById('btn-tab-manage-employee');
        if (!tabBtn) return { error: 'btn-tab-manage-employee not found', diagnostics };
        tabBtn.click();
        await new Promise(r => setTimeout(r, 600));

        // Step 2: Load dummy employee 9999
        diagnostics.steps.push('Loading employee 9999 into manage form');
        const empIdInput = document.getElementById('manage-emp-id');
        const loadBtn = document.getElementById('btn-load-manage-emp');
        if (!empIdInput || !loadBtn) return { error: 'manage-emp-id or btn-load-manage-emp not found', diagnostics };
        empIdInput.value = '9999';
        loadBtn.click();
        await new Promise(r => setTimeout(r, 1000));

        // Step 3: Check transfer button
        const btnTransfer = document.getElementById('btn-transfer-emp');
        if (!btnTransfer) return { error: 'btn-transfer-emp not found', diagnostics };
        diagnostics.steps.push('Clicking btn-transfer-emp');
        btnTransfer.click();
        await new Promise(r => setTimeout(r, 500));

        // Step 4: Fill transfer dialog inputs
        const orderNumInput = document.getElementById('transfer-order-number');
        const orderDateInput = document.getElementById('transfer-order-date');
        const notesInput = document.getElementById('transfer-notes');
        const formTransfer = document.getElementById('form-transfer-employee');

        if (!orderNumInput || !orderDateInput || !formTransfer) {
          return { error: 'Transfer form inputs not found', diagnostics };
        }

        orderNumInput.value = '123456';
        orderDateInput.value = '2026-03-09';
        if (notesInput) notesInput.value = 'نقل تجريبي اختباري';

        diagnostics.steps.push('Submitting form-transfer-employee');
        
        // Also test direct call to window.api.employee.transfer to see raw rejection
        let directCallResult = null;
        try {
          directCallResult = await window.api.employee.transfer(9999, {
            transferOrderNumber: '123456',
            transferOrderDate: '2026-03-09',
            transferNotes: 'نقل تجريبي'
          });
        } catch (callErr) {
          directCallResult = { caughtException: callErr.message, stack: callErr.stack };
        }
        diagnostics.directCallResult = directCallResult;

        // Trigger the form submit button
        const submitBtn = formTransfer.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.click();
        } else {
          formTransfer.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 600));

        return {
          diagnostics
        };
      })()
    `);

    // Capture screenshot of UI
    const screenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'reproduce_screenshot.png'), screenshot.toPNG());

    logStep('[TEST RESULT] ' + JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(__dirname, 'reproduce_result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(__dirname, 'renderer_console.log'), JSON.stringify(consoleLogs, null, 2));

    // Clean up
    win.destroy();
    liveDb.close();
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch (_) {}

    app.quit();
  } catch (err) {
    logStep('[TEST FATAL ERROR] ' + err.stack);
    console.error('[TEST FATAL ERROR]', err);
    app.quit();
  }
});
