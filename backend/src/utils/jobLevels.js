const legacyCodes = { 'nhan-vien': 'junior', 'truong-phong': 'lead', 'giam-doc': 'manager' };
export const canonicalJobLevel = code => Object.prototype.hasOwnProperty.call(legacyCodes, code) ? legacyCodes[code] : code;
