import CommonUtils from './CommonUtils';
import { readAvatarImage } from './avatarImage';

jest.mock('./CommonUtils', () => ({ __esModule: true, default: { getBase64: jest.fn() } }));

const photo = (type = 'image/jpeg', size = 4 * 1024 * 1024) => {
    const file = new File(['x'], 'photo', { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
};

describe('readAvatarImage', () => {
    let context;
    let toDataURL;
    beforeEach(() => {
        jest.clearAllMocks();
        CommonUtils.getBase64.mockResolvedValue('data:original');
        context = { drawImage: jest.fn(), fillRect: jest.fn() };
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
        toDataURL = jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,SMALL');
        global.createImageBitmap = jest.fn().mockResolvedValue({ width: 4000, height: 3000, close: jest.fn() });
    });
    afterEach(() => {
        jest.restoreAllMocks();
        delete global.createImageBitmap;
    });

    it('scales a large photo to fit 512px and encodes it as WebP', async () => {
        expect(await readAvatarImage(photo())).toBe('data:image/webp;base64,SMALL');
        expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 384);
        expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.86);
        expect(CommonUtils.getBase64).not.toHaveBeenCalled();
    });

    it('falls back to JPEG on a white backdrop where the browser cannot encode WebP', async () => {
        toDataURL.mockImplementation(type => (type === 'image/jpeg' ? 'data:image/jpeg;base64,SMALL' : 'data:image/png;base64,BIG'));
        expect(await readAvatarImage(photo('image/png'))).toBe('data:image/jpeg;base64,SMALL');
        expect(context.globalCompositeOperation).toBe('destination-over');
        expect(context.fillStyle).toBe('#fff');
        expect(context.fillRect).toHaveBeenCalledWith(0, 0, 512, 384);
    });

    it('keeps a small image that already fits unchanged', async () => {
        createImageBitmap.mockResolvedValue({ width: 300, height: 300, close: jest.fn() });
        expect(await readAvatarImage(photo('image/png', 50 * 1024))).toBe('data:original');
        expect(context.drawImage).not.toHaveBeenCalled();
    });

    it.each([
        ['an animated GIF', () => photo('image/gif')],
        ['a format the browser cannot decode', () => { createImageBitmap.mockRejectedValue(new Error('decode')); return photo(); }],
        ['a browser without createImageBitmap', () => { delete global.createImageBitmap; return photo(); }],
    ])('sends %s unchanged', async (_, makeFile) => {
        expect(await readAvatarImage(makeFile())).toBe('data:original');
        expect(context.drawImage).not.toHaveBeenCalled();
    });
});
