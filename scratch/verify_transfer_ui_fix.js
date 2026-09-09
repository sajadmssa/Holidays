// ============================================================
//  scratch/verify_transfer_ui_fix.js
//  Full UI verification of external transfer and cancel flow
//  using an isolated dummy employee (ID 9999) in an isolated DB.
// ============================================================

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Set isolated user data directory inside workspace
const testUserDataDir = path.join(__dirname, 'temp_verify_user_data');
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

app.whenReady().then(async () => {
  try {
    db.initialize();
    const liveDb = db.getDb();
    registerLeaveHandlers(ipcMain, liveDb);
    registerEmployeeHandlers(ipcMain, liveDb);
    registerReportHandlers(ipcMain, liveDb);
    registerSystemHandlers(ipcMain, liveDb);
    registerAuditHandlers(ipcMain, liveDb);
    registerDocumentHandlers(ipcMain, liveDb);

    ipcMain.handle('leaveTypes:getAll', () => {
      return { success: true, data: liveDb.prepare('SELECT * FROM LeaveTypes ORDER BY LeaveTypeID ASC').all() };
    });

    // Create an isolated dummy employee with ID 9999
    liveDb.prepare(`
      INSERT OR REPLACE INTO Employees (
        EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive,
        IsTransferred, TransferOrderNumber, TransferOrderDate, TransferNotes
      ) VALUES (
        9999, 'موظف اختباري معزول (وهمي)', 'Male', '2023-01-01', 'مطور برمجيات', 'الفرع التجريبي', 'TEST-9999', 'المدير التجريبي', 1,
        0, NULL, NULL, NULL
      )
    `).run();

    console.log('[TEST] Isolated employee 9999 created.');

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
    });

    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await new Promise(r => setTimeout(r, 1200));

    // Execute full UI transfer test
    const testResult = await win.webContents.executeJavaScript(`
      (async () => {
        const results = {
          steps: [],
          toasts: [],
          errors: []
        };

        // Track toasts
        const toastContainer = document.getElementById('toast-container');
        if (toastContainer) {
          const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
              for (const node of m.addedNodes) {
                if (node.nodeType === 1) {
                  results.toasts.push({
                    text: node.textContent.trim(),
                    className: node.className
                  });
                }
              }
            }
          });
          observer.observe(toastContainer, { childList: true, subtree: true });
        }

        // 1. Switch to manage employee tab
        results.steps.push('1. Switch to btn-tab-manage-employee');
        const tabBtn = document.getElementById('btn-tab-manage-employee');
        tabBtn.click();
        await new Promise(r => setTimeout(r, 500));

        // 2. Load employee 9999
        results.steps.push('2. Load employee 9999');
        const empIdInput = document.getElementById('manage-emp-id');
        const loadBtn = document.getElementById('btn-load-manage-emp');
        empIdInput.value = '9999';
        loadBtn.click();
        await new Promise(r => setTimeout(r, 800));

        const initialBanner = document.getElementById('manage-emp-transferred-banner');
        results.initialBannerHidden = initialBanner ? initialBanner.classList.contains('hidden') : null;

        // 3. Click #btn-transfer-emp
        results.steps.push('3. Click btn-transfer-emp to open modal');
        const btnTransfer = document.getElementById('btn-transfer-emp');
        btnTransfer.click();
        await new Promise(r => setTimeout(r, 400));

        const modal = document.getElementById('transfer-employee-modal');
        results.modalOpened = modal ? modal.open : false;

        // 4. Fill form
        results.steps.push('4. Fill transfer modal form');
        const orderNumInput = document.getElementById('transfer-order-number');
        const orderDateInput = document.getElementById('transfer-order-date');
        const notesInput = document.getElementById('transfer-notes');
        const formTransfer = document.getElementById('form-transfer-employee');

        orderNumInput.value = '554433';
        orderDateInput.value = '2026-03-09';
        notesInput.value = 'نقل تجريبي اختباري ناجح';

        // 5. Submit form via UI
        results.steps.push('5. Submit form-transfer-employee');
        const saveBtn = document.getElementById('btn-save-transfer');
        saveBtn.click();
        await new Promise(r => setTimeout(r, 1200));

        // 6. Inspect UI state after save
        results.modalClosedAfterSave = modal ? !modal.open : false;
        const bannerAfterSave = document.getElementById('manage-emp-transferred-banner');
        const bannerDetails = document.getElementById('manage-emp-transferred-details');
        const btnAfterSave = document.getElementById('btn-transfer-emp');

        results.bannerVisible = bannerAfterSave ? !bannerAfterSave.classList.contains('hidden') : false;
        results.bannerDetailsText = bannerDetails ? bannerDetails.textContent.trim() : null;
        results.btnHasActiveClass = btnAfterSave ? btnAfterSave.classList.contains('is-transferred-active') : false;
        results.btnText = btnAfterSave ? btnAfterSave.textContent.trim() : null;

        return results;
      })()
    `);

    // Capture screenshot of successful transfer card
    const screenshot1 = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'screenshot_transfer_success.png'), screenshot1.toPNG());

    // Copy to artifacts
    const artifactPath = path.resolve('C:\\Users\\3D\\.gemini\\antigravity-ide\\brain\\7f5816a6-82bc-4934-85c5-95f73dd3fc6f\\screenshot_transfer_success.png');
    fs.writeFileSync(artifactPath, screenshot1.toPNG());

    // Also check the database record
    const empInDb = liveDb.prepare('SELECT EmployeeID, FullName, IsTransferred, TransferOrderNumber, TransferOrderDate, TransferNotes FROM Employees WHERE EmployeeID = 9999').get();

    // Now test Cancel Transfer flow in UI!
    const cancelResult = await win.webContents.executeJavaScript(`
      (async () => {
        const cancelDiags = {
          steps: [],
          toasts: []
        };

        const btnTransfer = document.getElementById('btn-transfer-emp');
        btnTransfer.click();
        await new Promise(r => setTimeout(r, 400));

        const btnCancelStatus = document.getElementById('btn-cancel-transfer-status');
        if (!btnCancelStatus) return { error: 'btn-cancel-transfer-status not found' };

        cancelDiags.btnCancelStatusVisible = !btnCancelStatus.classList.contains('hidden');
        btnCancelStatus.click();
        
        // Wait for custom confirm modal to open, then click btn-confirm-yes
        await new Promise(r => setTimeout(r, 300));
        const btnConfirmYes = document.getElementById('btn-confirm-yes');
        if (btnConfirmYes) {
          btnConfirmYes.click();
        }

        await new Promise(r => setTimeout(r, 1200));

        const bannerAfterCancel = document.getElementById('manage-emp-transferred-banner');
        const btnAfterCancel = document.getElementById('btn-transfer-emp');
        cancelDiags.bannerHiddenAfterCancel = bannerAfterCancel ? bannerAfterCancel.classList.contains('hidden') : false;
        cancelDiags.btnHasActiveAfterCancel = btnAfterCancel ? btnAfterCancel.classList.contains('is-transferred-active') : true;
        cancelDiags.btnTextAfterCancel = btnAfterCancel ? btnAfterCancel.textContent.trim() : null;

        return cancelDiags;
      })()
    `);

    // Capture screenshot after cancel
    const screenshot2 = await win.webContents.capturePage();
    const artifactPathCancel = path.resolve('C:\\Users\\3D\\.gemini\\antigravity-ide\\brain\\7f5816a6-82bc-4934-85c5-95f73dd3fc6f\\screenshot_transfer_cancelled.png');
    fs.writeFileSync(artifactPathCancel, screenshot2.toPNG());

    const empInDbAfterCancel = liveDb.prepare('SELECT EmployeeID, FullName, IsTransferred, TransferOrderNumber, TransferOrderDate, TransferNotes FROM Employees WHERE EmployeeID = 9999').get();

    const finalOutput = {
      testResult,
      empInDb,
      cancelResult,
      empInDbAfterCancel,
      consoleLogs: consoleLogs.filter(l => l.level >= 2) // warnings & errors
    };

    fs.writeFileSync(path.join(__dirname, 'verify_ui_fix_result.json'), JSON.stringify(finalOutput, null, 2));
    console.log('[VERIFY UI FIX RESULT]', JSON.stringify(finalOutput, null, 2));

    win.destroy();
    liveDb.close();
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch (_) {}

    app.quit();
  } catch (err) {
    console.error('[FATAL ERROR]', err);
    app.quit();
  }
});
