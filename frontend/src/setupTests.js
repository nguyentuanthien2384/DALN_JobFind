import "@testing-library/jest-dom";

// jsdom does not implement these browser APIs, while a few UI dependencies
// expect them to exist as soon as a component is mounted.
Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
    })),
});

global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
};

window.scrollTo = jest.fn();

// Unit tests must never reach a real server: a developer's local API (or its absence)
// would otherwise decide whether a test passes. Mock the service module instead.
const blockedRequests = [];
const blockRequest = (kind, url) => {
    blockedRequests.push(`${kind} ${url}`);
    throw new Error(`Unit tests must not make real network requests: ${kind} ${url}`);
};
const realXhrOpen = window.XMLHttpRequest.prototype.open;
window.XMLHttpRequest.prototype.open = function guardedOpen(method, url, ...rest) {
    this.__guardedRequest = `${method} ${url}`;
    return realXhrOpen.call(this, method, url, ...rest);
};
window.XMLHttpRequest.prototype.send = function guardedSend() {
    blockRequest("XHR", this.__guardedRequest);
};
if (typeof window.WebSocket === "function") {
    window.WebSocket = function GuardedWebSocket(url) { blockRequest("WebSocket", url); };
}
beforeEach(() => { blockedRequests.length = 0; });
afterEach(() => {
    if (blockedRequests.length) {
        const requests = blockedRequests.splice(0);
        throw new Error(`Unexpected real network request(s) in a unit test:\n  ${requests.join("\n  ")}`);
    }
});
