const { parentPort, workerData } = require('node:worker_threads');
const { PDFDocument, PDFDict, PDFArray, PDFStream, PDFName } = require('pdf-lib');
(async () => {
    try {
        const pdf = await PDFDocument.load(workerData, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
        const count = pdf.getPageCount();
        if (pdf.isEncrypted || count < 1 || count > 100) throw new Error();
        const forbidden = new Set(['JS', 'JavaScript', 'OpenAction', 'AA', 'Launch', 'EmbeddedFiles', 'RichMedia', 'XFA']);
        const visited = new Set();
        const visit = (object, depth = 0) => {
            if (depth > 30) throw new Error();
            if (object instanceof PDFName && forbidden.has(object.decodeText())) throw new Error();
            if (!(object instanceof PDFDict || object instanceof PDFArray || object instanceof PDFStream)) return;
            if (visited.has(object)) return;
            visited.add(object);
            if (visited.size > 100000) throw new Error();
            if (object instanceof PDFDict) {
                for (const [key, value] of object.entries()) {
                    if (forbidden.has(key.decodeText())) throw new Error();
                    visit(value, depth + 1);
                }
            } else if (object instanceof PDFArray) {
                for (let index = 0; index < object.size(); index++) visit(object.get(index), depth + 1);
            } else visit(object.dict, depth + 1);
        };
        // Indirect targets are enumerated separately, avoiding page-tree reference
        // cycles while still inspecting direct objects inside arrays and streams.
        for (const [, object] of pdf.context.enumerateIndirectObjects()) visit(object);
        // Force page-tree traversal and validate usable page dimensions.
        pdf.getPages().forEach(page => {
            const { width, height } = page.getSize();
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 14400 || height > 14400) throw new Error();
        });
        parentPort.postMessage({ pageCount: count });
    } catch { parentPort.postMessage({ error: true }); }
})();
