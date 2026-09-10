import {
    checkFavoritePostService,
    getDetailPostByIdService,
    getRelatedPostService,
} from "../../service/userService";

const DETAIL_CACHE_TTL = 60 * 1000;
const detailCache = new Map();
const pendingRequests = new Map();
const detailVersions = new Map();
let sessionToken;
let cacheGeneration = 0;

const currentGeneration = () => {
    const token = localStorage.getItem('token_user');
    if (token !== sessionToken) {
        sessionToken = token;
        cacheGeneration += 1;
        detailCache.clear();
        detailVersions.clear();
        pendingRequests.clear();
    }
    return cacheGeneration;
};

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
    currentGeneration();
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
    const generation = currentGeneration();
    const cacheKey = String(id);
    const version = detailVersions.get(cacheKey) || 0;
    const cachedData = getCachedJobDetail(cacheKey);

    if (cachedData) {
        return Promise.resolve({ errCode: 0, data: cachedData });
    }

    return requestOnce(`detail:${generation}:${cacheKey}:${version}`, () => getDetailPostByIdService(id))
        .then((response) => {
            if (generation !== currentGeneration() || version !== (detailVersions.get(cacheKey) || 0)) return { stale: true };
            if (response?.errCode === 0 && response.data && !(response.httpStatus >= 400)) {
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
    `related:${currentGeneration()}:${String(id)}`,
    () => getRelatedPostService({ postId: id, limit: 5 })
);

export const loadFavoriteState = (postId, userId) => requestOnce(
    `favorite:${currentGeneration()}:${String(postId)}:${String(userId)}`,
    () => checkFavoritePostService({ postId, userId })
);

export const clearJobDetailResourceCache = () => {
    cacheGeneration += 1;
    detailCache.clear();
    detailVersions.clear();
    pendingRequests.clear();
};

export const invalidateJobDetail = (id) => {
    currentGeneration();
    const key = String(id);
    detailCache.delete(key);
    detailVersions.set(key, (detailVersions.get(key) || 0) + 1);
};
