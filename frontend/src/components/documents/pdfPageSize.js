// Bound the canvas itself; PDF.js maxImageSize only bounds embedded images.
export const MAX_CANVAS_PIXELS = 8 * 1024 * 1024;
export const MAX_CANVAS_SIDE = 8192;
export const boundedPdfPageSize = ({ width, height }, requestedWidth, deviceRatio = 1) => {
    if (![width, height, requestedWidth, deviceRatio].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('Kích thước trang PDF không hợp lệ.');
    }
    const ratio = Math.min(deviceRatio, 2);
    const scale = Math.min(requestedWidth / width,
        MAX_CANVAS_SIDE / (width * ratio), MAX_CANVAS_SIDE / (height * ratio),
        Math.sqrt(MAX_CANVAS_PIXELS / width / height) / ratio);
    const renderedWidth = width * scale;
    if (!Number.isFinite(renderedWidth) || renderedWidth < 1 || height * scale < 1) throw new Error('Trang PDF có tỷ lệ không được hỗ trợ.');
    return { width: renderedWidth, devicePixelRatio: ratio, constrained: renderedWidth < requestedWidth - 1 };
};
