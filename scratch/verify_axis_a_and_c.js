/**
 * verify_axis_a_and_c.js
 * Verification for Axis A (Threshold Apply button & Hint) and Axis C (README updates).
 */

const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log('    VERIFICATION FOR AXIS A (THRESHOLD) & AXIS C    ');
console.log('====================================================\n');

let total = 0;
let passed = 0;

function assert(condition, msg) {
    total++;
    if (condition) {
        console.log(`✅ [PASS] ${msg}`);
        passed++;
    } else {
        console.error(`❌ [FAIL] ${msg}`);
        process.exitCode = 1;
    }
}

// 1. Check index.html
console.log('--- 1. Checking index.html ---');
const indexHtml = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
assert(indexHtml.includes('id="btn-apply-threshold"'), 'btn-apply-threshold button exists in index.html');
assert(indexHtml.includes('id="kpi-critical-label"'), 'kpi-critical-label element exists in index.html');
assert(indexHtml.includes('الموظفون الذين يقل رصيدهم عن هذا العدد من الأيام سيظهرون بالكشف'), 'threshold-hint text exists in index.html');

// 2. Check styles.css
console.log('\n--- 2. Checking styles.css ---');
const stylesCss = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
assert(stylesCss.includes('.btn-apply-threshold'), '.btn-apply-threshold class styled in styles.css');
assert(stylesCss.includes('.threshold-hint'), '.threshold-hint class styled in styles.css');
assert(stylesCss.includes('height: 42px'), '42px height rule applied to threshold controls');

// 3. Check balanceReportTab.js
console.log('\n--- 3. Checking balanceReportTab.js ---');
const balanceTabJs = fs.readFileSync(path.join(__dirname, '../src/renderer/modules/balanceReportTab.js'), 'utf8');
assert(balanceTabJs.includes('btnApplyThreshold'), 'btnApplyThreshold variable defined');
assert(balanceTabJs.includes('kpiCriticalLabel'), 'kpiCriticalLabel variable defined');
assert(balanceTabJs.includes("`موظفون برصيد حرج (≤ ${threshold} أيام)`"), 'Dynamic KPI label update code present');
assert(balanceTabJs.includes("btnApplyThreshold.addEventListener('click', applyThreshold)"), 'btnApplyThreshold click event wired');
assert(balanceTabJs.includes("event.key === 'Enter'"), 'Enter key event wired on inputBalanceThreshold');
assert(balanceTabJs.includes("inputBalanceThreshold.addEventListener('change', applyThreshold)"), 'change event wired on inputBalanceThreshold');

// 4. Check README.md
console.log('\n--- 4. Checking README.md ---');
const readmeMd = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
assert(readmeMd.includes('الإجازات حالياً (Dashboard & Active Leaves)'), 'README reflects "الإجازات حالياً" in section 3');
assert(readmeMd.includes('⚡ فلتر المباشرة السريع'), 'README documents quick filter');
assert(readmeMd.includes('قائمة فرز متقدمة'), 'README documents 3-way sort dropdown');
assert(readmeMd.includes('زر تطبيق مخصص وفلترة تفاعلية'), 'README documents critical threshold apply button');
assert(readmeMd.includes('توحيد القياسات والارتفاعات (42px)'), 'README documents 42px height standardization');
assert(readmeMd.includes('Windows 7 (SP1)'), 'README preserves Windows 7 requirements intact');
assert(readmeMd.includes('KB2999226'), 'README preserves UCRT KB updates intact');

console.log(`\n====================================================`);
console.log(`   SUMMARY: ${passed}/${total} CHECKS PASSED`);
console.log(`====================================================\n`);
if (passed === total) {
    console.log('🎉 ALL AXIS A & C REQUIREMENTS COMPLETED AND VERIFIED!');
}
