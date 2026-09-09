// ============================================================
//  systemSettings.js – System Settings, Custom Backup Dir, Theme & Restore
// ============================================================

'use strict';

import { showToast, showConfirm, showExportSuccessToast } from './uiHelpers.js';
import { setAppTheme } from './themeManager.js';

let btnSystemSettings = null;
let systemSettingsModal = null;
let btnCloseSettingsModal = null;
let btnCancelSettings = null;
let systemSettingsForm = null;
let inputDepartmentName = null;
let inputCustomBackupPath = null;
let btnSelectBackupDir = null;
let btnResetBackupDir = null;
let inputDocStoragePath = null;
let btnSelectDocStorageDir = null;
let btnResetDocStorageDir = null;
let btnTestDocStorageDir = null;
let btnOpenDocStorageDir = null;
let selectAppTheme = null;
let btnSaveSettings = null;
let btnSystemBackup = null;
let btnSystemRestore = null;
let deletedDocsCountEl = null;
let deletedDocsSizeEl = null;
let btnPurgeDeletedDocs = null;
let btnExportTransferredReport = null;
let _currentDeletedDocsCount = 0;

export async function loadDeletedDocsStats() {
  if (!deletedDocsCountEl || !deletedDocsSizeEl) return;
  try {
    const res = await window.api.documents.getDeletedStats();
    if (res && res.success && res.data) {
      _currentDeletedDocsCount = res.data.count || 0;
      deletedDocsCountEl.textContent = String(_currentDeletedDocsCount);
      deletedDocsSizeEl.textContent = res.data.formattedSize || '0 B';

      if (btnPurgeDeletedDocs) {
        btnPurgeDeletedDocs.disabled = _currentDeletedDocsCount === 0;
        if (_currentDeletedDocsCount === 0) {
          btnPurgeDeletedDocs.title = 'لا توجد مستندات محذوفة بانتظار الإفراغ';
        } else {
          btnPurgeDeletedDocs.title = `إفراغ ${_currentDeletedDocsCount} مستند محذوف نهائياً من القرص`;
        }
      }
    }
  } catch (err) {
    console.error('Failed to load deleted docs stats:', err);
  }
}

export async function loadSystemSettings() {
  // 1. Department Name
  if (inputDepartmentName) {
    try {
      const res = await window.api.system.getSetting('department_name');
      if (res && res.success && res.data) {
        inputDepartmentName.value = typeof res.data === 'string' ? res.data : (res.data.Value || res.data.SettingValue || '');
      } else {
        inputDepartmentName.value = '';
      }
    } catch (err) {
      console.error('Failed to load department_name setting:', err);
    }
  }

  // 2. Custom Backup Path
  if (inputCustomBackupPath) {
    try {
      const res = await window.api.system.getSetting('auto_backup_custom_path');
      if (res && res.success && res.data) {
        inputCustomBackupPath.value = typeof res.data === 'string' ? res.data : (res.data.Value || '');
      } else {
        inputCustomBackupPath.value = '';
      }
    } catch (err) {
      console.error('Failed to load auto_backup_custom_path setting:', err);
    }
  }

  // 3. Employee Documents Storage Path
  if (inputDocStoragePath) {
    try {
      const res = await window.api.documents.getStoragePath();
      if (res && res.success && res.data) {
        inputDocStoragePath.value = res.data;
      } else {
        inputDocStoragePath.value = '';
      }
    } catch (err) {
      console.error('Failed to load document storage path:', err);
    }
  }

  // 4. Theme
  if (selectAppTheme) {
    try {
      const res = await window.api.system.getSetting('app_theme');
      if (res && res.success && res.data) {
        const themeVal = typeof res.data === 'string' ? res.data : (res.data.Value || 'system');
        selectAppTheme.value = themeVal || 'system';
      } else {
        const localTheme = localStorage.getItem('app_theme') || 'system';
        selectAppTheme.value = localTheme;
      }
    } catch (err) {
      console.error('Failed to load app_theme setting:', err);
    }
  }

  // 5. Soft-Deleted Documents Stats
  await loadDeletedDocsStats();
}

