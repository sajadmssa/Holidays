const db = require('../src/main/database');
db.initialize();
console.log(db.getDb().prepare('SELECT * FROM LeaveTypes').all());
