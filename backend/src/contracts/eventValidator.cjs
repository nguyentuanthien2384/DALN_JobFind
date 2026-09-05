// Canonical runtime. scripts/event-contracts.mjs copies this file into the standalone backend.
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats').default;

module.exports = (catalog) => {
    const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true });
    addFormats(ajv);
    ajv.addFormat('jobfind-id', { type: 'string', validate: (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 });
    const validators = new Map(Object.entries(catalog).map(([key, contract]) => [key, ajv.compile(contract.schema)]));
    const fail = (code) => { throw Object.assign(new Error(code), { code }); };
    const contractOf = (type, version) => {
        if (version !== 1) fail('EVENT_PAYLOAD_VERSION_UNSUPPORTED');
        if (!Object.hasOwn(catalog, type)) fail('EVENT_TYPE_UNSUPPORTED');
        return catalog[type];
    };
    const target = (contract, data) => {
        const field = typeof contract.aggregateField === 'string' ? contract.aggregateField : contract.aggregateField[data.type];
        return field?.split('.').reduce((value, key) => value?.[key], data);
    };
    const assertEventPayload = (type, data, { version = 1, aggregateId } = {}) => {
        const contract = contractOf(type, version);
        if (!validators.get(type)(data)) fail('EVENT_PAYLOAD_INVALID');
        const aggregate = target(contract, data);
        if (aggregateId !== undefined && String(aggregateId) !== String(aggregate)) fail('EVENT_AGGREGATE_MISMATCH');
        let json;
        try { json = JSON.stringify(data); } catch { fail('EVENT_PAYLOAD_INVALID'); }
        if (Buffer.byteLength(json, 'utf8') > contract.maxBytes) fail('EVENT_PAYLOAD_TOO_LARGE');
        return String(aggregate);
    };
    const serializeEventPayload = (type, data, options) => {
        let json;
        let payload;
        try { json = JSON.stringify(data); payload = JSON.parse(json); } catch { fail('EVENT_PAYLOAD_INVALID'); }
        const aggregateId = assertEventPayload(type, payload, options);
        return { json, payload, aggregateId };
    };
    return { assertEventPayload, serializeEventPayload };
};