export async function checkAutoBackupStatus() {
  try {
    // 1. Check backup errors
    const res = await window.api.system.getSetting('last_auto_backup_error');
    if (res && res.success && res.data) {
      let errorInfo = null;
      try {
        errorInfo = typeof res.data === 'string' && res.data.startsWith('{') ? JSON.parse(res.data) : null;
      } catch (_e) {}
      if (errorInfo && errorInfo.error) {
        const dateStr = errorInfo.date ? new Date(errorInfo.date).toLocaleDateString('ar-IQ') : '';
        showToast(`⚠️ تنبيه إداري: تعذر إتمام النسخ الاحتياطي التلقائي الأخير (${dateStr}). يرجى أخذ نسخة احتياطية يدوياً من إدارة النظام.`, 'warning', 9000);
      }
    }

    // 2. Check backup fallback warnings
    const warnRes = await window.api.system.getSetting('last_auto_backup_warning');
    if (warnRes && warnRes.success && warnRes.data) {
      let warnInfo = null;
      try {
        warnInfo = typeof warnRes.data === 'string' && warnRes.data.startsWith('{') ? JSON.parse(warnRes.data) : null;
      } catch (_e) {}
      if (warnInfo && warnInfo.warning) {
        showToast(`ℹ️ تنبيه النسخ الدوري: ${warnInfo.warning}`, 'warning', 8000);
      }
    }
  } catch (_e) {}
}

