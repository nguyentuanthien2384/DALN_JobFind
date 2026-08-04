import { Tag } from '../models/Tag.js';
import { mysqlPool } from '../libs/sources.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('admin-service');

const actorId = (req) => (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null);

// Xem master data goc trong MySQL kem lop tag phu ben tren.
//
// Gop hai nguon lai o day de man hinh quan tri chi phai goi mot API: ma goc va
// phan bo nghia them (tu dong nghia, nhom, do noi bat) luon di cung nhau.
export const listMasterData = async (req, res) => {
    const type = req.query.type;
    try {
        const [codes] = type
            ? await mysqlPool.query(
                'SELECT code, value, type FROM allcodes WHERE type = ? ORDER BY code', [type])
            : await mysqlPool.query('SELECT code, value, type FROM allcodes ORDER BY type, code');

        const tags = await Tag.find(type ? { type } : {}).lean();
        const tagByKey = new Map(tags.map((t) => [`${t.type}|${t.code}`, t]));

        const data = codes.map((c) => {
            const tag = tagByKey.get(`${c.type}|${c.code}`);
            return {
                code: c.code,
                value: c.value,
                type: c.type,
                // Phan nay do Admin Service quan ly, khong nam trong allcodes.
                aliases: tag?.aliases ?? [],
                group: tag?.group ?? null,
                weight: tag?.weight ?? 0,
                isActive: tag?.isActive ?? true,
                description: tag?.description ?? null,
                hasTag: Boolean(tag)
            };
        });

        return res.json({ errCode: 0, data, count: data.length });
    } catch (error) {
        logger.error('doc master data that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được dữ liệu danh mục' });
    }
};

// Dat/cap nhat phan bo nghia cho mot ma.
export const upsertTag = async (req, res) => {
    const { code, type, name, aliases, group, weight, isActive, description } = req.body || {};
    if (!type) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu loại danh mục (type)' });
    }

    try {
        // Neu ma nay ton tai trong allcodes thi phai dung ten goc, tranh hai noi
        // hien thi hai ten khac nhau cho cung mot thu.
        let resolvedName = name;
        if (code) {
            const [rows] = await mysqlPool.query(
                'SELECT value FROM allcodes WHERE code = ? AND type = ?', [code, type]);
            if (rows.length) resolvedName = rows[0].value;
        }
        if (!resolvedName) {
            return res.status(400).json({ errCode: 1, errMessage: 'Thiếu tên danh mục' });
        }

        const tag = await Tag.findOneAndUpdate(
            { type, code: code ?? null },
            {
                type,
                code: code ?? null,
                name: resolvedName,
                slug: String(resolvedName).toLowerCase().replace(/\s+/g, '-'),
                ...(aliases !== undefined && { aliases }),
                ...(group !== undefined && { group }),
                ...(weight !== undefined && { weight }),
                ...(isActive !== undefined && { isActive }),
                ...(description !== undefined && { description }),
                createdBy: actorId(req),
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        logger.info('da cap nhat tag', { type, code, actor: actorId(req) });
        return res.json({ errCode: 0, data: tag });
    } catch (error) {
        logger.error('cap nhat tag that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không lưu được danh mục' });
    }
};

export const deleteTag = async (req, res) => {
    try {
        const result = await Tag.findByIdAndDelete(req.params.id);
        if (!result) {
            return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy danh mục' });
        }
        // Chi xoa lop bo nghia; ma goc trong allcodes van con nguyen.
        return res.json({ errCode: 0, errMessage: 'Đã xóa phần bổ nghĩa (mã gốc vẫn giữ nguyên)' });
    } catch (error) {
        logger.error('xoa tag that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// Search Service co the goi de mo rong truy van bang tu dong nghia.
export const aliasMap = async (req, res) => {
    try {
        const tags = await Tag.find({ isActive: true, aliases: { $ne: [] } })
            .select('code type aliases name').lean();
        const map = {};
        for (const t of tags) {
            for (const alias of t.aliases) {
                map[alias.toLowerCase()] = { code: t.code, type: t.type, name: t.name };
            }
        }
        return res.json({ errCode: 0, data: map, count: Object.keys(map).length });
    } catch (error) {
        logger.error('doc bang dong nghia that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};
