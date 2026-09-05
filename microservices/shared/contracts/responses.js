import { schemas, object, text, nullable, integer, id, mongoId, date, stage } from './schemas.js';

const ref = (name) => ({ $ref: `#/$defs/${name}` });
const list = (items) => ({ type: 'array', items });
const bool = { type: 'boolean' };
const number = { type: 'number' };
// SQL drivers can return COUNT/DECIMAL as strings. Do not coerce the wire format.
const numeric = { anyOf: [number, { type: 'string', pattern: '^-?[0-9]+(\\.[0-9]+)?$' }] };
const record = (properties, required = Object.keys(properties)) => object(properties, required, true);
const bucket = record({ code: text(), count: integer() });
const namedCount = record({ ten: nullable(text()), soLuong: numeric });
const datedCount = record({ ngay: date, soLuong: numeric });
const range = record({ from: date, to: date });
const stageLabel = record({ stage, label: text() });

export const responseDefinitions = {
    ...schemas,
    Suggestion: record({ id, name: text(), companyName: nullable(text()), addressCode: nullable(text()) }, ['id', 'name']),
    SearchJob: record({ id, name: text(), statusCode: text(), _score: nullable(number), _highlight: nullable(text(200000)) }, ['id', 'name']),
    Facets: record({ categories: list(bucket), provinces: list(bucket), salaries: list(bucket) }),
    StageLabel: stageLabel,
    Board: record({ columns: list(record({ ...stageLabel.properties, items: list(ref('Application')), count: integer() })), total: integer() }),
    Funnel: record({ funnel: list(record({ ...stageLabel.properties, count: integer(), avgRating: nullable(numeric) })), total: integer(), hired: integer(), conversionRate: number }),
    ApplicationNote: record({ id, application_id: id, author_id: nullable(id), body: text(5000), created_at: date }),
    MyApplication: record({ id, job_id: id, job_title: nullable(text()), stage, stageLabel: text(), applied_at: date, stage_changed_at: date }),
    Talent: record({ id, candidate_id: id, company_id: nullable(id), candidate_name: nullable(text()), tags: list(text()), note: nullable(text()), saved_at: date }, ['id', 'candidate_id']),
    Audit: record({ _id: mongoId, kind: { enum: ['event', 'action'] }, name: text(2048), payload: {}, createdAt: date }, ['_id', 'kind', 'name']),
    Master: record({ code: text(), value: text(), type: text(), aliases: list(text()), group: nullable(text()), weight: number, isActive: bool, description: nullable(text()), hasTag: bool }),
    Tag: record({ _id: mongoId, type: text(), code: nullable(text()), name: text(), aliases: list(text()), weight: number, isActive: bool }, ['_id', 'type', 'name']),
    AliasMap: { type: 'object', additionalProperties: record({ code: nullable(text()), type: text(), name: text() }) },
    ReportOverview: record({ khoangThoiGian: range, nguoiDung: record({ tong: numeric, moi: numeric }), congTy: numeric,
        tinTuyenDung: record({ dangHienThi: numeric, choDuyet: numeric }), hoSoUngTuyen: record({ tong: numeric, daTuyen: numeric }),
        doanhThu: record({ goiTin: number, goiXemCv: number, tong: number }) }),
    ReportTimeseries: record({ tinTuyenDung: list(datedCount), nguoiDungMoi: list(datedCount), doanhThu: list(record({ ngay: date, tien: number })), hoSoUngTuyen: list(datedCount) }),
    ReportDistribution: record(Object.fromEntries(['theoNganhNghe', 'theoTinhThanh', 'theoMucLuong', 'theoVaiTro'].map((key) => [key, list(namedCount)]))),
    ReportFunnel: record({ pheu: list(record({ stage, ten: text(), soLuong: integer() })), tong: integer(), tyLeTuyen: number,
        topCongTy: list(record({ congTyId: nullable(id), soHoSo: integer(), daTuyen: integer() })) }),
    ReportActivity: record({ theoLoai: list(namedCount), theoService: list(namedCount), theoNgay: list(datedCount) }),
    SyncResult: record({ total: integer(), imported: integer(), error: text(20000) }, ['total', 'imported']),
    ReindexResponse: record({ errCode: { const: 0 }, indexed: integer(), reconciliation: record({ total: integer(), changed: integer(), deleted: integer() }) })
};
const resultNames = {
    searchJobs: 'SearchJob', searchSuggest: 'Suggestion', searchFacets: 'Facets', searchRelated: 'SearchJob',
    applicationStages: 'StageLabel', applicationBoard: 'Board', applicationFunnel: 'Funnel', applicationNote: 'ApplicationNote',
    myApplications: 'MyApplication', talentList: 'Talent', talentSave: 'Talent',
    auditList: 'Audit', auditTarget: 'Audit', masterList: 'Master', masterSave: 'Tag', aliasMap: 'AliasMap',
    ...Object.fromEntries(['Overview', 'Timeseries', 'Distribution', 'Funnel', 'Activity'].map((name) => [`report${name}`, `Report${name}`])),
    applicationSync: 'SyncResult'
};

// Response validation is a CI assertion, never a post-commit production filter:
// replacing a successful write with 500 could make clients repeat that write.
export const successSchema = (operation) => {
    if (operation.id === 'searchReindex') return ref('ReindexResponse');
    if (['Ack', 'AcceptedTask'].includes(operation.response)) return ref(operation.response);
    const result = ref(resultNames[operation.id] || operation.response);
    return record({ errCode: operation.id === 'applicationSync' ? { enum: [0, -1] } : { const: 0 },
        data: operation.list ? list(result) : result, count: integer(), took: integer(), emailQueued: bool,
        errMessage: text(1000) }, ['errCode', 'data']);
};

export const responseValidationSchema = (operation) => ({ $defs: responseDefinitions, ...successSchema(operation) });
