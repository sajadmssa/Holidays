-- ============================================================
--  migrations/012_remove_order_ref_requirement.sql
--  إزالة إلزامية رقم الأمر الإداري لجميع أنواع الإجازات
--  (يُعطّل تلقائياً محفز trg_enforce_order_ref والتحقق البرمجي المرتبط بنفس العمود في LeaveService.js
--   لأن كليهما يعتمدان ديناميكياً على قيمة RequiresOrderRef)
-- ============================================================

UPDATE LeaveTypes SET RequiresOrderRef = 0;
