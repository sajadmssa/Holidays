-- ============================================================
--  migrations/004_create_notification_log.sql
--  Creates the notification log table to track sent alerts
--  and prevent duplicate daily notifications.
-- ============================================================

CREATE TABLE IF NOT EXISTS _NotificationLog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notificationType TEXT NOT NULL,
    sentDate TEXT NOT NULL,
    itemCount INTEGER NOT NULL,
    sentAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
