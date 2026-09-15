# DATA-MODEL.md — نظام إدارة الإجازات والمستندات (Holidays)

> **حالة الوثيقة:** الشكل النهائي الفعلي لقاعدة البيانات بعد تطبيق كل ملفات الترحيل (`001` إلى `019`) بالتسلسل — مُستخرَج مباشرة من ملفات SQL الفعلية، وليس افتراضاً.
> المرجع الوحيد الموثوق دائماً هو مجلد `src/main/migrations/`. عند إضافة ترحيل جديد مستقبلاً، **حدِّث هذا الملف في نفس الالتزام (Commit)**.

---

## 1. مخطط العلاقات (ERD)

```mermaid
erDiagram
    Departments ||--o{ Employees : "ينتمي إلى"
    Employees ||--o{ Leaves : "يملك"
    Employees ||--o{ LeaveBalances : "يملك رصيداً لكل"
    Employees ||--o{ EmployeeDocuments : "يملك مستندات"
    LeaveTypes ||--o{ Leaves : "يُصنَّف حسب"
    LeaveTypes ||--o{ LeaveBalances : "له رصيد ضمن"

    Departments {
        INTEGER DepartmentID PK
        TEXT Name UK "اسم القسم الرسمي الفريد"
        TEXT CreatedAt
    }

    Employees {
        INTEGER EmployeeID PK "معرّف داخلي للموظف"
        INTEGER SequenceNumber UK "رقم تسلسلي داخلي تراكمي لا يتراجع"
        TEXT JobNumber "رقم وظيفي رسمي يدوي خارجي"
        INTEGER DepartmentID FK "معرّف القسم التابع له"
        TEXT FullName
        TEXT Gender "Male / Female"
        TEXT HireDate
        TEXT JobTitle
        TEXT WorkLocation
        TEXT LeaveCardNumber UK "فريد جزئياً — يتجاهل NULL/فارغ"
        TEXT LeaveApprover
        INTEGER IsActive "0/1"
        INTEGER AdjustmentDays
        INTEGER IsTransferred "0/1 — لا يُعطّل الموظف"
        TEXT TransferOrderNumber
        TEXT TransferOrderDate
        TEXT TransferNotes
    }

    LeaveTypes {
        INTEGER LeaveTypeID PK
        TEXT Name UK "عربي حصراً (13 نوعاً)"
        INTEGER MaxDaysPerInstance "1–730"
        INTEGER RequiresOrderRef "0 دائماً منذ migration 012"
        TEXT GenderRestriction "NULL أو Female"
        INTEGER IsSystem "0/1 — محمي من الحذف (migration 017)"
    }

    LeaveBalances {
        INTEGER EmployeeID PK_FK
        INTEGER LeaveTypeID PK_FK
        INTEGER PayPercentage PK "100 أو 50 أو 25 — CHECK صارم (بعد migration 016)"
        INTEGER TotalBalance
    }

    Leaves {
        INTEGER LeaveID PK
        INTEGER EmployeeID FK
        INTEGER LeaveTypeID FK
        TEXT StartDate
        TEXT EndDate
        INTEGER DaysCount "> 0"
        TEXT OrderRef
        TEXT Notes
        TEXT LeaveApprover
        TEXT RequestDate
        TEXT MemoNumber
        TEXT MemoDate
        TEXT OrderNumber
        TEXT OrderDate
        INTEGER IsConfirmedOverlap "0/1 — تأكيد التداخل يدوياً (migration 018)"
        TEXT CreatedAt
    }

    EmployeeDocuments {
        INTEGER DocumentID PK
        INTEGER EmployeeID FK
        TEXT DocumentType "TIME_CARD / LEAVE_CARD"
        INTEGER DocumentYear "1950–2100"
        TEXT RelativePath UK
        INTEGER FileSize "> 0"
        INTEGER IsDeleted "0/1 — Soft Delete"
    }

    AppCounters {
        TEXT CounterKey PK "مفتاح العداد"
        INTEGER CounterValue "القيمة التراكمية المستمرة"
    }

    AuditLogs {
        INTEGER LogID PK
        TEXT Timestamp
        TEXT ActionType
        TEXT EntityType
        INTEGER EntityID
        TEXT OldValue "JSON"
        TEXT NewValue "JSON"
        TEXT Details
        INTEGER UserID "معلَّق — لا نظام مستخدمين فعلي بعد"
    }
```

