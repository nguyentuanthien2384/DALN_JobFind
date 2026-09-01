import {
    checkFavoritePostService,
    getDetailPostByIdService,
    getRelatedPostService,
} from "../../service/userService";

const DETAIL_CACHE_TTL = 60 * 1000;
const detailCache = new Map();
const pendingRequests = new Map();

const requestOnce = (key, request) => {
    const pendingRequest = pendingRequests.get(key);
    if (pendingRequest) return pendingRequest;

    const nextRequest = Promise.resolve()
        .then(request)
        .finally(() => pendingRequests.delete(key));

    pendingRequests.set(key, nextRequest);
    return nextRequest;
};

export const getCachedJobDetail = (id) => {
    const cacheKey = String(id);
    const cached = detailCache.get(cacheKey);

    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        detailCache.delete(cacheKey);
        return null;
    }

    return cached.data;
};

export const loadJobDetail = (id) => {
    const cacheKey = String(id);
    const cachedData = getCachedJobDetail(cacheKey);

    if (cachedData) {
        return Promise.resolve({ errCode: 0, data: cachedData });
    }

    return requestOnce(`detail:${cacheKey}`, () => getDetailPostByIdService(id))
        .then((response) => {
            if (response?.errCode === 0 && response.data) {
                detailCache.set(cacheKey, {
                    data: response.data,
                    expiresAt: Date.now() + DETAIL_CACHE_TTL,
                });
            }
            return response;
        });
};

export const prefetchJobDetail = (id) => {
    if (!id) return Promise.resolve(null);
    return loadJobDetail(id).catch(() => null);
};

export const loadRelatedJobs = (id) => requestOnce(
    `related:${String(id)}`,
    () => getRelatedPostService({ postId: id, limit: 5 })
);

export const loadFavoriteState = (postId, userId) => requestOnce(
    `favorite:${String(postId)}:${String(userId)}`,
    () => checkFavoritePostService({ postId, userId })
);

export const clearJobDetailResourceCache = () => {
    detailCache.clear();
    pendingRequests.clear();
};
