// tests/migrationUpgradeCompat.test.js
// ============================================================
//  اختبار انحدار حرج: حماية Migration 022 من التعارض مع مخطط AppCounters القديم
//
//  يحاكي بالضبط السيناريو الذي أسقط التطبيق في الإنتاج:
//  - قاعدة بيانات بها AppCounters موجود مسبقاً (2 أو 3 أعمدة) قبل تسجيله في _Migrations
//  - تشغيل Migration 022 يجب ألا ينهار في أي حالة
// ============================================================

'use strict';

// Transparent ABI bridge
if (!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(result.status ?? 0);
}

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MIGRATIONS_DIR = path.join(__dirname, '../src/main/migrations');

let errors = 0;
function pass(msg) { process.stdout.write(`  ✅ PASS: ${msg}\n`); }
function fail(msg) { process.stderr.write(`  ❌ FAIL: ${msg}\n`); errors++; }

console.log('\n🛡️  [Migration Upgrade Compat Tests] Simulating pre-existing AppCounters schema (production crash scenario)\n');

// ── Same stripAlterIfColExists helper used in freshInstall.test.js and database.js ──
function stripAlterIfColExists(db, sql) {
  const alterPattern = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)[^;]*;/gi;
  return sql.replace(alterPattern, (match, tableName, colName) => {
    const tableInfo = db.pragma(`table_info(${tableName})`);
    if (tableInfo.length === 0) return match;
    const colExists = tableInfo.some(row => row.name === colName);
    return colExists ? '-- [stripped] ' + match.replace(/\n/g, ' ') : match;
  });
}

// ── Run migrations 001-021 (setting up base DB) ──────────────────────
function setupBaseDb(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && path.basename(f) < '022')
    .sort();

  for (const file of files) {
    const name = path.basename(file);
    const already = db.prepare('SELECT id FROM _Migrations WHERE name = ?').get(name);
    if (already) continue;
    const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      const sql = stripAlterIfColExists(db, rawSql);
      if (sql.trim().length > 0) db.exec(sql);
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(name);
    })();
    db.pragma('foreign_keys = ON');
  }
}

// ── Run only migration 022 (the one being tested) ────────────────────
function runMig022(db) {
  const mig022path = path.join(MIGRATIONS_DIR, '022_create_app_counters_table.sql');
  const sql = fs.readFileSync(mig022path, 'utf8');
  db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT OR IGNORE INTO _Migrations (name) VALUES ('022_create_app_counters_table.sql')").run();
  })();
}

// ── Test 1: Pre-existing AppCounters with 2 columns (NO UpdatedAt) ───
// This is the EXACT production scenario that caused the crash.
console.log('--- Test 1: Pre-existing AppCounters (2 columns, no UpdatedAt) + run migration 022 ---');
{
  const tmpDb = path.join(os.tmpdir(), `compat_test_2col_${Date.now()}.db`);
  try {
    const db = new Database(tmpDb);
    setupBaseDb(db);

    // Pre-create AppCounters with OLD 2-column schema (as test files did)
    db.exec(`
      CREATE TABLE IF NOT EXISTS AppCounters (
        CounterKey TEXT PRIMARY KEY,
        CounterValue INTEGER NOT NULL
      );
    `);
    db.prepare("INSERT OR IGNORE INTO AppCounters (CounterKey, CounterValue) VALUES ('next_employee_id', 12)").run();

    // Verify pre-condition: 2 columns, no UpdatedAt
    const schema = db.pragma('table_info(AppCounters)');
    if (!schema.some(c => c.name === 'UpdatedAt') && schema.some(c => c.name === 'CounterValue')) {
      pass('Pre-condition: AppCounters exists with 2 columns (no UpdatedAt)');
    } else {
      fail('Pre-condition mismatch — schema unexpected');
    }

    // Run migration 022 — MUST NOT crash
    let crashed = false;
    let crashMsg = '';
    try {
      runMig022(db);
    } catch (e) {
      crashed = true;
      crashMsg = e.message;
    }

    if (!crashed) {
      pass('Migration 022 ran on pre-existing 2-column AppCounters WITHOUT crashing');
    } else {
      fail(`Migration 022 crashed: ${crashMsg}`);
    }

    // Counter value must be preserved
    const row = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
    if (row && Number(row.CounterValue) === 12) {
      pass('Pre-existing counter value (12) preserved after migration 022');
    } else {
      fail(`Counter value wrong: expected 12, got ${row?.CounterValue}`);
    }

    // Migration 022 must be recorded
    const recorded = db.prepare("SELECT name FROM _Migrations WHERE name = '022_create_app_counters_table.sql'").get();
    if (recorded) {
      pass('Migration 022 correctly recorded in _Migrations');
    } else {
      fail('Migration 022 NOT recorded in _Migrations after run');
    }

    db.close();
  } finally {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  }
}

