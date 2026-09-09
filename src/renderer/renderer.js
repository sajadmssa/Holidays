// ============================================================
//  renderer.js – Application Entry Point & Navigation Controller (ES Module)
//  Sandboxed Renderer process orchestrator.
// ============================================================

'use strict';

import { initEmployeePicker, selectEmployeeForPicker } from './modules/employeePicker.js';
import { initSearchModal } from './modules/searchModal.js';
import { initLeaveRegistration } from './modules/leaveRegistration.js';
import { initDashboardTab, loadActiveLeaves } from './modules/dashboardTab.js';
import { initAddEmployeeTab } from './modules/addEmployeeTab.js';
import { initManageEmployeeTab, loadEmployeeForManagement } from './modules/manageEmployeeTab.js';
import { initEmployeesTab, loadAllEmployees } from './modules/employeesTab.js';
import { initBalanceReportTab, loadBalanceAndAccumulationReport } from './modules/balanceReportTab.js';
import { initAuditLogTab, loadAuditLogs } from './modules/auditLogTab.js';
import { initSystemSettings } from './modules/systemSettings.js';
import { initThemeManager } from './modules/themeManager.js';
import { initEmployeeDocumentsModal } from './modules/employeeDocumentsModal.js';

// ──────────────────────────────────────────────────────────────
//  Tab Navigation & Dynamic View Titles
// ──────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  'tab-entry': 'تسجيل إجازة موظف',
  'tab-dashboard': 'الإجازات حالياً',
  'tab-all-employees': 'سجل كافة الموظفين ومعلومات إجازاتهم',
  'tab-add-employee': 'إضافة موظف جديد',
  'tab-manage-employee': 'إدارة وتعديل بيانات الموظفين',
  'tab-balance-report': 'تقارير الأرصدة الحرجة وتراكم الإجازات',
  'tab-audit-logs': 'سجل التدقيق ومراقبة حركات النظام'
};

export function switchTab(targetId) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-content');
  const viewTitleEl = document.getElementById('view-title');

  tabButtons.forEach((btn) => {
    const isTarget = btn.dataset.tab === targetId;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === targetId);
  });

  if (viewTitleEl && VIEW_TITLES[targetId]) {
    viewTitleEl.textContent = VIEW_TITLES[targetId];
  }

  if (targetId === 'tab-dashboard') {
    loadActiveLeaves();
  } else if (targetId === 'tab-all-employees') {
    loadAllEmployees(1);
  } else if (targetId === 'tab-balance-report') {
    loadBalanceAndAccumulationReport();
  } else if (targetId === 'tab-audit-logs') {
    loadAuditLogs(1);
  }
}

function handleManageEmployeeNavigation(employeeId) {
  switchTab('tab-manage-employee');
  loadEmployeeForManagement(employeeId);
}

// ──────────────────────────────────────────────────────────────
//  App Initialization
// ──────────────────────────────────────────────────────────────
function initApp() {
  // 0. Initialize Theme Manager
  initThemeManager();

  // 1. Initialize UI Modules with cross-module handlers
  initEmployeePicker();

  initSearchModal({
    onSelectForEntry: (emp) => {
      selectEmployeeForPicker(emp);
    },
    onSelectForManage: (employeeId) => {
      handleManageEmployeeNavigation(employeeId);
    }
  });

  initLeaveRegistration();

  initDashboardTab({
    onSwitchToDashboard: () => {
      switchTab('tab-dashboard');
    }
  });

  initAddEmployeeTab({
    onEmployeeAdded: () => {
      loadAllEmployees(1);
    }
  });

  initManageEmployeeTab({
    onEmployeeUpdated: () => {
      loadAllEmployees(1);
    }
  });

  initEmployeesTab({
    onManageEmployee: (employeeId) => {
      handleManageEmployeeNavigation(employeeId);
    }
  });

  initBalanceReportTab({
    onManageEmployee: (employeeId) => {
      handleManageEmployeeNavigation(employeeId);
    }
  });

  initAuditLogTab();
  initSystemSettings();

  initEmployeeDocumentsModal({
    onDocumentChanged: (empId) => {
      loadEmployeeForManagement(empId);
    }
  });

  // 2. Setup Sidebar Navigation Buttons
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
