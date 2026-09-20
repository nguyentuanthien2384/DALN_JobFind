const { Worker } = require('node:worker_threads');
const path = require('node:path');
let running = 0;
export const validateChatPdf = bytes => new Promise((resolve, reject) => {
    const fail = () => new Error('PDF không hợp lệ, có mật khẩu/nội dung tương tác hoặc vượt quá 100 trang. Hãy xuất lại thành PDF thông thường.');
    if (running >= 4) { reject(new Error('Đang có nhiều tài liệu được xử lý. Vui lòng thử lại sau.')); return; }
    let worker;
    try { worker = new Worker(path.join(__dirname, 'chatPdfWorker.cjs'), { workerData: bytes,
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }, stdout: true, stderr: true }); }
    catch (error) { reject(error); return; }
    running++;
    let done = false;
    const finish = (error, result) => {
        if (done) return;
        done = true; clearTimeout(timer); running--; worker.terminate();
        if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(fail()), 6000);
    worker.on('message', result => result.error ? finish(fail()) : finish(null, result));
    worker.on('error', () => finish(fail()));
    worker.on('exit', () => { if (!done) finish(fail()); });
});
