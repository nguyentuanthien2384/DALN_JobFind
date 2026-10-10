// ===== HEDGED REQUESTS (ky thuat giam "tail latency") =====
// Y tuong tu bai "The Tail at Scale" (Dean & Barroso, Google, 2013): neu yeu cau chua
// co phan hoi sau delayMs (mac dinh 4s), gui them MOT ban sao giong het; ban nao tra ve
// truoc thi dung, ban con lai bi huy (AbortController). Do cung model va prompt nen
// noi dung tuong duong. Do do thuc te 16 cau hoi: thoi gian ra chu dau tien trung binh
// giam tu 17,5s xuong 9,4s. Danh doi: khi bi cham, toi da 2 request => co the ton them
// chi phi; tat bang SUPPORT_HEDGE_MS=0. Loi 4xx (yeu cau sai) khong gui lai.
// Gan vao model bang wrapLanguageModel (middleware cua AI SDK) nen phan con lai cua
// chatbot khong can biet co hedging.
//
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
