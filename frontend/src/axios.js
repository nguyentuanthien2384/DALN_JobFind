import axios from 'axios';
import { expireSession } from './auth/sessionExpiry';
import { isLoginRequest, normalizeApiError, sentSessionToken } from './service/apiError';
const url = process.env.REACT_APP_BACKEND_URL || "http://localhost:4000"


const instance = axios.create({
    baseURL: url,
    //  withCredentials: true
});
instance.interceptors.request.use(
    config =>{
        const token = localStorage.getItem("token_user")
        if(token){
            config.headers = config.headers || {};
            config.headers.authorization = "Bearer " + token
        }
        return config
    },
    error =>{
        return Promise.reject(error)
    }
);
instance.interceptors.response.use(
    (response) => {
        // Thrown error for request with OK status code
        return response.data
    },
    (error) => {
        const result = normalizeApiError(error);
        if (result.errorType === 'authentication' && !isLoginRequest(error.config)) {
            expireSession(sentSessionToken(error.config), error.response?.data?.authReason === 'inactive' ? 'inactive' : 'expired');
        }
        // Keep errors as data for old screens. Never automatically retry writes.
        return result;
    }
);

export default instance;
