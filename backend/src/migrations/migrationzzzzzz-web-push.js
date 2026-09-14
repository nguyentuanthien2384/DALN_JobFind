module.exports = {
  async up(q, S) {
    const tables = (await q.showAllTables()).map((t) =>
      String(t).toLowerCase(),
    );
    const timestamps = {
      createdAt: { type: S.DATE, allowNull: false },
      updatedAt: { type: S.DATE, allowNull: false },
    };
    if (!tables.includes("webpushsubscriptions"))
      await q.createTable("WebPushSubscriptions", {
        id: { type: S.STRING(64), primaryKey: true },
        userId: { type: S.INTEGER, allowNull: false },
        generation: { type: S.STRING(36), allowNull: false },
        endpoint: { type: S.TEXT, allowNull: false },
        p256dh: { type: S.STRING(100), allowNull: false },
        auth: { type: S.STRING(32), allowNull: false },
        expiresAt: { type: S.DATE, allowNull: false },
        ...timestamps,
      });
    if (!tables.includes("webpushdeliveries"))
      await q.createTable("WebPushDeliveries", {
        id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
        messageId: { type: S.INTEGER, allowNull: false },
        subscriptionId: { type: S.STRING(64), allowNull: false },
        generation: { type: S.STRING(36), allowNull: false },
        userId: { type: S.INTEGER, allowNull: false },
        status: {
          type: S.STRING(16),
          allowNull: false,
          defaultValue: "pending",
        },
        attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
        nextAttemptAt: { type: S.DATE, allowNull: false },
        lease: { type: S.STRING(36) },
        leaseUntil: { type: S.DATE },
        lastCode: { type: S.STRING(24) },
        ...timestamps,
      });
    for (const [table, name, fields, unique] of [
      ["WebPushSubscriptions", "idx_push_user", ["userId"], false],
      [
        "WebPushDeliveries",
        "uq_push_message_device",
        ["messageId", "subscriptionId", "generation"],
        true,
      ],
      ["WebPushDeliveries", "idx_push_due", ["status", "nextAttemptAt"], false],
    ])
      if (!(await q.showIndex(table)).some((i) => i.name === name))
        await q.addIndex(table, fields, { name, unique });
  },
  async down(q) {
    await q.dropTable("WebPushDeliveries");
    await q.dropTable("WebPushSubscriptions");
  },
};
