const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE Employees (
    EmployeeID INTEGER PRIMARY KEY,
    FullName TEXT NOT NULL,
    IsActive INTEGER NOT NULL DEFAULT 1
  );
`);

console.log('Testing ALTER TABLE with CHECK constraint...');
try {
  db.exec(`ALTER TABLE Employees ADD COLUMN IsTransferred INTEGER NOT NULL DEFAULT 0 CHECK(IsTransferred IN (0, 1));`);
  console.log('SUCCESS: IsTransferred added with CHECK!');
} catch (err) {
  console.error('FAILED with CHECK:', err.message);
  console.log('Testing ALTER TABLE without CHECK...');
  db.exec(`ALTER TABLE Employees ADD COLUMN IsTransferred INTEGER NOT NULL DEFAULT 0;`);
  console.log('SUCCESS: IsTransferred added without CHECK!');
}

db.exec(`ALTER TABLE Employees ADD COLUMN TransferOrderNumber TEXT DEFAULT NULL;`);
db.exec(`ALTER TABLE Employees ADD COLUMN TransferOrderDate TEXT DEFAULT NULL;`);
db.exec(`ALTER TABLE Employees ADD COLUMN TransferNotes TEXT DEFAULT NULL;`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_employees_is_transferred ON Employees(IsTransferred);`);

console.log('Table info:');
console.log(db.prepare("PRAGMA table_info(Employees)").all());

db.close();
