// ============================================================
//  systemSettings.js – وحدة إعدادات النظام، التخصيص، والنسخ الاحتياطي
//  تتولى إدارة إعدادات الدائرة، مسار النسخ الاحتياطي الدوري،
//  مسار تخزين المستندات، المظهر، الاستعادة، وإفراغ المستندات المحذوفة
// ============================================================

'use strict';

import { showToast, showConfirm, showExportSuccessToast } from './uiHelpers.js';
import { setAppTheme } from './themeManager.js';

// عناصر واجهة المستخدم لإعدادات النظام
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

let inputNewDepartmentName = null;
let btnAddDepartment = null;
let departmentsListContainer = null;
let _onDepartmentsChangedCallbacks = [];

export function onDepartmentsChanged(cb) {
  if (typeof cb === 'function') _onDepartmentsChangedCallbacks.push(cb);
}

function notifyDepartmentsChanged() {
  _onDepartmentsChangedCallbacks.forEach(cb => {
    try { cb(); } catch (e) { console.error(e); }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * تحميل وقراءة قائمة الأقسام وعرضها في جدول إدارة الأقسام بنافذة الإعدادات
 */
export async function loadDepartmentsList() {
  if (!departmentsListContainer) return;
  try {
    const res = await window.api.departments.getAll();
    if (res && res.success && Array.isArray(res.data)) {
      if (res.data.length === 0) {
        departmentsListContainer.innerHTML = '<div style="padding: 14px; text-align: center; color: var(--color-text-muted);">لا توجد أقسام مسجلة حالياً.</div>';
        return;
      }
      departmentsListContainer.innerHTML = `
        <div class="departments-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 44px;" class="text-center">#</th>
                <th>اسم القسم / الشعبة</th>
                <th style="width: 90px;" class="text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${res.data.map(d => {
                const deptName = d.DepartmentName || d.Name || '';
                return `
                <tr data-dept-id="${d.DepartmentID}">
                  <td class="text-center font-bold dept-id-cell">${d.DepartmentID}</td>
                  <td class="dept-name-cell">${escapeHtml(deptName)}</td>
                  <td class="text-center table-actions-cell">
                    <button type="button" class="btn-action-icon btn-edit-dept" data-id="${d.DepartmentID}" data-name="${escapeHtml(deptName)}" title="تعديل اسم القسم" aria-label="تعديل اسم القسم">✏️</button>
                    <button type="button" class="btn-action-icon btn-delete-dept" data-id="${d.DepartmentID}" data-name="${escapeHtml(deptName)}" title="حذف القسم" aria-label="حذف القسم">🗑️</button>
                  </td>
                </tr>
              `;}).join('')}
            </tbody>
          </table>
        </div>
      `;

      // ربط أزرار التعديل
      departmentsListContainer.querySelectorAll('.btn-edit-dept').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id, 10);
          const currentName = btn.dataset.name;
          const newName = prompt('أدخل الاسم الجديد للقسم:', currentName);
          if (newName === null) return;
          const trimmed = newName.trim();
          if (!trimmed) {
            showToast('اسم القسم لا يمكن أن يكون فارغاً.', 'warning');
            return;
          }
          if (trimmed === currentName) return;

          try {
            const updateRes = await window.api.departments.update(id, trimmed);
            if (updateRes && updateRes.success) {
              showToast('تم تعديل اسم القسم بنجاح.', 'success');
              await loadDepartmentsList();
              notifyDepartmentsChanged();
            } else {
              showToast(updateRes?.error || 'تعذر تعديل اسم القسم.', 'error');
            }
          } catch (err) {
            showToast('حدث خطأ أثناء تعديل القسم.', 'error');
          }
        });
      });

      // ربط أزرار الحذف مع تطبيق سياسة الحذف المشروط والتنبيه المانع
      departmentsListContainer.querySelectorAll('.btn-delete-dept').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id, 10);
          const deptName = btn.dataset.name;

          const confirmed = await showConfirm(
            `هل أنت متأكد من رغبتك في حذف قسم "${deptName}"؟\nملاحظة: إذا كان هناك موظفون مسجلون ضمن هذا القسم فلن يسمح النظام بحذفه.`,
            'تأكيد حذف القسم'
          );
          if (!confirmed) return;

          try {
            const delRes = await window.api.departments.delete(id);
            if (delRes && delRes.success) {
              showToast(`تم حذف قسم "${deptName}" بنجاح.`, 'success');
              await loadDepartmentsList();
              notifyDepartmentsChanged();
            } else {
              // إظهار رسالة التنبيه المانعة المعتمدة من المستخدم
              showToast(delRes?.error || 'تعذر حذف القسم لوجود موظفين مرتبطين.', 'error');
            }
          } catch (err) {
            showToast(err.message || 'حدث خطأ أثناء محاولة حذف القسم.', 'error');
          }
        });
      });
    }
  } catch (err) {
    console.error('Failed to load departments list:', err);
  }
}

