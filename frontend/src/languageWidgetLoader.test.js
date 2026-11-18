const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'load-language-widget.js'), 'utf8');
const start = () => {
    // eslint-disable-next-line no-new-func
    new Function(source)();
};

let pageState;
let idle;

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div><div class="gtranslate_wrapper"></div>';
    localStorage.removeItem('__GT_TRANSLATE_LANGS');
    pageState = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    idle = jest.fn();
    window.requestIdleCallback = idle;
});

afterEach(() => {
    pageState.mockRestore();
    delete window.requestIdleCallback;
    jest.useRealTimers();
});

test('Vietnamese startup waits for local page load and idle before requesting the translator', () => {
    start();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(idle).not.toHaveBeenCalled();
    expect(document.getElementById('jobfind-language-widget')).toBeNull();
    window.dispatchEvent(new Event('load'));
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(document.getElementById('jobfind-language-widget')).toBeNull();
    idle.mock.calls[0][0]();
    const script = document.getElementById('jobfind-language-widget');
    expect(script.src).toBe('https://cdn.gtranslate.net/widgets/latest/float.js');
    expect(script.async).toBe(true);
});

test('a saved translated language loads promptly and preloads the engine after widget initialization', () => {
    localStorage.setItem('__GT_TRANSLATE_LANGS', JSON.stringify({ srcLang: 'vi', tgtLang: 'en' }));
    const focus = jest.fn();
    document.querySelector('.gtranslate_wrapper').addEventListener('focusin', focus);
    start();
    const script = document.getElementById('jobfind-language-widget');
    expect(script).not.toBeNull();
    expect(script.async).toBe(true);
    expect(idle).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    script.dispatchEvent(new Event('load'));
    expect(focus).toHaveBeenCalledTimes(1);
});

test('unsupported idle callbacks fall back after page load without inserting duplicate widgets', () => {
    jest.useFakeTimers();
    delete window.requestIdleCallback;
    pageState.mockReturnValue('complete');
    start();
    expect(document.getElementById('jobfind-language-widget')).toBeNull();
    jest.runOnlyPendingTimers();
    start();
    jest.runOnlyPendingTimers();
    expect(document.querySelectorAll('#jobfind-language-widget')).toHaveLength(1);
});
