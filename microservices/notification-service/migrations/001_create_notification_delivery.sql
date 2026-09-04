CREATE TABLE IF NOT EXISTS notification_inbox (
    eventId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recipientId BIGINT UNSIGNED NOT NULL,
    notificationId BIGINT UNSIGNED NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (eventId, recipientId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    eventId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recipientId BIGINT UNSIGNED NOT NULL,
    channel VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload LONGTEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    nextAttemptAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    lockedAt DATETIME(3) NULL,
    lockToken CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lastError VARCHAR(500) NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY notification_delivery_event_recipient_channel (eventId, recipientId, channel),
    KEY notification_delivery_pending (status, nextAttemptAt, id),
    KEY notification_delivery_recovery (status, lockedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
