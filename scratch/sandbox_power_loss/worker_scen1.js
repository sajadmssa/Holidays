
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database('C:/Users/3D/Desktop/Holidays/scratch/sandbox_power_loss/appdata/scen1.db');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const EmployeeService = require('C:/Users/3D/Desktop/Holidays/src/main/services/EmployeeService');

    // Attach trigger to simulate sudden process crash immediately upon Employee row insertion
    db.exec(`
      CREATE TRIGGER trg_crash_sim AFTER INSERT ON Employees
      FOR EACH ROW WHEN NEW.EmployeeID = 9901
      BEGIN
        SELECT RAISE(FAIL, 'TRIGGERED_POWER_LOSS_SIMULATION');
      END;
    `);

    try {
      EmployeeService.addEmployee({
        employeeId: 9901,
        fullName: 'موظف محاكاة انقطاع الكهرباء',
        gender: 'Male',
        hireDate: '2023-01-01',
        jobTitle: 'فني حاسوب'
      }, db);
    } catch (err) {
      // Brutal immediate exit without closing DB (simulating hard crash)
      process.exit(99);
    }
  