CREATE TABLE IF NOT EXISTS outbox_events (
    id             CHAR(36) NOT NULL,
    aggregateType  VARCHAR(64) NOT NULL,
    aggregateId    VARCHAR(128) NOT NULL,
    eventType      VARCHAR(128) NOT NULL,
    payload        LONGTEXT NOT NULL,
    attempts       INT UNSIGNED NOT NULL DEFAULT 0,
    lastError      TEXT NULL,
    nextAttemptAt  DATETIME(3) NULL,
    lockedAt       DATETIME(3) NULL,
    lockToken      CHAR(36) NULL,
    createdAt      DATETIME(3) NOT NULL,
    publishedAt    DATETIME(3) NULL,
    PRIMARY KEY (id),
    INDEX idx_outbox_pending (publishedAt, nextAttemptAt, createdAt),
    INDEX idx_outbox_lock (lockedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