// ── Test 2: Pre-existing AppCounters with 3 columns (WITH UpdatedAt) ─
// Verifies the OLD broken state also no longer crashes (no UpdatedAt in INSERT).
console.log('\n--- Test 2: Pre-existing AppCounters (3 columns, WITH UpdatedAt) — must not crash ---');
{
  const tmpDb = path.join(os.tmpdir(), `compat_test_3col_${Date.now()}.db`);
  try {
    const db = new Database(tmpDb);
    setupBaseDb(db);

    // Pre-create AppCounters with OLD 3-column schema (what caused the crash)
    db.exec(`
      CREATE TABLE IF NOT EXISTS AppCounters (
        CounterKey TEXT PRIMARY KEY,
        CounterValue INTEGER NOT NULL,
        UpdatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    db.prepare("INSERT OR IGNORE INTO AppCounters (CounterKey, CounterValue) VALUES ('next_employee_id', 9)").run();

    let crashed = false;
    let crashMsg = '';
    try {
      runMig022(db);
    } catch (e) {
      crashed = true;
      crashMsg = e.message;
    }

    if (!crashed) {
      pass('Migration 022 does NOT crash against pre-existing 3-column AppCounters (WITH UpdatedAt)');
    } else {
      fail(`Migration 022 crashed against 3-column table: ${crashMsg}`);
    }

    const row = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
    if (row && Number(row.CounterValue) === 9) {
      pass('Pre-existing counter value (9) preserved after migration 022');
    } else {
      fail(`Counter value wrong: expected 9, got ${row?.CounterValue}`);
    }

    db.close();
  } finally {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  }
}

// ── Test 3: Fresh install (empty DB) — 022 seeds correctly ───────────
console.log('\n--- Test 3: Fresh install (empty DB) — migration 022 seeds next_employee_id = 1 ---');
{
  const tmpDb = path.join(os.tmpdir(), `compat_test_fresh_${Date.now()}.db`);
  try {
    const db = new Database(tmpDb);
    setupBaseDb(db);

    let crashed = false;
    let crashMsg = '';
    try {
      runMig022(db);
    } catch (e) {
      crashed = true;
      crashMsg = e.message;
    }

    if (!crashed) {
      pass('Migration 022 ran on fresh empty DB without error');
    } else {
      fail(`Migration 022 crashed on fresh DB: ${crashMsg}`);
    }

    const row = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
    if (row && Number(row.CounterValue) === 1) {
      pass(`Fresh install: next_employee_id correctly seeded to 1`);
    } else {
      fail(`Fresh install: next_employee_id expected 1, got ${row?.CounterValue}`);
    }

    db.close();
  } finally {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  }
}

// ── Test 4: Idempotency — running 022 twice does not crash ───────────
console.log('\n--- Test 4: Idempotency — running migration 022 twice is safe ---');
{
  const tmpDb = path.join(os.tmpdir(), `compat_test_idempotent_${Date.now()}.db`);
  try {
    const db = new Database(tmpDb);
    setupBaseDb(db);

    runMig022(db); // First run

    let crashed = false;
    let crashMsg = '';
    try {
      // Second run: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE = no-op
      const mig022path = path.join(MIGRATIONS_DIR, '022_create_app_counters_table.sql');
      const sql = fs.readFileSync(mig022path, 'utf8');
      db.exec(sql);
    } catch (e) {
      crashed = true;
      crashMsg = e.message;
    }

    if (!crashed) {
      pass('Running migration 022 SQL twice is idempotent (no crash)');
    } else {
      fail(`Migration 022 crashed on second run: ${crashMsg}`);
    }

    db.close();
  } finally {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  }
}

// ── Final report ──────────────────────────────────────────────────────
console.log('\n');
if (errors === 0) {
  console.log('🎉 [Migration Upgrade Compat Tests] ALL TESTS PASSED — migration 022 is safe against all pre-existing AppCounters schemas!');
  process.exit(0);
} else {
  console.error(`💥 [Migration Upgrade Compat Tests] ${errors} TEST(S) FAILED`);
  process.exit(1);
}
