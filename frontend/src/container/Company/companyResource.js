import { getDetailCompanyById, getListCompany } from '../../service/userService';
import CommonUtils from '../../util/CommonUtils';
import createListCache from '../../util/listCache';

export const COMPANY_PAGE_SIZE = 6;
export const COMPANY_REUSE_FOR = 60 * 1000;

export const companyListCache = createListCache();
const companyDetailCache = createListCache({ ttl: 60 * 1000, limit: 24 });

export const loadCompanies = (page, search) =>
    companyListCache.load(JSON.stringify([page, search]), async () => {
        const result = await getListCompany({
            limit: COMPANY_PAGE_SIZE,
            offset: page * COMPANY_PAGE_SIZE,
            search: CommonUtils.removeSpace(search),
        });
        if (result?.errCode !== 0 || !Array.isArray(result.data)) throw Error();
        return { rows: result.data, count: result.count };
    }, { reuseFor: COMPANY_REUSE_FOR });

export const prefetchCompanies = (page = 0, search = '') => {
    if (typeof getListCompany !== 'function') return Promise.resolve(null);
    return loadCompanies(page, search).catch(() => null);
};

export const readPrefetchedCompanyDetail = id => {
    if (!id) return null;
    return companyDetailCache.read(String(id))?.value || null;
};

export const rememberCompanyDetail = (id, data) => {
    if (!id || !data) return;
    companyDetailCache.save(String(id), data);
};

export const prefetchCompanyDetail = id => {
    if (!id || typeof getDetailCompanyById !== 'function') return Promise.resolve(null);
    const key = String(id);
    return companyDetailCache.load(key, async () => {
        const res = await getDetailCompanyById(id);
        if (!res || res.errCode !== 0 || !res.data) throw Error();
        return res.data;
    }, { reuseFor: 30 * 1000 }).catch(() => null);
};
