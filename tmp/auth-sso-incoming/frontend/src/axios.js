import axios from 'axios';
import { expireSession } from './auth/sessionExpiry';
import { isLoginRequest, normalizeApiError, sentSessionToken } from './service/apiError';
import { getAccessToken, isManagedSession, refreshSession } from './auth/authClient';
const url = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';
const instance = axios.create({ baseURL: url, withCredentials: true });
instance.interceptors.request.use(async config => {
    const marker = localStorage.getItem('token_user');
    config._sessionMarker = marker;
    if (marker) {
        const token = await getAccessToken();
        if (token) {
            config.headers = config.headers || {};
            config.headers.authorization = `Bearer ${token}`;
        }
    }
    return config;
}, error => Promise.reject(error));
instance.interceptors.response.use(
    response => response.data,
    async error => {
        const config = error.config || {};
        const status = error.response?.status;
        const isAuthFailure = status === 401 || (status === 403 && error.response?.data?.refresh === true);
        // Refresh even before reporting an expired write, but NEVER replay writes.
        if (isAuthFailure && isManagedSession(config._sessionMarker) && !config._authRetried
            && !isLoginRequest(config)) {
            try {
                await refreshSession();
                if ((config.method || 'get').toLowerCase() === 'get')
                    return instance({ ...config, _authRetried: true });
                return { errCode: 401, errorType: 'authentication', httpStatus: 401,
                    errMessage: 'Phiên đã được gia hạn. Vui lòng thực hiện lại thao tác.' };
            } catch (refreshError) {
                // A temporary network/IdP failure is not evidence of logout.
                if (!refreshError?.response || refreshError.response.status >= 500)
                    return normalizeApiError(refreshError);
            }
        }
        const result = normalizeApiError(error);
        if (result.errorType === 'authentication' && !isLoginRequest(config)) {
            expireSession(config._sessionMarker || sentSessionToken(config),
                error.response?.data?.authReason === 'inactive' ? 'inactive' : 'expired');
        }
        return result;
    }
);
export default instance;
