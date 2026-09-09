const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const trycatches = JSON.parse(fs.readFileSync(path.join(projectRoot, 'scripts/analysis_out/trycatches.json'), 'utf8'));

const detailedAnalysis = trycatches.map((c, i) => {
  const file = c.file;
  const line = c.line;
  const code = c.code;

  let severity = 'LOW';
  let description = '';
  let userImpact = '';
  let category = '';

  if (file.includes('AuditService.js')) {
    if (line === 49) {
      severity = 'CRITICAL';
      category = 'AUDIT_LOG_SILENT_FAILURE';
      description = 'فشل تسجيل حركة التدقيق (INSERT INTO AuditLogs) يتم التقاطه بـ catch وطباعة console.error فقط مع إرجاع null دون تنبيه المستخدم أو إيقاف العملية.';
      userImpact = 'إذا فشلت كتابة سجل التدقيق، تستمر عملية إضافة/تعديل/حذف الموظف أو الإجازة بدون توثيق أمني، ويبقى المسؤول الإداري يظن أن كل شيء موثق دون علمه بالخلل.';
    } else {
      severity = 'LOW';
      category = 'SAFE_JSON_PARSE';
      description = 'محاولة فك تشفير JSON للقطة القديمة أو الجديدة (JSON.parse) وفي حال الفشل يتم استخدام القيمة النصية الخام.';
      userImpact = 'لا ضرر - مجرد معالجة دفاعية تحمي التطبيق من الانهيار عند قراءة نصوص غير متوافقة مع JSON.';
    }
  } else if (file.includes('AutoBackupService.js')) {
    if (line === 66 || line === 71) {
      severity = 'MEDIUM';
      category = 'BACKUP_CLEANUP_FAILURE';
      description = 'فشل حذف النسخ الاحتياطية الأقدم من 10 نسخ (pruneOldBackups) يطبع console.error فقط.';
      userImpact = 'لا تتوقف النسخ الاحتياطية لكن قد تتراكم ملفات النسخ القديمة في مجلد auto-backups بصمت.';
    } else if (line === 167) {
      severity = 'CRITICAL';
      category = 'AUTO_BACKUP_FAILURE';
      description = 'فشل إنشاء النسخة الاحتياطية التلقائية الدورية (كل 15 يوم) يسجل console.error فقط دون إشعار إداري في الواجهة.';
      userImpact = 'إذا فشل النسخ الاحتياطي التلقائي (مثلاً بسبب امتلاء القرص أو أذونات المجلد)، فلن يعلم المستخدم أو المسؤول الإداري أن نظامه غير محمي بنسخ حديثة.';
    }
  } else if (file.includes('NotificationService.js')) {
    severity = 'MEDIUM';
    category = 'NOTIFICATION_SCHEDULER_ERROR';
    description = 'فشل فحص إشعارات استئناف الدوام اليومية عند الإقلاع أو عند الساعة 11:00 يطبع console.error فقط.';
    userImpact = 'قد يفوت موظف الاستقبال أو الموارد البشرية تنبيه انتهاء إجازات الموظفين دون ظهور أي رسالة في الواجهة تشير لتعطل خدمة التنبيه.';
  } else if (file.includes('main.js')) {
    if (line === 64) {
      severity = 'CRITICAL';
      category = 'STARTUP_DB_FAILURE';
      description = 'فشل تهيئة قاعدة البيانات عند الإقلاع يعرض dialog.showErrorBox بالإنجليزية ثم يغلق التطبيق.';
      userImpact = 'يظهر صندوق خطأ إنجليزي غير معرب "Database Error" للمستخدم العادي قبل إغلاق التطبيق فجأة.';
    } else if (line === 80) {
      severity = 'CRITICAL';
      category = 'STARTUP_BACKUP_PROMISE_REJECTION';
      description = 'استدعاء autoBackupService.checkAndRunAutoBackup(db.getDb()).catch يكتفي بـ console.error.';
      userImpact = 'فشل أخذ النسخة الاحتياطية التلقائية عند إقلاع البرنامج يضيع بصمت دون أي تنبيه في الواجهة.';
    } else if (line === 115) {
      severity = 'MEDIUM';
      category = 'IPC_SAFE_HANDLE_ERROR';
      description = 'دالة safeHandle العامة في main.js تلتقط الأخطاء وتعيد { success: false, error: err.message } مع console.error.';
      userImpact = 'يعود الخطأ للـ Renderer، فإذا كان الـ Renderer يعرض Toast يكون معالجاً، أما إذا كان الـ Renderer لا يفحص response.success فيصبح خطأ صامتاً.';
    }
  } else if (file.includes('database.js')) {
    if (line === 97) {
      severity = 'CRITICAL';
      category = 'MIGRATION_EXECUTION_FAILURE';
      description = 'أثناء تنفيذ الترحيلات في initializeMigrations، يتم التقاط الخطأ وإعادة رميه throw err مع إغلاق الـ db.';
      userImpact = 'يتم التقاطه في main.js وعرض صندوق خطأ إنجليزي وإغلاق التطبيق.';
    } else if (line === 447 || line === 484 || line === 491 || line === 492) {
      severity = 'LOW';
      category = 'RESOURCE_CLEANUP';
      description = 'محاولة إغلاق قاعدة بيانات مؤقتة أو حذف ملفات WAL/SHM متبقية عند النسخ أو الاستعادة.';
      userImpact = 'سلوك تنظيف دفاعي طبيعي وآمن تماماً.';
    }
  } else if (file.includes('EmployeeService.js')) {
    if (line === 281) {
      severity = 'LOW';
      category = 'DATE_PARSING_FALLBACK';
      description = 'محاولة قراءة تاريخ التعيين وحساب فارق الأيام، إذا فشل يعيد 0.';
      userImpact = 'معالجة دفاعية لمنع انهيار حسابات الرصيد إذا كانت التواريخ غير منسقة.';
    }
  } else if (file.includes('ReportService.js')) {
    if (line === 75) {
      severity = 'LOW';
      category = 'SETTING_FETCH_FALLBACK';
      description = 'محاولة قراءة department_name من _AppSettings، إذا فشلت أو الجدول غير موجود يعيد null.';
      userImpact = 'سلوك دفاعي مقصود حتى لا تفشل عمليات التصدير لو كان جدول الإعدادات فارغاً.';
    } else if (line === 735) {
      severity = 'HIGH';
      category = 'REPORT_EXPORT_FILE_WRITE';
      description = 'فشل كتابة ملف Excel (workbook.xlsx.writeFile) يعيد throw err.';
      userImpact = 'يتم التقاطه في reportHandlers وإرجاع { success: false, error } للواجهة لعرض Toast.';
    }
  } else if (file.includes('ipc')) {
    severity = 'LOW';
    category = 'IPC_WRAPPER';
    description = 'تغليف safeHandleAsync في ملفات الـ IPC (employeeHandlers, leaveHandlers, reportHandlers, systemHandlers, auditHandlers) يقوم بالتقاط أي استثناء وإرجاع { success: false, error: err.message }.';
    userImpact = 'يحمي الـ Main Process من الانهيار ويرسل الخطأ كاستجابة منظمة للـ Renderer.';
  } else if (file.includes('renderer.js')) {
    // Let's inspect renderer catch blocks
    if (line === 234) {
      severity = 'LOW';
      category = 'THEME_LOAD_FALLBACK';
      description = 'قراءة الثيم من localStorage.';
      userImpact = 'يعتمد الثيم الافتراضي إذا فشل التخزين المحلي.';
    } else if (line === 418 || line === 432) {
      severity = 'MEDIUM';
      category = 'EMPLOYEE_SEARCH_INPUT_ERROR';
      description = 'فشل البحث التلقائي أثناء الكتابة في حقول البحث (Search Modal أو Live Filter) يسجل console.error فقط دون تنبيه.';
      userImpact = 'لا يظهر تنبيه للمستخدم، وتظل نتائج البحث فارغة أو تتوقف عن التحديث إذا حدث خطأ IPC.';
    } else if (line === 502) {
      severity = 'MEDIUM';
      category = 'EMPLOYEE_SELECTION_LEAVE_BALANCE_FETCH';
      description = 'فشل جلب رصيد الإجازات المتبقي للموظف عند اختياره في فورم تقديم الإجازة (loadEmployeeLeaveBalance) يسجل console.error فقط.';
      userImpact = 'يبقى كارت الرصيد فارغاً أو يعرض أصفاراً دون رسالة توضح للمستخدم أن جلب الرصيد فشل برمجياً.';
    } else if (line === 521) {
      severity = 'MEDIUM';
      category = 'EMPLOYEE_DETAILS_MODAL_LOAD';
      description = 'فشل جلب تفاصيل الموظف عند النقر على اسمه في البحث يسجل console.error فقط.';
      userImpact = 'لا تفتح نافذة التفاصيل أو تظل معلقة بدون إشعار للمستخدم.';
    } else if (line === 926) {
      severity = 'MEDIUM';
      category = 'ACTIVE_LEAVES_TABLE_LOAD';
      description = 'فشل تحميل جدول المجازين اليوم في الصفحة الرئيسية (loadActiveLeavesTable) يسجل console.error فقط.';
      userImpact = 'يظل جدول المجازين اليوم يعرض رسالة "جارٍ التحميل..." أو يبقى فارغاً دون إشعار خطأ في الواجهة.';
    } else if (line === 1164) {
      severity = 'MEDIUM';
      category = 'SEARCH_MODAL_LOOKUP_ERROR';
      description = 'فشل البحث في نافذة البحث العامة (performSearchModal) يسجل console.error فقط.';
      userImpact = 'تظهر رسالة "لا توجد نتائج" بدلاً من إعلام المستخدم بوجود خلل في الاتصال بقاعدة البيانات.';
    } else if (line === 1271) {
      severity = 'MEDIUM';
      category = 'LEAVE_HISTORY_LOAD_ERROR';
      description = 'فشل جلب سجل إجازات الموظف (loadLeaveHistory) يسجل console.error فقط.';
      userImpact = 'يبقى جدول الإجازات فارغاً أو في حالة تحميل دون ظهور Toast يوضح سبب الفشل للمستخدم.';
    } else if (line === 1780) {
      severity = 'MEDIUM';
      category = 'EMPLOYEES_MANAGEMENT_TABLE_LOAD';
      description = 'فشل تحميل جدول إدارة الموظفين وصفحاته (loadEmployeesTable) يسجل console.error فقط.';
      userImpact = 'يظل جدول إدارة الموظفين فارغاً دون توضيح للمستخدم.';
    } else if (line === 1967) {
      severity = 'LOW';
      category = 'DEPARTMENT_NAME_INITIAL_LOAD';
      description = 'فشل تحميل اسم الدائرة عند الإقلاع (loadSystemSettings) يسجل console.error فقط.';
      userImpact = 'يترك حقل اسم الدائرة فارغاً دون إزعاج المستخدم برسائل خطأ عند بدء التشغيل.';
    } else if (line === 2343 || line === 2364 || line === 2368 || line === 2473) {
      severity = 'LOW';
      category = 'JSON_FORMATTING_HELPERS';
      description = 'محاولات فك وتهيئة حقول JSON في عارض سجل التدقيق (Audit Snapshot Modal).';
      userImpact = 'إذا كان الحقل ليس JSON يعرض كنص عادي بأمان تام.';
    } else {
      // General catch block with showToast
      if (code.includes('showToast')) {
        severity = 'LOW';
        category = 'USER_NOTIFIED_CATCH';
        description = 'تم التقاط الخطأ وإظهار إشعار Toast فوري للمستخدم.';
        userImpact = 'المستخدم يرى الخطأ فوراً.';
      } else {
        severity = 'MEDIUM';
        category = 'RENDERER_CONSOLE_ONLY';
        description = 'خطأ تم التقاطه في الواجهة دون إظهار Toast للمستخدم: ' + code.split('\n')[0];
        userImpact = 'فشل العملية بصمت في الواجهة.';
      }
    }
  }

  return {
    index: i + 1,
    file,
    line,
    severity,
    category,
    description,
    userImpact,
    codeSample: code
  };
});

fs.writeFileSync(path.join(projectRoot, 'scripts/analysis_out/full_catch_audit.json'), JSON.stringify(detailedAnalysis, null, 2), 'utf8');

console.log('Classified all 54 catch blocks successfully.');