---

## 2. الجداول بالتفصيل

### 2.1 `Employees` — سجل الموظفين

| العمود | النوع | القيد | الغرض |
|---|---|---|---|
| `EmployeeID` | INTEGER | **PRIMARY KEY يدوي** | ⚠️ معرّف داخلي للموظف في قاعدة البيانات ترتبط به الإجازات والمستندات. |
| `SequenceNumber` | INTEGER | **UNIQUE NOT NULL** | **رقم تسلسلي داخلي تصاعدي تراكمي مستمر** (1, 2, 3...) يُدار عبر جدول `AppCounters` ويستحيل تكراره أو تراجعه حتى عند حذف آخر موظف (أُضيف في `017` ومحمي بـ `AppCounters`). |
| `JobNumber` | TEXT | اختياري | **الرقم الوظيفي الرسمي الخارجي** الصادر من الوزارة/الدائرة، يقبل نصوصاً وأرقاماً وأصفاراً بادئة (أُضيف في `017` لفصل الرقم الوظيفي عن التسلسل الداخلي). |
| `DepartmentID` | INTEGER | `FOREIGN KEY REFERENCES Departments(DepartmentID)` | معرّف القسم الذي ينتمي له الموظف (أُضيف في `017`). يُستعلم عنه باسمه المستعار `DepartmentName` في كافة التقارير. |
| `FullName` | TEXT | `NOT NULL`, غير فارغ بعد التقليم | |
| `Gender` | TEXT | `CHECK IN ('Male','Female')` | يُستخدَم من محفز `trg_prevent_female_leave_for_male` |
| `HireDate` | TEXT | تنسيق `____-__-__` (ISO-8601) | |
| `JobTitle` | TEXT | `NOT NULL` | |
| `WorkLocation` | TEXT | اختياري | أُضيف في `002` |
| `LeaveCardNumber` | TEXT | **فريد جزئياً** (`idx_employees_leave_card_number`) — يتجاهل `NULL`/فارغ | أُضيف في `002` |
| `LeaveApprover` | TEXT | اختياري | أُضيف في `002` — قيمة افتراضية للموافق، تُستنسَخ لاحقاً إلى كل إجازة عبر `006` |
| `IsActive` | INTEGER | `CHECK IN (0,1)`, افتراضي `1` | يمنع تسجيل إجازة جديدة عند `0` عبر `trg_prevent_inactive_employee_leave` |
| `AdjustmentDays` | INTEGER | افتراضي `0` | أُضيف في `003` — تعديل يدوي على الرصيد (مثال: ترحيل من نظام سابق) |
| `IsTransferred` | INTEGER | `CHECK IN (0,1)`, افتراضي `0` | أُضيف في `015` — **لا يُعطّل الموظف** (`IsActive` يبقى `1`)؛ الموظف المنقول خارجياً يُستثنى من قوائم الإجازات النشطة، والتنبيهات المباشرة، وتقارير الأرصدة الحرجة، وإحصائيات التراكم السنوي، مع بقائه "نشطاً" رسمياً في دليل الموظفين |
| `TransferOrderNumber` / `TransferOrderDate` / `TransferNotes` | TEXT | اختياري | أُضيفت في `015` — توثيق أمر النقل الإداري |

**فهارس:** `idx_employees_sequence` (`SequenceNumber` فريد)، `idx_employees_dept` (`DepartmentID`)، `idx_employees_leave_card_number` (فريد جزئي)، `idx_employees_active_name` (`IsActive, FullName`)، `idx_employees_card` (`LeaveCardNumber`)، `idx_employees_is_transferred`.

### 2.2 `Departments` — سجل الأقسام (جديد منذ Migration 017)

| العمود | النوع | القيد | الغرض |
|---|---|---|---|
| `DepartmentID` | INTEGER | `PRIMARY KEY AUTOINCREMENT` | المعرّف الفريد للقسم. |
| `Name` | TEXT | `NOT NULL UNIQUE` | اسم القسم الرسمي المعتمد (فريد على مستوى النظام). |
| `CreatedAt` | TEXT | `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` | تاريخ ووقت إنشاء السجل. |

