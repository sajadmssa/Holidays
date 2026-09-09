
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database('C:/Users/3D/Desktop/Holidays/scratch/sandbox_power_loss/appdata/scen3.db');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const EmployeeService = require('C:/Users/3D/Desktop/Holidays/src/main/services/EmployeeService');
    const AuditService = require('C:/Users/3D/Desktop/Holidays/src/main/services/AuditService');

    // Intercept AuditService.logAction to simulate hard crash immediately after UPDATE
    AuditService.logAction = function() {
      process.abort();
    };

    const targetOp = process.argv[2];

    if (targetOp === 'transfer') {
      EmployeeService.transferEmployee(9903, {
        transferOrderNumber: '12345',
        transferOrderDate: '2026-03-09',
        transferNotes: 'نقل إلى موقع آخر'
      }, db);
    } else if (targetOp === 'cancelTransfer') {
      EmployeeService.cancelEmployeeTransfer(9904, db);
    } else if (targetOp === 'update') {
      EmployeeService.updateEmployee(9905, {
        fullName: 'موظف محاكاة التعديل',
        jobTitle: 'مترجم جديد كلياً'
      }, db);
    } else if (targetOp === 'deactivate') {
      EmployeeService.deactivateEmployee(9906, db);
    } else if (targetOp === 'activate') {
      EmployeeService.activateEmployee(9907, db);
    }
  