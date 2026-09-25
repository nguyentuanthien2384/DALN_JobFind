'use strict';

const { randomUUID } = require('node:crypto');
const { serializeEventPayload } = require('../contracts/eventValidator.cjs')(require('../contracts/events.v1.json').events);

const levels = [
  ['intern', 'Intern'], ['fresher', 'Fresher'], ['junior', 'Junior'],
  ['middle', 'Middle'], ['senior', 'Senior'], ['lead', 'Lead'], ['manager', 'Manager'],
];
const aliases = { 'nhan-vien': 'junior', 'truong-phong': 'lead', 'giam-doc': 'manager' };

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableNames = await queryInterface.showAllTables();
    const table = name => {
      const found = tableNames.find(item => String(item).toLowerCase() === name);
      if (!found) throw new Error(`Missing ${name}: cannot migrate IT job levels.`);
      return found;
    };
    const allcodes = table('allcodes'), details = table('detailposts'), posts = table('posts');
    const quote = name => queryInterface.queryGenerator.quoteTable(name);
    const quoteColumn = name => queryInterface.queryGenerator.quoteIdentifier(name);
    const select = (sql, transaction, replacements = []) => queryInterface.sequelize.query(sql, {
      type: Sequelize.QueryTypes.SELECT, transaction, replacements,
    });

    return queryInterface.sequelize.transaction(async transaction => {
      // DDL is deliberately excluded: all data changes and sync intents must roll back together.
      const engines = await select(`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()`, transaction);
      const assertTransactional = name => {
        if (!engines.some(row => row.name.toLowerCase() === name.toLowerCase() && row.engine?.toUpperCase() === 'INNODB')) {
          throw new Error(`${name} must use InnoDB before migrating IT job levels.`);
        }
      };
      [allcodes, details, posts].forEach(assertTransactional);
      const rows = await select(`SELECT code, type FROM ${quote(allcodes)} FOR UPDATE`, transaction);
      for (const [code, value] of levels) {
        const existing = rows.find(row => row.code.toLowerCase() === code);
        if (existing && existing.type !== 'JOBLEVEL') {
          throw new Error(`Cannot use ${code} for JOBLEVEL: it belongs to ${existing.type}.`);
        }
        // Once canonical, administrator edits to the display name remain authoritative.
        if (!existing) {
          await queryInterface.bulkInsert(allcodes, [{ code, type: 'JOBLEVEL', value, image: '' }], { transaction });
        }
      }
      for (const code of Object.keys(aliases)) {
        const existing = rows.find(row => row.code.toLowerCase() === code);
        if (existing && existing.type !== 'JOBLEVEL') {
          throw new Error(`Cannot migrate ${code}: it belongs to ${existing.type}.`);
        }
      }

      const legacyCodes = Object.keys(aliases);
      const placeholders = legacyCodes.map(() => '?').join(', ');
      // Lock affected jobs before their details, matching the normal job edit lock order.
      const affected = await select(`SELECT p.id, p.statusCode, d.name, d.categoryJoblevelCode
        FROM ${quote(posts)} p JOIN ${quote(details)} d ON d.id = p.detailPostId
        WHERE d.categoryJoblevelCode IN (${placeholders}) ORDER BY p.id FOR UPDATE`, transaction, legacyCodes);
      if (affected.length) assertTransactional(table('outbox_events'));
      for (const [oldCode, newCode] of Object.entries(aliases)) {
        await queryInterface.bulkUpdate(details, { categoryJoblevelCode: newCode }, { categoryJoblevelCode: oldCode }, { transaction });
      }

      // Allcodes is also referenced by other classifications. Never silently repurpose those values.
      const references = await select(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
        FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
        AND LOWER(REFERENCED_TABLE_NAME) = 'allcodes' AND REFERENCED_COLUMN_NAME = 'code'`, transaction);
      for (const reference of references) {
        const remaining = await select(`SELECT ${quoteColumn(reference.columnName)} FROM ${quote(reference.tableName)}
          WHERE ${quoteColumn(reference.columnName)} IN (${placeholders}) LIMIT 1`, transaction, legacyCodes);
        if (remaining.length) throw new Error(`Legacy job level still used by ${reference.tableName}.${reference.columnName}; no changes applied.`);
      }
      for (const code of legacyCodes) {
        await queryInterface.bulkDelete(allcodes, { code, type: 'JOBLEVEL' }, { transaction });
      }
      for (const row of affected) {
        // Search treats events as invalidations and reads the authoritative current job from Core.
        const job = { id: row.id, name: row.name, statusCode: row.statusCode,
          categoryJoblevelCode: aliases[row.categoryJoblevelCode.toLowerCase()] };
        const { json, aggregateId } = serializeEventPayload('job.updated', { job }, { aggregateId: row.id });
        await queryInterface.bulkInsert(table('outbox_events'), [{ id: randomUUID(), aggregateType: 'legacy-job',
          aggregateId, eventType: 'job.updated', payload: json, createdAt: new Date() }], { transaction });
      }
      return { updatedPosts: affected.length, levels: levels.map(([code]) => code) };
    });
  },
  async down() {
    throw new Error('Canonical IT job levels are in use. Restore a verified pre-migration backup to roll back.');
  },
};
