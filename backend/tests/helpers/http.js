const createResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => body);
  res.setHeader = jest.fn();
  return res;
};

const createRequest = (overrides = {}) => ({
  body: {},
  query: {},
  headers: {},
  path: '/test',
  ip: '127.0.0.1',
  user: {
    id: 7,
    companyId: 11,
    userCompanyData: { id: 11, statusCode: 'S1', censorCode: 'CS1' },
    userAccountData: { roleCode: 'EMPLOYER' }
  },
  ...overrides
});

module.exports = { createRequest, createResponse };
