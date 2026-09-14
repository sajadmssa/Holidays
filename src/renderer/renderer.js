// ============================================================
//  renderer.js – Application Entry Point & Navigation Controller (ES Module)
//  نقطة الدخول الرئيسية وموجه التنقل في واجهة المستخدم (Renderer Process)
//
//  المسؤوليات الرئيسية:
//    • تهيئة كافة موديولات الواجهة (التبويبات، النوافذ المنبثقة، الثيم، إدارة الوثائق).
//    • إدارة التنقل بين التبويبات وتحديث عناوين الشاشات بشكل تفاعلي.
//    • ربط الأحداث المشتركة بين الموديولات (Cross-Module Event Callbacks).
//    • تشغيل الاستعلامات التلقائية عند التبديل إلى أي تبويب (مثل تحديث لوحة التحكم أو تقرير الأرصدة).
// ============================================================

'use strict';

import { initEmployeePicker, selectEmployeeForPicker } from './modules/employeePicker.js';
import { initSearchModal } from './modules/searchModal.js';
import { initLeaveRegistration } from './modules/leaveRegistration.js';
import { initDashboardTab, loadActiveLeaves } from './modules/dashboardTab.js';
import { initAddEmployeeTab, populateAddEmployeeDepartments } from './modules/addEmployeeTab.js';
import { initManageEmployeeTab, loadEmployeeForManagement, populateManageDepartments } from './modules/manageEmployeeTab.js';
import { initEmployeesTab, loadAllEmployees } from './modules/employeesTab.js';
import { initBalanceReportTab, loadBalanceAndAccumulationReport } from './modules/balanceReportTab.js';
import { initAuditLogTab, loadAuditLogs } from './modules/auditLogTab.js';
import { initSystemSettings, onDepartmentsChanged } from './modules/systemSettings.js';
import { initThemeManager } from './modules/themeManager.js';
import { initEmployeeDocumentsModal } from './modules/employeeDocumentsModal.js';

// ──────────────────────────────────────────────────────────────
//  Tab Navigation & Dynamic View Titles
//  إدارة التنقل بين التبويبات وعناوين الواجهة الديناميكية
// ──────────────────────────────────────────────────────────────

// خريطة العناوين الرسمية لكل تبويب في الشريط العلوي
const VIEW_TITLES = {
  'tab-entry': 'تسجيل إجازة موظف',
  'tab-dashboard': 'الإجازات حالياً',
  'tab-all-employees': 'سجل كافة الموظفين ومعلومات إجازاتهم',
  'tab-add-employee': 'إضافة موظف جديد',
  'tab-manage-employee': 'إدارة وتعديل بيانات الموظفين',
  'tab-balance-report': 'تقارير الأرصدة الحرجة وتراكم الإجازات',
  'tab-audit-logs': 'سجل التدقيق ومراقبة حركات النظام'
};

/**
 * التبديل بين التبويبات الرئيسية في الواجهة وتحديث المحتوى وعنوان الشاشة
 * @param {string} targetId معرّف التبويب المستهدف (مثل 'tab-dashboard')
 */
export function switchTab(targetId) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-content');
  const viewTitleEl = document.getElementById('view-title');

  // تحديث حالة أزرار القائمة الجانبية (active & aria-selected)
  tabButtons.forEach((btn) => {
    const isTarget = btn.dataset.tab === targetId;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  // إظهار اللوحة المستهدفة وإخفاء اللوحات الأخرى
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === targetId);
  });

  // تحديث عنوان الشاشة في الترويسة العليا
  if (viewTitleEl && VIEW_TITLES[targetId]) {
    viewTitleEl.textContent = VIEW_TITLES[targetId];
  }

  // إعادة تحميل البيانات تلقائياً بحسب التبويب النشط
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

/**
 * دالة مساعدة للانتقال الفوري إلى تبويب إدارة الموظف وتحميل بيانات موظف محدد
 * @param {number} employeeId
 */
function handleManageEmployeeNavigation(employeeId) {
  switchTab('tab-manage-employee');
  loadEmployeeForManagement(employeeId);
}

// ──────────────────────────────────────────────────────────────
//  App Initialization
//  تهيئة التطبيق وربط الموديولات عند اكتمال تحميل الصفحة
// ──────────────────────────────────────────────────────────────
/**
 * تهيئة التطبيق المركزية: ربط وحدات الواجهة وتفعيل مستمعات أحداث التبويبات والمظهر
 * Central entry point: initializes all UI modules, event listeners, and navigation tabs.
 */
function initApp() {
  // 0. تهيئة مدير المظهر (Dark / Light Theme)
  initThemeManager();

  // 1. تهيئة موديولات الواجهة مع تمرير دوال التفاعل المشتركة
  initEmployeePicker();

  // نافذة البحث السريع المتقدمة
  initSearchModal({
    onSelectForEntry: (emp) => {
      selectEmployeeForPicker(emp);
    },
    onSelectForManage: (employeeId) => {
      handleManageEmployeeNavigation(employeeId);
    }
  });

  // شاشة تسجيل الإجازات واحتساب الأرصدة
  initLeaveRegistration();

  // لوحة التحكم المباشرة (الإجازات الحالية والتنبيهات)
  initDashboardTab({
    onSwitchToDashboard: () => {
      switchTab('tab-dashboard');
    }
  });

  // شاشة إضافة موظف جديد
  initAddEmployeeTab({
    onEmployeeAdded: () => {
      loadAllEmployees(1);
    }
  });

  // شاشة إدارة وتعديل الموظفين ونقلهم وتجميدهم
  initManageEmployeeTab({
    onEmployeeUpdated: () => {
      loadAllEmployees(1);
    }
  });

  // سجل وجدول كافة الموظفين
  initEmployeesTab({
    onManageEmployee: (employeeId) => {
      handleManageEmployeeNavigation(employeeId);
    }
  });

  // تقارير الأرصدة التراكمية والحرجة
  initBalanceReportTab({
    onManageEmployee: (employeeId) => {
      handleManageEmployeeNavigation(employeeId);
    }
  });

  // سجل التدقيق الأمني
  initAuditLogTab();

  // إعدادات النظام والنسخ الاحتياطي
  initSystemSettings();

  // تحديث القوائم المنسدلة للأقسام عند أي تعديل أو إضافة في الإعدادات
  onDepartmentsChanged(() => {
    populateAddEmployeeDepartments();
    populateManageDepartments();
  });

  // نافذة أرشيف مستندات الموظف
  initEmployeeDocumentsModal({
    onDocumentChanged: (empId) => {
      loadEmployeeForManagement(empId);
    }
  });

  // 2. إعداد مستمعات النقر لأزرار القائمة الجانبية (Sidebar Navigation)
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// تشغيل التهيئة فور جاهزية الـ DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