export function initSystemSettings() {
  btnSystemSettings = document.getElementById('btn-system-settings');
  systemSettingsModal = document.getElementById('system-settings-modal');
  btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');
  btnCancelSettings = document.getElementById('btn-cancel-settings');
  systemSettingsForm = document.getElementById('system-settings-form');
  inputDepartmentName = document.getElementById('input-department-name');
  inputCustomBackupPath = document.getElementById('input-custom-backup-path');
  btnSelectBackupDir = document.getElementById('btn-select-backup-dir');
  btnResetBackupDir = document.getElementById('btn-reset-backup-dir');
  inputDocStoragePath = document.getElementById('input-doc-storage-path');
  btnSelectDocStorageDir = document.getElementById('btn-select-doc-storage-dir');
  btnResetDocStorageDir = document.getElementById('btn-reset-doc-storage-dir');
  btnTestDocStorageDir = document.getElementById('btn-test-doc-storage-dir');
  btnOpenDocStorageDir = document.getElementById('btn-open-doc-storage-dir');
  selectAppTheme = document.getElementById('select-app-theme');
  btnSaveSettings = document.getElementById('btn-save-settings');
  btnSystemBackup = document.getElementById('btn-system-backup');
  btnSystemRestore = document.getElementById('btn-system-restore');

  // Open settings modal
  if (btnSystemSettings && systemSettingsModal) {
    btnSystemSettings.addEventListener('click', async () => {
      await loadSystemSettings();
      systemSettingsModal.showModal();
    });
  }

  // Close settings modal
  if (btnCloseSettingsModal && systemSettingsModal) {
    btnCloseSettingsModal.addEventListener('click', () => {
      systemSettingsModal.close();
    });
  }

  if (btnCancelSettings && systemSettingsModal) {
    btnCancelSettings.addEventListener('click', () => {
      systemSettingsModal.close();
    });
  }

  // Auto-backup Directory Selection
  if (btnSelectBackupDir && inputCustomBackupPath) {
    btnSelectBackupDir.addEventListener('click', async () => {
      try {
        const currentVal = inputCustomBackupPath.value.trim();
        const res = await window.api.system.selectDirectory(currentVal);
        if (res && res.success && res.data && !res.data.canceled && res.data.selectedPath) {
          inputCustomBackupPath.value = res.data.selectedPath;
          showToast('تم تحديد مجلد النسخ الاحتياطي المخصص.', 'info');
        }
      } catch (err) {
        showToast('تعذر فتح نافذة اختيار المجلد.', 'error');
      }
    });
  }

  // Reset Auto-backup Directory to Default
  if (btnResetBackupDir && inputCustomBackupPath) {
    btnResetBackupDir.addEventListener('click', () => {
      inputCustomBackupPath.value = '';
      showToast('تمت استعادة المسار الافتراضي (%APPDATA%). اضغط حفظ لتطبيق التغيير.', 'info');
    });
  }

  // Doc Storage Directory Selection
  if (btnSelectDocStorageDir && inputDocStoragePath) {
    btnSelectDocStorageDir.addEventListener('click', async () => {
      try {
        const currentVal = inputDocStoragePath.value.trim();
        const res = await window.api.system.selectDirectory(currentVal);
        if (res && res.success && res.data && !res.data.canceled && res.data.selectedPath) {
          inputDocStoragePath.value = res.data.selectedPath;
          showToast('تم تحديد مجلد تخزين المستندات المخصص.', 'info');
        }
      } catch (err) {
        showToast('تعذر فتح نافذة اختيار المجلد.', 'error');
      }
    });
  }

  // Reset Doc Storage Directory to Default
  if (btnResetDocStorageDir && inputDocStoragePath) {
    btnResetDocStorageDir.addEventListener('click', () => {
      inputDocStoragePath.value = '';
      showToast('تمت استعادة مسار تخزين المستندات الافتراضي (%APPDATA%). اضغط حفظ لتطبيق التغيير.', 'info');
    });
  }

  // Test Doc Storage Path
  if (btnTestDocStorageDir && inputDocStoragePath) {
    btnTestDocStorageDir.addEventListener('click', async () => {
      btnTestDocStorageDir.disabled = true;
      try {
        const pathVal = inputDocStoragePath.value.trim();
        const res = await window.api.documents.testStoragePath(pathVal || undefined);
        if (res && res.success) {
          showToast(res.data?.message || 'المسار صالح وقابل للكتابة والقراءة بنجاح.', 'success');
        } else {
          showToast(`⚠️ فشل اختبار المسار: ${res?.error || 'تعذر الوصول للمجلد'}`, 'error');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء اختبار مسار التخزين.', 'error');
      } finally {
        btnTestDocStorageDir.disabled = false;
      }
    });
  }

  // Open Doc Storage Folder in File Explorer
  if (btnOpenDocStorageDir) {
    btnOpenDocStorageDir.addEventListener('click', async () => {
      try {
        const res = await window.api.documents.openStorageFolder();
        if (!res.success) {
          showToast(`تعذر فتح المجلد: ${res.error || 'المسار غير موجود'}`, 'error');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء فتح المجلد.', 'error');
      }
    });
  }

  // Theme dropdown change (live preview)
  if (selectAppTheme) {
    selectAppTheme.addEventListener('change', () => {
      const selected = selectAppTheme.value;
      setAppTheme(selected, false); // preview immediately, persist on save or change
    });
  }

  // Save settings form
  if (systemSettingsForm) {
    systemSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (btnSaveSettings) {
        btnSaveSettings.disabled = true;
        btnSaveSettings.textContent = 'جارٍ الحفظ…';
      }

      try {
        const deptVal = inputDepartmentName ? inputDepartmentName.value.trim() : '';
        const customPathVal = inputCustomBackupPath ? inputCustomBackupPath.value.trim() : '';
        const docStoragePathVal = inputDocStoragePath ? inputDocStoragePath.value.trim() : '';
        const themeVal = selectAppTheme ? selectAppTheme.value : 'system';

        // 1. Save department name
        await window.api.system.setSetting('department_name', deptVal);

        // 2. Save custom backup path
        await window.api.system.setSetting('auto_backup_custom_path', customPathVal);

        // 3. Save document storage path
        const docRes = await window.api.documents.setStoragePath(docStoragePathVal);
        if (docRes && docRes.success && inputDocStoragePath) {
          inputDocStoragePath.value = docRes.data?.storagePath || docStoragePathVal;
        }

        // 4. Save theme & apply
        await setAppTheme(themeVal, true);

        showToast('تم حفظ إعدادات النظام بنجاح.', 'success');
        if (systemSettingsModal) systemSettingsModal.close();
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء حفظ الإعدادات.', 'error');
      } finally {
        if (btnSaveSettings) {
          btnSaveSettings.disabled = false;
          btnSaveSettings.textContent = '💾 حفظ التعديلات';
        }
      }
    });
  }

  // Backup DB button
  if (btnSystemBackup) {
    btnSystemBackup.addEventListener('click', async () => {
      btnSystemBackup.disabled = true;
      const originalText = btnSystemBackup.textContent;
      btnSystemBackup.textContent = 'جارٍ الحفظ…';

      try {
        const response = await window.api.system.backup();

        if (!response.success) {
          showToast(response.error || 'تعذر إنشاء النسخة الاحتياطية، يرجى المحاولة لاحقاً.', 'error');
          return;
        }

        if (response.data?.canceled) {
          return;
        }

        showToast('تم حفظ النسخة الاحتياطية بنجاح.', 'success');

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء إنشاء النسخة الاحتياطية.', 'error');
      } finally {
        btnSystemBackup.disabled = false;
        btnSystemBackup.textContent = originalText;
      }
    });
  }

  // Restore DB button
  if (btnSystemRestore) {
    btnSystemRestore.addEventListener('click', async () => {
      btnSystemRestore.disabled = true;
      const originalText = btnSystemRestore.textContent;
      btnSystemRestore.textContent = 'جارٍ الفحص…';

      try {
        const response = await window.api.system.restore();

        if (!response.success) {
          showToast(response.error || 'تعذرت استعادة النسخة الاحتياطية.', 'error');
          return;
        }

        if (response.data?.canceled) {
          return;
        }

        showToast('تمت استعادة النسخة بنجاح. جارٍ إعادة تشغيل التطبيق…', 'success');

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء استعادة النسخة الاحتياطية.', 'error');
      } finally {
        btnSystemRestore.disabled = false;
        btnSystemRestore.textContent = originalText;
      }
    });
  }

  // Deleted Documents Purge
  deletedDocsCountEl = document.getElementById('deleted-docs-count');
  deletedDocsSizeEl = document.getElementById('deleted-docs-size');
  btnPurgeDeletedDocs = document.getElementById('btn-purge-deleted-docs');

  if (btnPurgeDeletedDocs) {
    btnPurgeDeletedDocs.addEventListener('click', async () => {
      if (_currentDeletedDocsCount <= 0) {
        showToast('لا توجد مستندات محذوفة بانتظار الإفراغ.', 'info');
        return;
      }

      const confirmed = await showConfirm(
        `تحذير أمني: سيتم حذف جميع ملفات المستندات المحذوفة (${_currentDeletedDocsCount} مستند) نهائياً من القرص الصلب لتوفير المساحة، ولا يمكن التراجع عن هذا الإجراء بعد تنفيذه.\n\nهل أنت متأكد من رغبتك في إفراغ المستندات المحذوفة نهائياً؟`,
        'تأكيد إفراغ المستندات نهائياً'
      );

      if (!confirmed) return;

      btnPurgeDeletedDocs.disabled = true;
      const originalText = btnPurgeDeletedDocs.innerHTML;
      btnPurgeDeletedDocs.innerHTML = '<span>⏳</span><span>جارٍ الإفراغ…</span>';

      try {
        const res = await window.api.documents.purgeDeleted();
        if (!res.success) {
          showToast(`تعذر إفراغ المستندات: ${res.error || 'خطأ غير معروف'}`, 'error');
          return;
        }

        const freedSize = res.data?.formattedSize || '0 B';
        const purgedCount = res.data?.purgedCount || 0;
        showToast(`تم إفراغ (${purgedCount}) مستند محذوف وتوفير مساحة (${freedSize}) بنجاح.`, 'success');

        await loadDeletedDocsStats();
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء إفراغ المستندات.', 'error');
      } finally {
        btnPurgeDeletedDocs.disabled = _currentDeletedDocsCount === 0;
        btnPurgeDeletedDocs.innerHTML = originalText;
      }
    });
  }

  // Transferred Employees Excel Export
  btnExportTransferredReport = document.getElementById('btn-export-transferred-report');
  if (btnExportTransferredReport) {
    btnExportTransferredReport.addEventListener('click', async () => {
      btnExportTransferredReport.disabled = true;
      const origHtml = btnExportTransferredReport.innerHTML;
      btnExportTransferredReport.innerHTML = '<span class="excel-icon">⏳</span><span>جارٍ التصدير…</span>';

      try {
        const response = await window.api.report.exportTransferredEmployees();

        if (!response.success) {
          showToast(response.error || 'تعذر تصدير كشف الموظفين المنقولين، يرجى المحاولة لاحقاً.', 'error');
          return;
        }

        if (response.data?.canceled) {
          return;
        }

        if (response.data?.filePath) {
          showExportSuccessToast({
            filePath: response.data.filePath,
            message: 'تم تصدير كشف الموظفين المنقولين بنجاح.'
          });
        } else {
          showToast('تم تصدير كشف الموظفين المنقولين بنجاح.', 'success');
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء تصدير كشف المنقولين.', 'error');
      } finally {
        btnExportTransferredReport.disabled = false;
        btnExportTransferredReport.innerHTML = origHtml;
      }
    });
  }

  // Initial fetches
  loadSystemSettings();
  checkAutoBackupStatus();
}
