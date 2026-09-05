const loadClient = (backendUrl) => {
    jest.resetModules();
    if (backendUrl === undefined) delete process.env.REACT_APP_BACKEND_URL;
    else process.env.REACT_APP_BACKEND_URL = backendUrl;

    const requestUse = jest.fn();
    const responseUse = jest.fn();
    const instance = {
        interceptors: {
            request: { use: requestUse },
            response: { use: responseUse },
        },
    };
    const create = jest.fn(() => instance);
    jest.doMock("axios", () => ({ __esModule: true, default: { create } }));

    let exported;
    jest.isolateModules(() => {
        exported = require("./axios").default;
    });
    return {
        exported,
        create,
        instance,
        requestSuccess: requestUse.mock.calls[0][0],
        requestFailure: requestUse.mock.calls[0][1],
        responseSuccess: responseUse.mock.calls[0][0],
        responseFailure: responseUse.mock.calls[0][1],
    };
};

describe("configured axios client", () => {
    const originalBackendUrl = process.env.REACT_APP_BACKEND_URL;

    beforeEach(() => localStorage.clear());

    afterAll(() => {
        if (originalBackendUrl === undefined) delete process.env.REACT_APP_BACKEND_URL;
        else process.env.REACT_APP_BACKEND_URL = originalBackendUrl;
    });

    it("uses the configured backend URL and exports the created instance", () => {
        const client = loadClient("https://api.example.test");
        expect(client.create).toHaveBeenCalledWith({ baseURL: "https://api.example.test" });
        expect(client.exported).toBe(client.instance);
    });

    it("falls back to localhost", () => {
        const client = loadClient(undefined);
        expect(client.create).toHaveBeenCalledWith({ baseURL: "http://localhost:4000" });
    });

    it("adds the bearer token when one is available", () => {
        localStorage.setItem("token_user", "secret");
        const { requestSuccess } = loadClient(undefined);
        const config = { headers: { accept: "json" } };
        expect(requestSuccess(config)).toBe(config);
        expect(config.headers.authorization).toBe("Bearer secret");
    });

    it("leaves authorization untouched for anonymous requests", () => {
        const { requestSuccess } = loadClient(undefined);
        const config = { headers: {} };
        expect(requestSuccess(config)).toEqual({ headers: {} });
    });

    it("rejects request setup errors", async () => {
        const { requestFailure } = loadClient(undefined);
        const error = new Error("bad config");
        await expect(requestFailure(error)).rejects.toBe(error);
    });

    it("unwraps successful response data", () => {
        const { responseSuccess } = loadClient(undefined);
        expect(responseSuccess({ status: 200, data: { errCode: 0, data: [1] } })).toEqual({
            errCode: 0,
            data: [1],
        });
    });

    it("normalizes a network error", () => {
        const { responseFailure } = loadClient(undefined);
        expect(responseFailure(new Error("offline"))).toEqual({
            errCode: -1,
            errMessage: "Không kết nối được máy chủ. Vui lòng kiểm tra lại kết nối.",
            httpStatus: 0, errorType: 'network',
        });
    });

    it.each([
        [{ errCode: 7, errMessage: "Specific" }, 503, { errCode: 7, errMessage: "Specific", httpStatus: 503, errorType: 'unavailable' }],
        [{ message: "Generic" }, 400, { errCode: -1, errMessage: "Generic", httpStatus: 400, errorType: 'validation' }],
        [{}, 502, { errCode: -1, errMessage: "Dịch vụ đang tạm gián đoạn. Vui lòng thử lại sau.", httpStatus: 502, errorType: 'unavailable' }],
    ])("normalizes an HTTP response %#", (data, status, expected) => {
        const { responseFailure } = loadClient(undefined);
        expect(responseFailure({ response: { data, status } })).toEqual(expected);
    });

    it("clears an expired authenticated session and remembers the current URL", () => {
        window.history.replaceState({}, "", "/admin/dashboard?tab=cv");
        localStorage.setItem("userData", "user");
        localStorage.setItem("token_user", "token");
        const previousUrl = window.location.pathname + window.location.search;
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        const { responseFailure } = loadClient(undefined);

        expect(responseFailure({ config: { headers: { authorization: 'Bearer token' } }, response: { status: 401, data: { refresh: true, message: "Expired" } } })).toEqual({
            errCode: -1,
            errMessage: "Expired",
            httpStatus: 401, errorType: 'authentication',
        });
        expect(localStorage.getItem("userData")).toBeNull();
        expect(localStorage.getItem("token_user")).toBeNull();
        expect(localStorage.getItem("lastUrl")).toBe(previousUrl);
        consoleError.mockRestore();
    });

    it("clears stale session storage even on login without overwriting the return URL", () => {
        window.history.replaceState({}, "", "/login");
        localStorage.setItem("userData", "user");
        localStorage.setItem("token_user", "token");
        const { responseFailure } = loadClient(undefined);
        responseFailure({ config: { headers: { authorization: 'Bearer token' } }, response: { status: 401, data: { refresh: true } } });
        expect(localStorage.getItem("userData")).toBeNull();
        expect(localStorage.getItem("token_user")).toBeNull();
        expect(localStorage.getItem("lastUrl")).toBeNull();
    });

    it('handles Gateway 401 without the old refresh flag', () => {
        window.history.replaceState({}, '', '/login');
        localStorage.setItem('token_user', 'current');
        const { requestSuccess, responseFailure } = loadClient();
        const config = requestSuccess({ url: '/api/my-applications', headers: {} });
        expect(responseFailure({ config, response: { status: 401, data: { errCode: 401 } } })).toMatchObject({ errorType: 'authentication' });
        expect(localStorage.getItem('token_user')).toBeNull();
    });
    it.each([403, 429, 502, 503])('does not log out a valid session for HTTP %s', (status) => {
        localStorage.setItem('token_user', 'current');
        const { requestSuccess, responseFailure } = loadClient();
        const config = requestSuccess({ url: '/api/applications', headers: {} });
        responseFailure({ config, response: { status, data: { errCode: status } } });
        expect(localStorage.getItem('token_user')).toBe('current');
    });
    it('does not invalidate a newer login or redirect anonymous/login failures', () => {
        const { requestSuccess, responseFailure } = loadClient();
        localStorage.setItem('token_user', 'old');
        const config = requestSuccess({ url: '/api/my-applications', headers: {} });
        localStorage.setItem('token_user', 'new');
        responseFailure({ config, response: { status: 401, data: {} } });
        responseFailure({ config: { url: '/api/login', headers: { authorization: 'Bearer new' } }, response: { status: 401, data: {} } });
        responseFailure({ config: {}, response: { status: 401, data: {} } });
        expect(localStorage.getItem('token_user')).toBe('new');
    });
});
