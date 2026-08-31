const migration = require('../../src/migrations/migration-payment-integrity');

describe('payment integrity migration', () => {
  const queryInterface = {
    createTable: jest.fn(),
    addIndex: jest.fn(),
    addColumn: jest.fn(),
    removeColumn: jest.fn(),
    dropTable: jest.fn()
  };
  const Sequelize = {
    INTEGER: 'INTEGER',
    DATE: 'DATE',
    STRING: jest.fn((length) => `STRING(${length})`),
    DECIMAL: jest.fn((precision, scale) => `DECIMAL(${precision},${scale})`)
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(queryInterface).forEach((method) => method.mockResolvedValue(undefined));
  });

  test('creates the server-side intent ledger with immutable payment snapshots and unique provider keys', async () => {
    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.createTable).toHaveBeenCalledWith('PaymentIntents', expect.objectContaining({
      providerPaymentId: expect.objectContaining({ allowNull: false }),
      providerToken: expect.objectContaining({ allowNull: false }),
      userId: expect.objectContaining({
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'RESTRICT'
      }),
      companyId: expect.objectContaining({
        allowNull: false,
        references: { model: 'Companies', key: 'id' },
        onDelete: 'RESTRICT'
      }),
      packageType: expect.objectContaining({ allowNull: false }),
      packageId: expect.objectContaining({ allowNull: false }),
      quantity: expect.objectContaining({ allowNull: false }),
      unitPrice: expect.objectContaining({ allowNull: false }),
      totalPrice: expect.objectContaining({ allowNull: false }),
      entitlementType: expect.objectContaining({ allowNull: false }),
      entitlementAmount: expect.objectContaining({ allowNull: false }),
      status: expect.objectContaining({ allowNull: false, defaultValue: 'PENDING' }),
      expiresAt: expect.objectContaining({ allowNull: false })
    }));
    expect(queryInterface.addIndex).toHaveBeenCalledWith('PaymentIntents', ['providerPaymentId'], {
      name: 'UX_PaymentIntents_ProviderPaymentId', unique: true
    });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('PaymentIntents', ['providerToken'], {
      name: 'UX_PaymentIntents_ProviderToken', unique: true
    });
  });

  test('links both purchase-history tables to one unique intent for database-level replay protection', async () => {
    await migration.up(queryInterface, Sequelize);

    for (const table of ['OrderPackages', 'OrderPackageCVs']) {
      expect(queryInterface.addColumn).toHaveBeenCalledWith(table, 'paymentIntentId', expect.objectContaining({
        allowNull: true,
        unique: true,
        references: { model: 'PaymentIntents', key: 'id' },
        onDelete: 'RESTRICT'
      }));
    }
  });

  test('rolls back dependent columns before dropping the intent ledger', async () => {
    await migration.down(queryInterface);

    expect(queryInterface.removeColumn.mock.calls).toEqual([
      ['OrderPackageCVs', 'paymentIntentId'],
      ['OrderPackages', 'paymentIntentId']
    ]);
    expect(queryInterface.dropTable).toHaveBeenCalledWith('PaymentIntents');
  });
});
