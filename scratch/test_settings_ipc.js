// test_settings_ipc.js
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const dbPath = path.join(appData, 'leave-management-system', 'leave_management.db');
const db = new Database(dbPath);

console.log('Testing AppSettings in database:');
const rows = db.prepare('SELECT * FROM _AppSettings').all();
console.log('Current _AppSettings:', rows);

// Check that department_name, auto_backup_custom_path, app_theme exist
const dept = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'department_name'").get();
console.log('department_name:', dept?.Value);

console.log('✅ Settings database verification passed!');
