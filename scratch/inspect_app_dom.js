// ============================================================
//  scratch/inspect_app_dom.js
//  Automated DOM inspection & visual verification of Holidays App
// ============================================================

'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const db = require('../src/main/database');
const { registerLeaveHandlers } = require('../src/main/ipc/leaveHandlers');
const { registerEmployeeHandlers } = require('../src/main/ipc/employeeHandlers');
const { registerReportHandlers } = require('../src/main/ipc/reportHandlers');
const { registerSystemHandlers } = require('../src/main/ipc/systemHandlers');
const { registerAuditHandlers } = require('../src/main/ipc/auditHandlers');
const { registerDocumentHandlers } = require('../src/main/ipc/documentHandlers');

app.whenReady().then(async () => {
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

  const validEmp = liveDb.prepare('SELECT EmployeeID, FullName FROM Employees LIMIT 1').get();
  console.log('Using valid employee from DB:', validEmp);
  const targetId = validEmp ? validEmp.EmployeeID : 1;
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

  const consoleMessages = [];
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    consoleMessages.push({ level, message, line, sourceId });
  });

  // Intercept uncaught exceptions in page
  win.webContents.on('crashed', (e) => console.log('CRASHED', e));

  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  // Wait 1.5s for initial render and module loading
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n=== 1. CONSOLE ERRORS & MESSAGES ON LOAD ===');
  consoleMessages.forEach(m => console.log(`[Line ${m.line}] [Source: ${path.basename(m.sourceId || '')}] ${m.message}`));

  console.log('\n=== 2. DOM INSPECTION OF #btn-transfer-emp (Initial State) ===');
  const initialInspection = await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.getElementById('btn-transfer-emp');
      const form = document.getElementById('form-manage-employee');
      const banner = document.getElementById('manage-emp-transferred-banner');
      const modal = document.getElementById('transfer-employee-modal');
      return {
        btnExists: !!btn,
        btnOuterHTML: btn ? btn.outerHTML : null,
        btnComputedDisplay: btn ? window.getComputedStyle(btn).display : null,
        btnComputedVisibility: btn ? window.getComputedStyle(btn).visibility : null,
        formExists: !!form,
        formHasHiddenClass: form ? form.classList.contains('hidden') : null,
        bannerExists: !!banner,
        modalExists: !!modal
      };
    })()
  `);
  console.log(JSON.stringify(initialInspection, null, 2));

  console.log('\n=== 3. SWITCH TO TAB 4 AND LOAD EMPLOYEE ===');
  // Switch to Tab 4
  const tabSwitchResult = await win.webContents.executeJavaScript(`
    (() => {
      // Find tab button for Tab 4
      const tabBtn = document.getElementById('btn-tab-manage-employee');
      if (tabBtn) tabBtn.click();
      
      const tabContent = document.getElementById('tab-manage-employee');
      return {
        tabBtnFound: !!tabBtn,
        tabContentActive: tabContent ? tabContent.classList.contains('active') : false
      };
    })()
  `);
  console.log('Tab switch result:', tabSwitchResult);

  // Now simulate entering employee ID and clicking load
  const loadEmpResult = await win.webContents.executeJavaScript(`
    (async () => {
      const empIdInput = document.getElementById('manage-emp-id');
      const loadBtn = document.getElementById('btn-load-manage-emp');
      if (!empIdInput || !loadBtn) return { error: 'Inputs not found' };
      
      empIdInput.value = '${targetId}';
      loadBtn.click();
      
      // Wait 1 second for IPC response
      await new Promise(r => setTimeout(r, 1000));
      
      const btn = document.getElementById('btn-transfer-emp');
      const form = document.getElementById('form-manage-employee');
      const rect = btn ? btn.getBoundingClientRect() : null;
      const computed = btn ? window.getComputedStyle(btn) : null;
      
      return {
        empLoadedName: document.getElementById('manage-full-name')?.value,
        formHidden: form?.classList.contains('hidden'),
        btnExists: !!btn,
        btnText: btn?.textContent?.trim(),
        btnDisplay: computed?.display,
        btnVisibility: computed?.visibility,
        btnRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        btnClasses: btn?.className,
        parentDisplay: btn?.parentElement ? window.getComputedStyle(btn.parentElement).display : null
      };
    })()
  `);
  console.log('Load Employee Result in UI:', JSON.stringify(loadEmpResult, null, 2));

  await win.webContents.executeJavaScript(`
    const btn = document.getElementById('btn-transfer-emp');
    if (btn) btn.scrollIntoView({ behavior: 'instant', block: 'center' });
  `);
  await new Promise(r => setTimeout(r, 500));

  // Capture screenshot of the window with the button visible
  const image = await win.capturePage();
  const screenshotPath = path.resolve(__dirname, 'screenshot_manage_emp.png');
  fs.writeFileSync(screenshotPath, image.toPNG());
  console.log(`\n📸 Screenshot saved to: ${screenshotPath}`);

  // Test opening the transfer modal by clicking the button
  console.log('\n=== 4. CLICK #btn-transfer-emp AND VERIFY MODAL ===');
  const modalTestResult = await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.getElementById('btn-transfer-emp');
      const modal = document.getElementById('transfer-employee-modal');
      if (!btn || !modal) return { error: 'Elements not found' };
      
      btn.click();
      
      return {
        modalOpen: modal.open,
        modalDisplay: window.getComputedStyle(modal).display,
        empNameInModal: document.getElementById('transfer-modal-emp-name')?.textContent,
        orderNumInput: document.getElementById('transfer-order-number')?.value
      };
    })()
  `);
  console.log('Modal Test Result:', JSON.stringify(modalTestResult, null, 2));

  // Capture screenshot of the modal dialog
  await new Promise(r => setTimeout(r, 400));
  const modalImage = await win.capturePage();
  const modalScreenshotPath = path.resolve(__dirname, 'screenshot_transfer_modal.png');
  fs.writeFileSync(modalScreenshotPath, modalImage.toPNG());
  console.log(`📸 Modal Screenshot saved to: ${modalScreenshotPath}`);

  app.quit();
});
