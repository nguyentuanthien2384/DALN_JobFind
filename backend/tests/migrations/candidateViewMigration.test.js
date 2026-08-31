const migration = require('../../src/migrations/migrationzz-create-candidateview');

describe('CandidateViews migration', () => {
  const queryInterface = {
    createTable: jest.fn(),
    addConstraint: jest.fn(),
    addIndex: jest.fn(),
    dropTable: jest.fn()
  };
  const Sequelize = {
    INTEGER: 'INTEGER',
    DATE: 'DATE',
    ENUM: jest.fn((...values) => ({ type: 'ENUM', values }))
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(queryInterface).forEach((method) => method.mockResolvedValue(undefined));
  });

  test('creates foreign keys, the company-candidate unique constraint and lookup index', async () => {
    await migration.up(queryInterface, Sequelize);

    const [, columns] = queryInterface.createTable.mock.calls[0];
    expect(queryInterface.createTable).toHaveBeenCalledWith('CandidateViews', expect.any(Object));
    expect(columns.companyId).toEqual(expect.objectContaining({
      allowNull: false,
      references: { model: 'Companies', key: 'id' },
      onDelete: 'CASCADE'
    }));
    expect(columns.candidateId).toEqual(expect.objectContaining({
      allowNull: false,
      references: { model: 'Users', key: 'id' },
      onDelete: 'CASCADE'
    }));
    expect(Sequelize.ENUM).toHaveBeenCalledWith('FREE', 'PAID');
    expect(queryInterface.addConstraint).toHaveBeenCalledWith('CandidateViews', {
      fields: ['companyId', 'candidateId'],
      type: 'unique',
      name: 'candidate_views_company_candidate_unique'
    });
    expect(queryInterface.addIndex).toHaveBeenCalledWith('CandidateViews', ['candidateId'], {
      name: 'candidate_views_candidate_idx'
    });
  });

  test('rolls back by dropping the entitlement table', async () => {
    await migration.down(queryInterface);
    expect(queryInterface.dropTable).toHaveBeenCalledWith('CandidateViews');
  });
});
