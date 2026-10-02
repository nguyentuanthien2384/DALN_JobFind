// The configured Anthropic-compatible gateway sends each request to one of several
// backends: some start streaming within 2-4 s, others return the whole answer in one
// piece after 10-16 s. When a request has not started after `delayMs`, an identical
// second request usually lands on a fast backend. The first to respond is used and the
// other is cancelled, so the answer comes from the same model and prompt either way.
const retryable = error => error?.name !== 'AbortError' && !(error?.statusCode >= 400 && error.statusCode < 500);

export function hedgeMiddleware({ delayMs, onHedge = () => {} }) {
    return {
        wrapStream: async ({ doStream, params, model }) => {
            if (!(delayMs > 0)) return doStream();
            const outer = params.abortSignal;
            return new Promise((resolve, reject) => {
                const attempts = [];
                let settled = false, failed = 0, timer;
                const finish = (callback, value) => { settled = true; clearTimeout(timer); callback(value); };
                const launch = () => {
                    const controller = new AbortController();
                    const attempt = { controller };
                    attempts.push(attempt);
                    // The provider resolves doStream when the response headers arrive,
                    // which this gateway sends together with the first event.
                    model.doStream({ ...params, abortSignal: outer ? AbortSignal.any([outer, controller.signal]) : controller.signal }).then(result => {
                        if (settled) { controller.abort(); return; }
                        for (const other of attempts) if (other !== attempt) other.controller.abort();
                        finish(resolve, result);
                    }, error => {
                        failed += 1;
                        if (settled) return;
                        // A fast failure of the only request is retried once at once instead of waiting.
                        if (attempts.length === 1 && !outer?.aborted && retryable(error)) { clearTimeout(timer); onHedge('retry'); launch(); return; }
                        if (failed === attempts.length) finish(reject, error);
                    });
                };
                launch();
                timer = setTimeout(() => { if (!settled && attempts.length === 1) { onHedge('slow'); launch(); } }, delayMs);
            });
        }
    };
}
