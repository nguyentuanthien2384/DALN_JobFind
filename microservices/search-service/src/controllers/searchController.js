import { es, INDEX } from '../libs/elastic.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('search-service');

const publicJobFilter = () => [
    { term: { statusCode: 'PS1' } },
    { term: { companyStatusCode: 'S1' } },
    { term: { companyCensorCode: 'CS1' } }
];

// Tim kiem sieu toc: loc theo tag/luong bang term query, tim theo chu bang
// multi_match. Tat ca chay tren Elasticsearch nen khong dung toi MySQL.
export const searchJobs = async (req, res) => {
    const {
        q, categoryJobCode, addressCode, salaryJobCode,
        categoryJoblevelCode, categoryWorktypeCode, experienceJobCode,
        isHot, sort = 'relevance', limit = 12, offset = 0
    } = req.query;

    // Nguoi tim viec chi duoc thay tin da duyet va dang hien thi.
    const filter = publicJobFilter();
    const must = [];

    const addTerm = (field, value) => {
        if (value !== undefined && value !== null && value !== '' && value !== 'undefined') {
            filter.push({ term: { [field]: value } });
        }
    };
    addTerm('categoryJobCode', categoryJobCode);
    addTerm('addressCode', addressCode);
    addTerm('salaryJobCode', salaryJobCode);
    addTerm('categoryJoblevelCode', categoryJoblevelCode);
    addTerm('categoryWorktypeCode', categoryWorktypeCode);
    addTerm('experienceJobCode', experienceJobCode);
    if (isHot === '1' || isHot === 'true') filter.push({ term: { isHot: true } });

    if (q && String(q).trim() && q !== 'undefined') {
        must.push({
            multi_match: {
                query: String(q).trim(),
                // Ten tin quan trong hon mo ta, nen nhan he so 3.
                fields: ['name^3', 'companyName^2', 'description'],
                fuzziness: 'AUTO',
                operator: 'or'
            }
        });
    }

    // Khong co tu khoa thi diem lien quan deu bang nhau, luc do sap theo thoi gian
    // moi co y nghia.
    const sortClause = sort === 'newest' || !must.length
        ? [{ isHot: 'desc' }, { timePost: 'desc' }]
        : ['_score', { isHot: 'desc' }];

    try {
        const result = await es.search({
            index: INDEX,
            from: Number(offset) || 0,
            size: Math.min(Number(limit) || 12, 100),
            query: { bool: { must: must.length ? must : [{ match_all: {} }], filter } },
            sort: sortClause,
            // Tra ve doan van ban co chua tu khoa de hien thi trong ket qua.
            highlight: q ? { fields: { description: { fragment_size: 150, number_of_fragments: 1 } } } : undefined
        });

        const data = result.hits.hits.map((hit) => ({
            ...hit._source,
            _score: hit._score,
            _highlight: hit.highlight?.description?.[0] || null
        }));

        return res.json({
            errCode: 0,
            data,
            count: result.hits.total?.value ?? data.length,
            took: result.took
        });
    } catch (error) {
        logger.error('tim kiem that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không thực hiện được tìm kiếm' });
    }
};

// Goi y tu khoa khi nguoi dung dang go.
export const suggest = async (req, res) => {
    const { q } = req.query;
    if (!q || String(q).trim().length < 2) {
        return res.json({ errCode: 0, data: [] });
    }

    try {
        const result = await es.search({
            index: INDEX,
            size: 8,
            query: {
                bool: {
                    filter: publicJobFilter(),
                    must: [{
                        // match_phrase_prefix hop voi goi y khi go do: no khop
                        // tu cuoi cung nhu mot tien to.
                        match_phrase_prefix: { name: { query: String(q).trim(), max_expansions: 20 } }
                    }]
                }
            },
            _source: ['id', 'name', 'companyName', 'addressCode']
        });
        return res.json({ errCode: 0, data: result.hits.hits.map((h) => h._source) });
    } catch (error) {
        logger.error('goi y that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// Dem so tin theo tung nganh nghe - dung cho khoi danh muc o trang chu.
export const facets = async (req, res) => {
    try {
        const result = await es.search({
            index: INDEX,
            size: 0,
            query: { bool: { filter: publicJobFilter() } },
            aggs: {
                byCategory: { terms: { field: 'categoryJobCode', size: 30 } },
                byProvince: { terms: { field: 'addressCode', size: 30 } },
                bySalary: { terms: { field: 'salaryJobCode', size: 20 } }
            }
        });
        const shape = (agg) => (agg?.buckets || []).map((b) => ({ code: b.key, count: b.doc_count }));
        return res.json({
            errCode: 0,
            data: {
                categories: shape(result.aggregations?.byCategory),
                provinces: shape(result.aggregations?.byProvince),
                salaries: shape(result.aggregations?.bySalary)
            }
        });
    } catch (error) {
        logger.error('thong ke that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// Tin lien quan: dung More Like This de tim tin giong voi tin dang xem.
export const related = async (req, res) => {
    const jobId = String(req.params.id);
    try {
        const result = await es.search({
            index: INDEX,
            size: Math.min(Number(req.query.limit) || 6, 20),
            query: {
                bool: {
                    filter: publicJobFilter(),
                    must_not: [{ term: { id: Number(jobId) } }],
                    must: [{
                        more_like_this: {
                            fields: ['name', 'description'],
                            like: [{ _index: INDEX, _id: jobId }],
                            min_term_freq: 1,
                            min_doc_freq: 1
                        }
                    }]
                }
            }
        });
        return res.json({ errCode: 0, data: result.hits.hits.map((h) => h._source) });
    } catch (error) {
        logger.error('tim tin lien quan that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};
