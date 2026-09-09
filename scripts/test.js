const Database = require('better-sqlite3');
try {
    const db = new Database(':memory:');
    console.log("✅ better-sqlite3 تعمل بنجاح وبدون أخطاء!");
    db.close();
} catch (error) {
    console.error("❌ فشل تشغيل المكتبة. هنالك مشكلة في بيئة C++ لديك:", error.message);
}