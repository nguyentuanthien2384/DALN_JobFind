// Canonical runtime. scripts/event-contracts.mjs copies this file into the standalone backend.
//
// ===== HOP DONG SU KIEN BANG JSON SCHEMA (thu vien AJV, draft 2020-12) =====
// Moi loai su kien trong eventCatalog.js co mot JSON Schema. Ben GUI goi
// serializeEventPayload truoc khi ghi outbox, ben NHAN goi assertEventPayload khi doc
// tin (eventEnvelope.js) => ca hai phia cung kiem tra mot schema, sai thi bao loi
// ngay thay vi de du lieu hong lan sang service khac.
// - Ajv compile schema thanh ham kiem tra mot lan luc khoi dong (nhanh hon kiem tra tay).
// - strict: true: schema viet sai (tu khoa la, kieu mo ho) bi bao loi ngay khi compile.
// - coerceTypes/useDefaults/removeAdditional = false: KHONG tu sua du lieu - payload phai
//   dung nhu khai bao, khong am tham ep kieu "5" thanh 5 hay xoa truong thua.
// - aggregateField: id trong payload phai khop aggregateId tren envelope (chong gui
//   nham su kien cua ho so nay cho ho so khac); maxBytes chan payload qua lon.
// - payloadVersion: hien chi co v1; doi cau truc thi them phien ban moi, khong sua v1.
// Tu catalog nay, scripts/event-contracts.mjs sinh file JSON Schema trong
// microservices/contracts/events; CI kiem tra file sinh ra khop voi ma nguon.
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