> **الأقسام الافتراضية (Seeded):** تم زرع 8 أقسام رسمية افتراضية معتمدة عبر الترحيل `019`: (الشؤون الإدارية، الموارد البشرية، الشؤون القانونية، الشؤون المالية والتدقيق، تقنية المعلومات، التخطيط والمتابعة، العلاقات العامة والإعلام، الصيانة والخدمات). القسم محمي من الحذف في حال ارتباطه بموظفين نشطين أو منقولين.

### 2.3 `LeaveTypes` — كتالوج أنواع الإجازات

| العمود | النوع | القيد |
|---|---|---|
| `LeaveTypeID` | INTEGER | `PRIMARY KEY AUTOINCREMENT` |
| `Name` | TEXT | `UNIQUE`, **عربي حصراً** (الأسماء الإنجليزية المكرّرة حُذفت نهائياً في `007`) |
| `MaxDaysPerInstance` | INTEGER | `CHECK > 0 AND <= 730` |
| `RequiresOrderRef` | INTEGER | `CHECK IN (0,1)` — **قيمته `0` لكل الأنواع دائماً منذ `012`** (الإلزامية أُزيلت نظامياً، العمود والمحفز `trg_enforce_order_ref` لا يزالان موجودين لكن معطَّلين فعلياً) |
| `GenderRestriction` | TEXT | `NULL` أو `'Female'` فقط |
| `IsSystem` | INTEGER | `NOT NULL DEFAULT 0` — أُضيف في `017` لحماية أنواع الإجازات الأساسية من التعديل أو الحذف العشوائي |

**كتالوج الإجازات الفعلي الحالي (13 نوعاً معتمداً، بعد إضافة نوعين في `017`):**

| الاسم | الحد الأقصى للطلب الواحد | تقييد جندري | نظامي (`IsSystem`) |
|---|---|---|---|
| إجازة اعتيادية | 30 يوماً | لا | 1 |
| إجازة مرضية | 30 يوماً | لا | 1 |
| إجازة طارئة | 7 أيام | لا | 1 |
| إجازة بدون راتب | 90 يوماً | لا | 1 |
| إجازة دراسية | 30 يوماً | لا | 1 |
| إجازة حجة | 30 يوماً | لا | 1 |
| إجازة الأمومة | 72 يوماً | **نساء فقط** | 1 |
| إجازة العدة | 130 يوماً | **نساء فقط** | 1 |
| إجازة الرضاعة | 24 يوماً | **نساء فقط** | 1 |
| دورة تدريبية | 365 يوماً | لا | 1 |
| سبب آخر | 30 يوماً | لا | 1 |
| إجازة زواج | 10 أيام | لا | 1 (أُضيف في `017`) |
| إجازة مصاحبة زوج/زوجة | 365 يوماً | لا | 1 (أُضيف في `017`) |

> ملاحظة: `MaxDaysPerInstance` هنا هو سقف الطلب الواحد على مستوى قاعدة البيانات، وهو **مستقل تماماً** عن منطق احتساب الرصيد الفعلي في `LeaveService.js` (مثال: الإجازة المرضية لها منطق توزيع هرمي بين شرائح `LeaveBalances` الثلاث بدل الاعتماد على هذا الحقل مباشرة — انظر القسم 2.4).

### 2.4 `LeaveBalances` — أرصدة الإجازات

```sql
PRIMARY KEY (EmployeeID, LeaveTypeID, PayPercentage)
PayPercentage INTEGER NOT NULL DEFAULT 100 CHECK(PayPercentage IN (100, 50, 25))
```

**هيكل الأرصدة والشرائح الثلاث (بعد N2 والترحيل 016):**
المفتاح الأساسي المركّب يتضمن `PayPercentage` كأحد أعمدة الهوية الثلاثية `(EmployeeID, LeaveTypeID, PayPercentage)` — أي أن كل موظف يملك **سطراً منفصلاً لكل نسبة راتب** ضمن نفس نوع الإجازة:
* **الإجازة الاعتيادية (`LeaveTypeID = 1`):** سطر واحد بنسبة `PayPercentage = 100` براتب كامل.
* **الإجازة المرضية (`LeaveTypeID = 2`):** موزعة على **ثلاث شرائح هرمية منفصلة** بموجب الترحيل `016`:
  1. `PayPercentage = 100` (براتب تام): سقفها الافتراضي 30 يوماً.
  2. `PayPercentage = 50` (بنصف راتب): سقفها الافتراضي 45 يوماً.
  3. `PayPercentage = 25` (بربع راتب): سقفها الافتراضي 45 يوماً.
  * **إجمالي الوعاء السنوي للإجازة المرضية:** 120 يوماً (30 + 45 + 45).