/**
 * جلب إحصائيات المستندات المحذوفة ناعماً (Soft-deleted) وتحديث العداد والحجم الإجمالي وزر الإفراغ
 */
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

/**
 * تحميل وقراءة كافة إعدادات النظام من الواجهة الخلفية وتعبئة حقول النافذة المنبثقة
 * (اسم الدائرة، مجلد النسخ الاحتياطي، مجلد تخزين المستندات، مظهر التطبيق، وإحصائيات المستندات)
 */
export async function loadSystemSettings() {
  // 1. اسم الدائرة / الجهة الرسمية
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

  // 2. مجلد النسخ الاحتياطي المخصص
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

  // 3. مسار تخزين مستندات ومرفقات الموظفين
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

  // 4. مظهر التطبيق (فاتح / داكن / حسب النظام)
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

  // 5. إحصائيات المستندات المحذوفة ناعماً
  await loadDeletedDocsStats();

  // 6. قائمة الأقسام الإدارية والشعب
  await loadDepartmentsList();
}

/**
 * فحص حالة النسخ الاحتياطي الدوري التلقائي عند بدء تشغيل التطبيق وتنبيه المستخدم بأي أخطاء أو تحذيرات
 */
export async function checkAutoBackupStatus() {
  try {
    // 1. فحص أخطاء النسخ الاحتياطي الأخير
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

    // 2. فحص تحذيرات المسار البديل (Fallback)
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

/**
 * تهيئة موديول إعدادات النظام: ربط عناصر النافذة المنبثقة، مستمعات اختيار المجلدات،
 * اختبار مسار التخزين، حفظ التعديلات، النسخ الاحتياطي، الاستعادة، إفراغ المستندات المحذوفة، وتصدير المنقولين
 */
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

  inputNewDepartmentName = document.getElementById('input-new-department-name');
  btnAddDepartment = document.getElementById('btn-add-department');
  departmentsListContainer = document.getElementById('departments-list-container');

  if (btnAddDepartment && inputNewDepartmentName) {
    const handleAddDept = async () => {
      const name = inputNewDepartmentName.value.trim();
      if (!name) {
        showToast('يرجى إدخال اسم القسم أولاً.', 'warning');
        inputNewDepartmentName.focus();
        return;
      }
      try {
        btnAddDepartment.disabled = true;
        const addRes = await window.api.departments.add(name);
        if (addRes && addRes.success) {
          showToast(`تمت إضافة قسم "${name}" بنجاح.`, 'success');
          inputNewDepartmentName.value = '';
          await loadDepartmentsList();
          notifyDepartmentsChanged();
        } else {
          showToast(addRes?.error || 'تعذر إضافة القسم.', 'error');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء إضافة القسم.', 'error');
      } finally {
        btnAddDepartment.disabled = false;
      }
    };

    btnAddDepartment.addEventListener('click', handleAddDept);
    inputNewDepartmentName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddDept();
      }
    });
  }

  // فتح نافذة إعدادات النظام وتحميل البيانات الحالية
  if (btnSystemSettings && systemSettingsModal) {
    btnSystemSettings.addEventListener('click', async () => {
      await loadSystemSettings();
      systemSettingsModal.showModal();
    });
  }

  // إغلاق نافذة إعدادات النظام
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

  // اختيار مجلد مخصص للنسخ الاحتياطي الدوري عبر حوار النظام الأصلي
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

  // استعادة المسار الافتراضي للنسخ الاحتياطي (%APPDATA%)
  if (btnResetBackupDir && inputCustomBackupPath) {
    btnResetBackupDir.addEventListener('click', () => {
      inputCustomBackupPath.value = '';
      showToast('تمت استعادة المسار الافتراضي (%APPDATA%). اضغط حفظ لتطبيق التغيير.', 'info');
    });
  }

  // اختيار مجلد مخصص لتخزين مستندات ومرفقات الموظفين
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

  // استعادة المسار الافتراضي لتخزين المستندات (%APPDATA%)
  if (btnResetDocStorageDir && inputDocStoragePath) {
    btnResetDocStorageDir.addEventListener('click', () => {
      inputDocStoragePath.value = '';
      showToast('تمت استعادة مسار تخزين المستندات الافتراضي (%APPDATA%). اضغط حفظ لتطبيق التغيير.', 'info');
    });
  }

  // اختبار صلاحيات الكتابة والقراءة على مجلد تخزين المستندات
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

  // فتح مجلد تخزين المستندات في متصفح الملفات Explorer
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

  // التغيير الفوري للمظهر (معاينة حية)
  if (selectAppTheme) {
    selectAppTheme.addEventListener('change', () => {
      const selected = selectAppTheme.value;
      setAppTheme(selected, false);
    });
  }

  // معالجة حفظ استمارة إعدادات النظام
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

        // 1. حفظ اسم الدائرة
        await window.api.system.setSetting('department_name', deptVal);

        // 2. حفظ مسار النسخ الاحتياطي المخصص
        await window.api.system.setSetting('auto_backup_custom_path', customPathVal);

        // 3. حفظ مسار تخزين المستندات
        const docRes = await window.api.documents.setStoragePath(docStoragePathVal);
        if (docRes && docRes.success && inputDocStoragePath) {
          inputDocStoragePath.value = docRes.data?.storagePath || docStoragePathVal;
        }

        // 4. حفظ وتطبيق المظهر
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

  // زر إنشاء نسخة احتياطية فورية لقاعدة البيانات
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

  // زر استعادة نسخة احتياطية مع التحقق الصارم وإعادة تشغيل التطبيق تلقائياً
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

  // إفراغ المستندات المحذوفة ناعماً نهائياً من القرص الصلب لتوفير المساحة
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

  // تصدير كشف الموظفين المنقولين خارجياً إلى ملف Excel
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

  // التحميل الأولي للإعدادات وحالة النسخ الدوري عند التشغيل
  loadSystemSettings();
  checkAutoBackupStatus();
}

