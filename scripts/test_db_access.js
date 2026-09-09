const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
const liveDbPath = path.join(appData, 'leave_management.db');
const db = new Database(liveDbPath);

const testWs = path.join(__dirname, '..', 'scratch', 'test_ws_backup.db').replace(/\\/g, '/');
console.log('Testing VACUUM INTO to scratch:', testWs);
db.exec(`VACUUM INTO '${testWs}'`);
console.log('Scratch VACUUM succeeded.');

const testAppData = path.join(appData, 'manual_test_backup.db').replace(/\\/g, '/');
console.log('Testing VACUUM INTO to AppData:', testAppData);
db.exec(`VACUUM INTO '${testAppData}'`);
console.log('AppData VACUUM succeeded.');

db.close();