**تاريخ التعديل في Migration 016:**
كان القيد سابقاً محصوراً بقيمتين فقط `CHECK(PayPercentage IN (100, 50))`. ولأن SQLite لا يدعم تعديل قيود `CHECK` مباشرة عبر `ALTER TABLE`، قام الترحيل `016_add_sick_leave_25_percent_tier.sql` بإعادة بناء الجدول بطريقة ذرية:
1. إنشاء جدول بديل بالقيد الجديد `CHECK(PayPercentage IN (100, 50, 25))`.
2. نقل البيانات السابقة مع ترقية رصيد شريحة 100% للموظفين النشطين بيومين (من 28 إلى 30 يوماً).
3. إضافة الشريحة الثالثة (25%) برصيد 45 يوماً افتراضياً لكل موظف نشط مسجل لديه رصيد مرضي.
4. استبدال الجدول وتفعيل القيد الجديد بسلاسة دون فقدان أي بيانات.

### 2.5 `Leaves` — سجلات الإجازات الفردية

| العمود | ملاحظة |
|---|---|
| `LeaveID` | `PRIMARY KEY AUTOINCREMENT` |
| `EmployeeID`, `LeaveTypeID` | مفتاحان أجنبيان — `ON DELETE CASCADE` للموظف، `ON DELETE RESTRICT` لنوع الإجازة (لا يمكن حذف نوع إجازة له سجلات فعلية) |
| `StartDate`, `EndDate` | نص ISO-8601، مع `CHECK(EndDate >= StartDate)` **على مستوى قاعدة البيانات نفسها** — طبقة حماية ثانية إضافية فوق تحقق `_daysBetween` في JS |
| `DaysCount` | `CHECK > 0` — مخزَّن صراحة (ليس محسوباً وقت القراءة) |
| `OrderRef` | من `001` — إلزاميته مُعطَّلة فعلياً منذ `012` |
| `LeaveApprover` | أُضيف `006`، مع Backfill تلقائي للسجلات التاريخية من `Employees.LeaveApprover` وقت الترحيل |
| `RequestDate`, `MemoNumber`, `MemoDate`, `OrderNumber`, `OrderDate` | أُضيفت دفعة واحدة في `009` — توثيق إداري كامل (تاريخ الطلب، رقم/تاريخ المذكرة، رقم/تاريخ الأمر) |
| `IsConfirmedOverlap` | INTEGER NOT NULL DEFAULT 0 — **أُضيف في `018`**؛ يوثق موافقة وتأكيد المستخدم الصريح على تسجيل إجازة متداخلة زمنياً مع إجازة أخرى للموظف نفسه بعد استعراض التنبيه التحذيري |
| `CreatedAt` | `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` |

**فهارس:** `idx_leaves_dates` (`StartDate, EndDate`)، `idx_leaves_emp_type` (`EmployeeID, LeaveTypeID`)، `idx_leaves_end_start` (`EndDate, StartDate` — لفرز الإجازات النشطة حسب تاريخ العودة).

### 2.6 `EmployeeDocuments` — مستندات الموظفين (بطاقات الدوام/الإجازات)

أُنشئ بالكامل في `013`. `RelativePath` **فريد** ويمثّل مسار الملف نسبياً داخل جذر التخزين (وليس مساراً مطلقاً) — هذا هو العمود الذي يمر عبر تحقق احتواء المسار في `DocumentStorageService.js` قبل أي وصول فعلي للقرص (انظر `ARCHITECTURE.md` القسم 7). `IsDeleted` يطبّق **حذفاً ناعماً (Soft Delete)** — الملف الفيزيائي والسجل يبقيان موجودين مع علامة، لا حذف فعلي فوري، مما يسمح باسترجاع أو تنظيف دوري لاحق (`document:purgeDeleted`).

### 2.7 `AppCounters` — العدادات النظامية المستمرة (جديد)

| العمود | النوع | القيد | الغرض |
|---|---|---|---|
| `CounterKey` | TEXT | `PRIMARY KEY` | المفتاح المعرّف للعداد (مثال: `'next_employee_sequence'`). |
| `CounterValue` | INTEGER | `NOT NULL DEFAULT 1` | القيمة العددية الحالية للعداد. |

