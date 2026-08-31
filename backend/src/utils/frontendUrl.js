const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

const getFrontendUrl = () => {
    const configured = String(process.env.URL_REACT || DEFAULT_FRONTEND_URL)
        .split(',')
        .map((origin) => origin.trim())
        .find(Boolean);
    return (configured || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
};

const getFrontendLink = (path = '') => {
    const normalizedPath = String(path).replace(/^\/+/, '');
    return normalizedPath ? `${getFrontendUrl()}/${normalizedPath}` : getFrontendUrl();
};

module.exports = { getFrontendUrl, getFrontendLink };
