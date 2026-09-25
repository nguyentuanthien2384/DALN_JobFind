'use strict';

// Preserve the existing keys used by job posts, saved URLs and the search index.
const levels = [
  ['intern', 'Intern'],
  ['fresher', 'Fresher'],
  ['nhan-vien', 'Junior'],
  ['middle', 'Middle'],
  ['senior', 'Senior'],
  ['truong-phong', 'Lead'],
  ['giam-doc', 'Manager'],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const table = tables.find(name => String(name).toLowerCase() === 'allcodes');
    if (!table) throw new Error('Allcodes must exist before migrating IT job levels.');
    await queryInterface.sequelize.transaction(async transaction => {
      const rows = await queryInterface.sequelize.query(
        `SELECT code, type FROM ${queryInterface.queryGenerator.quoteTable(table)}`,
        { type: Sequelize.QueryTypes.SELECT, transaction },
      );
      for (const [code, value] of levels) {
        const existing = rows.find(row => row.code.toLowerCase() === code);
        if (existing && existing.type !== 'JOBLEVEL') {
          throw new Error(`Cannot use ${code} for JOBLEVEL: it belongs to ${existing.type}.`);
        }
        if (existing) {
          await queryInterface.bulkUpdate(table, { value }, { code: existing.code, type: 'JOBLEVEL' }, { transaction });
        } else {
          await queryInterface.bulkInsert(table, [{ code, type: 'JOBLEVEL', value, image: '' }], { transaction });
        }
      }
    });
  },
  async down() {
    throw new Error('Keep IT job levels on rollback: new job posts may reference them.');
  },
};