> **وظيفة حاسمة (Monotonic Persistence):** يُستخدم هذا الجدول لضمان ثبات التسلسل التصاعدي المستمر للموظفين `SequenceNumber`. عند إضافة موظف جديد، يُقرأ العداد ويُرفع بقيمة 1 ويُحفظ فوراً. ولا ينقص العداد أبداً عند حذف أي موظف (حتى لو كان آخر موظف مضاف)، مما يمنع ثغرة تكرار التسلسل نهائياً (ADR-020).

### 2.8 `AuditLogs` — سجل التدقيق (النشط حالياً)

أُنشئ في `008` ليحل محل جدول `AuditLog` الأقدم (القادم من `001`) الذي **حُذف نهائياً في `011`** مع محفزاته (`trg_audit_leave_insert`, `trg_audit_leave_delete`). البنية الجديدة أغنى بكثير: `EntityType`/`EntityID` لتحديد الكيان المتأثر بدقة، `OldValue`/`NewValue` كلقطتي JSON قبل/بعد، `Details` كملخص عربي مقروء للبشر. عمود `UserID` أُضيف في `014` **تحضيراً** لنظام مستخدمين/مصادقة مستقبلي، لكنه غير مفعَّل أو مُلزَم حالياً (لا جدول `Users` موجود بعد — القيمة تبقى `NULL` عملياً في كل السجلات الحالية).

### 2.9 جداول مساعدة (Internal / System)

| الجدول | الغرض | ملاحظة |
|---|---|---|
| `_Migrations` | تتبّع ملفات الترحيل المنفَّذة (`id` PK AUTOINCREMENT, `name` TEXT UNIQUE NOT NULL, `executedAt` TEXT NOT NULL) | تُنشأ تلقائياً برمجياً داخل `database.js` عند الإقلاع وتُستخدم كآلية تتبع Idempotent تضمن تشغيل كل ملف من `001` إلى `019` مرة واحدة فقط داخل معاملة ذرية موحدة |
| `_AppSettings` | تخزين إعدادات النظام بنمط Key-Value (`Key` PK, `Value`, `UpdatedAt`) | من `008` — تُستخدَم لمسار تخزين المستندات المخصَّص وإعدادات أخرى قابلة للتغيير من الواجهة |
| `_NotificationLog` | منع تكرار إشعار الإجازات اليومي لنفس اليوم (`notificationType`, `sentDate`, `itemCount`) | من `004` |

---

## 3. القواعد المفروضة على مستوى قاعدة البيانات (وليس JS فقط)

هذا القسم مهم تحديداً لأنه يوضّح أي قواعد عمل **لا يمكن تجاوزها حتى من مسار كود قديم أو خطأ برمجي في JS** — لأنها مفروضة بواسطة محرك SQLite نفسه:

| القاعدة | الآلية | الملف/الموضع |
|---|---|---|
| لا يجوز منح إجازة نسائية حصراً لموظف ذكر | `TRIGGER trg_prevent_female_leave_for_male` (`BEFORE INSERT ON Leaves`) | `001` |
| لا يجوز تسجيل إجازة لموظف غير نشط | `TRIGGER trg_prevent_inactive_employee_leave` (`BEFORE INSERT ON Leaves`) | `001` |
| تاريخ النهاية يجب ألا يسبق تاريخ البداية | `CHECK(EndDate >= StartDate)` على جدول `Leaves` | `001` |
| نسبة راتب الإجازة محصورة بـ 100% أو 50% أو 25% | `CHECK(PayPercentage IN (100, 50, 25))` على `LeaveBalances` | `001`، عُدِّل في `016` |
| رقم كرت الإجازة فريد لكل موظف (عند وجوده) | فهرس فريد جزئي `idx_employees_leave_card_number` | `002` |
| رقم التسلسل الداخلي فريد وغير مكرر | `UNIQUE` على `Employees.SequenceNumber` مع جدول `AppCounters` | `017` / `AppCounters` |
| اسم القسم فريد ولا يتكرر | `UNIQUE` على `Departments.Name` | `017` |
| مسار المستند فريد | `UNIQUE` على `EmployeeDocuments.RelativePath` | `013` |
| حذف موظف يحذف تلقائياً كل إجازاته وأرصدته ومستنداته | `ON DELETE CASCADE` من `Leaves`/`LeaveBalances`/`EmployeeDocuments` نحو `Employees` | `001` / `013` / `017` |
| لا يجوز حذف نوع إجازة له سجلات فعلية | `ON DELETE RESTRICT` من `Leaves` نحو `LeaveTypes` | `001` |
| لا يجوز حذف قسم مرتبط بموظفين | فحص مرجعي ومنطقي صارم في `DepartmentService` قبل الحذف | `017` |

