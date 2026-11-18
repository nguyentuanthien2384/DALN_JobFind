/* Keep the optional translator off the application's initial loading path.
 * gtranslate-guard.js still runs synchronously before React and this widget. */
(function () {
    'use strict';

    function loadWidget() {
        if (document.getElementById('jobfind-language-widget')) return;
        var script = document.createElement('script');
        script.id = 'jobfind-language-widget';
        script.src = 'https://cdn.gtranslate.net/widgets/latest/float.js';
        script.async = true;
        script.addEventListener('load', function () {
            // The guard's DOMContentLoaded preload ran before this delayed widget.
            // Trigger its normal focus handler once the widget has registered it.
            var wrapper = document.querySelector('.gtranslate_wrapper');
            if (wrapper) wrapper.dispatchEvent(new Event('focusin'));
        });
        document.body.appendChild(script);
    }

    function scheduleWidget() {
        if (window.requestIdleCallback) {
            window.requestIdleCallback(loadWidget, { timeout: 2000 });
        } else {
            window.setTimeout(loadWidget, 0);
        }
    }

    var translated = false;
    try {
        var language = JSON.parse(localStorage.getItem('__GT_TRANSLATE_LANGS'));
        translated = !!(language && typeof language.tgtLang === 'string'
            && language.tgtLang && language.tgtLang !== 'vi');
    } catch (error) { /* Default to Vietnamese when storage is unavailable. */ }

    // A saved translated language needs the engine promptly because the guard
    // temporarily hides untranslated text. Dynamic async loading still leaves
    // React and DOMContentLoaded independent of the third-party download.
    if (translated) loadWidget();
    else if (document.readyState === 'complete') scheduleWidget();
    else window.addEventListener('load', scheduleWidget, { once: true });
}());
