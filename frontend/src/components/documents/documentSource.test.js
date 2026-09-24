import { isPdfSource, pdfSourceUrl, resolvePdfSource, MAX_PREVIEW_BYTES, pdfFileName } from './documentSource';

const data = `data:application/pdf;base64,${btoa('%PDF-1.7\nfixture')}`;
const blob = () => new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' });
afterEach(() => { jest.restoreAllMocks(); });

test('accepts exact PDF bytes from a data URL or selected local file without any request', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network must not run'));
    expect(isPdfSource(data)).toBe(true);
    expect((await resolvePdfSource(data)).size).toBe(blob().size);
    const file = new File(['%PDF-1.7\nfixture'], 'CV.pdf', { type: 'application/pdf' });
    expect(await resolvePdfSource(file)).toBe(file);
    expect(fetch).not.toHaveBeenCalled();
});

test.each(['\xef\xbb\xbf \r\n', ' \t\n'])('previews a supported PDF prefix without changing the file %#', async prefix => {
    const binary = prefix + '%PDF-1.7\nfixture';
    const file = new File([Uint8Array.from(binary, char => char.charCodeAt(0))], 'exported-cv.pdf', { type: 'application/pdf' });
    expect(await resolvePdfSource(file)).toBe(file);
    const encoded = 'data:application/pdf;base64,' + btoa(binary);
    expect(isPdfSource(encoded)).toBe(true);
    expect((await resolvePdfSource(encoded)).size).toBe(binary.length);
});

test.each(['unexpected', ' '.repeat(1024)])('preview rejects a disguised or overlong PDF header %#', async prefix => {
    const encoded = 'data:application/pdf;base64,' + btoa(prefix + '%PDF-1.7\nfixture');
    expect(isPdfSource(encoded)).toBe(false);
    await expect(resolvePdfSource(encoded)).rejects.toThrow(/PDF/);
});

test.each(['javascript:alert(1)', 'data:text/html;base64,PGgxPk5vPC9oMT4=', '//evil.example/a.pdf', '/\\evil.example/a.pdf', 'https://user:secret@example.com/a.pdf'])('rejects executable, ambiguous or credential-bearing source %s', async value => {
    expect(isPdfSource(value)).toBe(false);
    await expect(resolvePdfSource(value)).rejects.toThrow(/PDF/);
});

test('rejects MIME-only files, malformed base64 and oversized bytes', async () => {
    await expect(resolvePdfSource(new Blob(['<script>alert(1)</script>'], {type:'application/pdf'}))).rejects.toThrow(/PDF/);
    await expect(resolvePdfSource('data:application/pdf;base64,JVBERi0%')).rejects.toThrow(/PDF/);
    await expect(resolvePdfSource(new Blob([new Uint8Array(MAX_PREVIEW_BYTES + 1)]))).rejects.toThrow(/20 MB/);
    expect(pdfFileName('../CV:name')).toBe('.._CV_name.pdf');
});

test('fetches external PDFs without cookies or authorization, preserving same-origin session cookies', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ok:true,headers:new Headers(),blob:async()=>blob()});
    await resolvePdfSource('https://files.example.com/cv.pdf');
    expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    await resolvePdfSource('/cv.pdf');
    expect(fetch.mock.calls[1][1].credentials).toBe('same-origin');
    expect(pdfSourceUrl('/cv.pdf').origin).toBe(window.location.origin);
});

test('denies unauthenticated/private remote responses and responses exceeding the declared budget', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({ok:false,status:403});
    await expect(resolvePdfSource('/cv.pdf')).rejects.toThrow(/quyền/);
    const cancel = jest.fn();
    fetch.mockResolvedValueOnce({ok:true,headers:new Headers({'content-length':String(MAX_PREVIEW_BYTES+1)}),body:{cancel}});
    await expect(resolvePdfSource('/large.pdf')).rejects.toThrow(/20 MB/);
    expect(cancel).toHaveBeenCalled();
});

test('bounds a chunked response even without content-length and cancels the remaining stream', async () => {
    const reader={read:jest.fn().mockResolvedValue({value:new Uint8Array(MAX_PREVIEW_BYTES+1),done:false}),cancel:jest.fn().mockResolvedValue(),releaseLock:jest.fn()};
    jest.spyOn(global,'fetch').mockResolvedValue({ok:true,headers:new Headers(),body:{getReader:()=>reader}});
    await expect(resolvePdfSource('/stream.pdf')).rejects.toThrow(/20 MB/);
    expect(reader.cancel).toHaveBeenCalled();expect(reader.releaseLock).toHaveBeenCalled();
});

test('does not start a document request after the view is aborted', async () => {
    const controller=new AbortController();controller.abort();
    const fetch=jest.spyOn(global,'fetch');
    await expect(resolvePdfSource('/cv.pdf',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(fetch).not.toHaveBeenCalled();
});