---

## 4. سجل تطوّر المخطط (Migration History)

| # | الملف | التغيير الجوهري |
|---|---|---|
| 001 | `initial_schema` | إنشاء الجداول الخمسة الأساسية + 5 محفزات + بذرة 11 نوع إجازة |
| 002 | `add_employee_fields` | `WorkLocation`, `LeaveCardNumber` (+فهرس فريد جزئي), `LeaveApprover` |
| 003 | `add_adjustment_days` | `AdjustmentDays` على `Employees` (لقواعد بيانات قديمة سابقة لهذا الترحيل) |
| 004 | `create_notification_log` | جدول `_NotificationLog` |
| 005 | `performance_indexes` | 3 فهارس أداء أساسية |
| 006 | `add_leave_approver_to_leaves` | `LeaveApprover` على `Leaves` + Backfill تاريخي |
| 007 | `cleanup_leave_types` | حذف أنواع إجازة إنجليزية مكرّرة، إعادة ربط السجلات القديمة بالاسم العربي المعتمد |
| 008 | `create_audit_and_settings` | جدولا `AuditLogs` (الحديث) و`_AppSettings` |
| 009 | `add_leave_order_and_memo_fields` | 5 أعمدة توثيق إداري على `Leaves` |
| 010 | `additional_indexes` | فهرسان إضافيان (فرز الإجازات النشطة، بحث كرت الإجازة) |
| 011 | `cleanup_legacy_audit` | **حذف** جدول `AuditLog` القديم ومحفزاته نهائياً |
| 012 | `remove_order_ref_requirement` | تصفير `RequiresOrderRef` لكل الأنواع (تعطيل فعلي لإلزامية رقم الأمر) |
| 013 | `create_employee_documents` | جدول `EmployeeDocuments` الكامل + فهرسان |
| 014 | `prepare_audit_users` | `UserID` على `AuditLogs` (تحضير لمستقبل غير مفعَّل بعد) |
| 015 | `add_employee_transfer_fields` | 4 أعمدة نقل خارجي على `Employees` + فهرس |
| 016 | `add_sick_leave_25_percent_tier` | إعادة بناء جدول `LeaveBalances` لتعديل قيد الفحص إلى `CHECK(PayPercentage IN (100, 50, 25))`، ورفع سقف الشريحة الأولى إلى 30 يوماً براتب كامل، وإضافة الشريحة الثالثة (25% — ربع راتب) بوعاء 45 يوماً ليتطابق النظام مع نظام الخدمة المدنية (إجمالي 120 يوماً) |
| 017 | `add_departments_and_split_job_number` | إنشاء جدول `Departments`، وإعادة بناء جدول `Employees` بأمان لفصل `JobNumber` عن `SequenceNumber` وإضافة الربط بالقسم `DepartmentID`، وإضافة عمود `IsSystem` ونوعي إجازة جديدين (`إجازة زواج` و `إجازة مصاحبة زوج/زوجة`) |
| 018 | `add_leave_conflict_confirmation` | إضافة عمود `IsConfirmedOverlap` إلى جدول `Leaves` لدعم توثيق الإجازات المتداخلة المؤكدة يدوياً من المستخدم |
| 019 | `seed_default_departments` | زرع 8 أقسام رسمية افتراضية معتمدة في جدول `Departments` لضمان توفرها فور الإقلاع |

**قاعدة ذهبية عند إضافة أي ترحيل جديد مستقبلاً:** أضف سطراً هنا في نفس الالتزام (Commit)، وحدِّث القسم المقابل من هذه الوثيقة (الجدول المتأثر) — لضمان بقاء نموذج البيانات مطابقاً بنسبة 100% للواقع الفعلي.

---

*آخر تحديث: 15 أيلول 2026، مطابق لآخر ترحيل مطبَّق فعلياً (`019_seed_default_departments.sql`) وجدول `AppCounters`. مرجع تكميلي: `ARCHITECTURE.md`.*

