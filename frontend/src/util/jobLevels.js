const legacyCodes = Object.freeze({ 'nhan-vien': 'junior', 'truong-phong': 'lead', 'giam-doc': 'manager' });

// Old bookmarks and unsent form drafts can outlive the catalog migration.
export const canonicalJobLevel = code => Object.prototype.hasOwnProperty.call(legacyCodes, code) ? legacyCodes[code] : code;
export const canonicalJobLevelFilter = value => Array.isArray(value)
    ? [...new Set(value.map(canonicalJobLevel))] : canonicalJobLevel(value);
