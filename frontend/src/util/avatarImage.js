import CommonUtils from './CommonUtils';

// Avatars are shown at 30-120px, but a phone photo is several MB of base64 that the
// API then forwards to Cloudinary. Shrinking it in the browser makes saving near-instant.
export const AVATAR_MAX_SIZE = 512;
const SMALL_FILE_BYTES = 200 * 1024;
const RESIZABLE_TYPES = /^image\/(jpeg|png|webp|bmp)$/;

/** Data URL for an avatar upload, scaled to fit AVATAR_MAX_SIZE. Falls back to the original file. */
export async function readAvatarImage(file, maxSize = AVATAR_MAX_SIZE) {
    // GIF would lose its animation; HEIC and friends may not decode. Send those unchanged.
    if (typeof createImageBitmap !== 'function' || !RESIZABLE_TYPES.test(file.type)) return CommonUtils.getBase64(file);
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return CommonUtils.getBase64(file);
    }
    try {
        const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
        if (scale === 1 && file.size <= SMALL_FILE_BYTES) return CommonUtils.getBase64(file);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return CommonUtils.getBase64(file);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let encoded = canvas.toDataURL('image/webp', 0.86);
        if (!encoded.startsWith('data:image/webp')) {
            // Safari cannot encode WebP. JPEG has no transparency, so put a white backdrop behind it.
            context.globalCompositeOperation = 'destination-over';
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            encoded = canvas.toDataURL('image/jpeg', 0.86);
        }
        return encoded;
    } finally {
        bitmap.close?.();
    }
}