// ──────────────────────────────────────────────────────────────
//  Quick Add Department Modal Dialog (For Employee Forms)
//  نافذة الإضافة السريعة للأقسام من داخل استمارات الموظفين
// ──────────────────────────────────────────────────────────────
let quickAddDeptModal = null;
let formQuickAddDept = null;
let inputQuickAddDeptName = null;
let btnCloseQuickAddDept = null;
let btnCancelQuickAddDept = null;
let btnSubmitQuickAddDept = null;
let _currentQuickAddTargetSelect = null;
let _quickAddInitialized = false;

function initQuickAddDeptModalListeners() {
  if (_quickAddInitialized) return;
  quickAddDeptModal = document.getElementById('quick-add-dept-modal');
  formQuickAddDept = document.getElementById('form-quick-add-dept');
  inputQuickAddDeptName = document.getElementById('input-quick-add-dept-name');
  btnCloseQuickAddDept = document.getElementById('btn-close-quick-add-dept');
  btnCancelQuickAddDept = document.getElementById('btn-cancel-quick-add-dept');
  btnSubmitQuickAddDept = document.getElementById('btn-submit-quick-add-dept');

  if (formQuickAddDept) {
    formQuickAddDept.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inputQuickAddDeptName ? inputQuickAddDeptName.value.trim() : '';
      if (!name) {
        showToast('يرجى إدخال اسم القسم أولاً.', 'warning');
        inputQuickAddDeptName?.focus();
        return;
      }

      if (btnSubmitQuickAddDept) {
        btnSubmitQuickAddDept.disabled = true;
        btnSubmitQuickAddDept.textContent = 'جارٍ الحفظ…';
      }

      try {
        const res = await window.api.departments.add(name);
        if (res && res.success) {
          showToast(`تمت إضافة قسم "${name}" بنجاح وتحديده في النموذج.`, 'success');
          if (quickAddDeptModal && typeof quickAddDeptModal.close === 'function') {
            quickAddDeptModal.close();
          }
          if (inputQuickAddDeptName) inputQuickAddDeptName.value = '';

          // تحديث جدول الأقسام في الإعدادات
          await loadDepartmentsList();

          // تنبيه كافة القوائم المنسدلة للأقسام
          notifyDepartmentsChanged();

          // تحديد القسم المنشأ حديثاً في القائمة المنسدلة المستهدفة
          const newDeptId = res.data?.DepartmentID;
          if (_currentQuickAddTargetSelect && newDeptId) {
            setTimeout(() => {
              _currentQuickAddTargetSelect.value = String(newDeptId);
            }, 50);
          }
        } else {
          showToast(res?.error || 'تعذر إضافة القسم. يرجى مراجعة البيانات.', 'error');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء إضافة القسم.', 'error');
      } finally {
        if (btnSubmitQuickAddDept) {
          btnSubmitQuickAddDept.disabled = false;
          btnSubmitQuickAddDept.textContent = '💾 إضافة وتحديد القسم';
        }
      }
    });
  }

  const handleClose = () => {
    if (quickAddDeptModal && typeof quickAddDeptModal.close === 'function') {
      quickAddDeptModal.close();
    }
  };
  if (btnCloseQuickAddDept) btnCloseQuickAddDept.addEventListener('click', handleClose);
  if (btnCancelQuickAddDept) btnCancelQuickAddDept.addEventListener('click', handleClose);

  _quickAddInitialized = true;
}

/**
 * فتح نافذة إضافة قسم سريع وتعيينه فوراً في القائمة المنسدلة المحددة
 * @param {HTMLSelectElement} [targetSelectEl]
 */
export function openQuickAddDepartmentModal(targetSelectEl = null) {
  initQuickAddDeptModalListeners();
  _currentQuickAddTargetSelect = targetSelectEl || null;

  if (inputQuickAddDeptName) inputQuickAddDeptName.value = '';
  if (quickAddDeptModal && typeof quickAddDeptModal.showModal === 'function') {
    quickAddDeptModal.showModal();
    inputQuickAddDeptName?.focus();
  }
}

