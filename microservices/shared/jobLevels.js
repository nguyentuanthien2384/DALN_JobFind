const legacyCodes = { 'nhan-vien': 'junior', 'truong-phong': 'lead', 'giam-doc': 'manager' };
export const canonicalJobLevel = code => Object.hasOwn(legacyCodes, code) ? legacyCodes[code] : code;
