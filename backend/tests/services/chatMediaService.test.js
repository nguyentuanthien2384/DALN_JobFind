const { PDFDocument, PDFName, PDFString } = require('pdf-lib');
const model = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn(), unscoped: jest.fn() });
const mockDb = { ChatAttachment: model(), ChatMessage: model(), User: model(), Company: model(), Post: model(), DetailPost: model(), Allcode: model(),
    sequelize: { escape: value => `'${String(value).replace(/'/g, "\\'")}'` } };
const mockRelation = jest.fn();
jest.mock('../../src/models', () => mockDb);
jest.mock('../../src/services/chatService', () => ({ canParticipantsChat: (...args) => mockRelation(...args) }));
jest.mock('../../src/utils/realtimeLimiter', () => ({ consume: jest.fn(async () => ({ allowed: true })) }));
const media = require('../../src/services/chatMediaService');
const { validateChatPdf } = require('../../src/utils/chatPdf');
const protocol = require('../../src/utils/chatProtocol');
const id = '8546b1f1-5e0d-4f1e-9476-0fdb6dffac11';
let bytes;
beforeAll(async () => { const pdf = await PDFDocument.create(); pdf.addPage(); bytes = Buffer.from(await pdf.save()); });
beforeEach(() => {
    jest.clearAllMocks();
    mockRelation.mockResolvedValue({ allowed: true, waitingReply: { candidateId: 1, recruiterId: 2 } });
    mockDb.ChatAttachment.findOne.mockResolvedValue(null);
    mockDb.ChatAttachment.create.mockImplementation(async data => data);
    mockDb.ChatMessage.findOne.mockResolvedValue(null);
});
test('protocol accepts media-only sends but requires idempotency and excludes mixed content refs', () => {
    const base = { receiverId: 2, content: '', clientMessageId: 'a'.repeat(32) };
    expect(protocol.validate('chat:send', base)).toBe(false);
    expect(protocol.validate('chat:send', { ...base, attachmentId: id })).toBe(true);
    expect(protocol.validate('chat:send', { ...base, jobPostId: 5 })).toBe(true);
    expect(protocol.validate('chat:send', { ...base, attachmentId: id, jobPostId: 5 })).toBe(false);
    expect(protocol.validate('chat:send', { ...base, attachmentId: '../file' })).toBe(false);
    expect(protocol.validate('chat:send', { ...base, attachmentId: id, fileBase64: 'secret' })).toBe(false);
});
test('PDF parser validates the actual document and rejects damaged, encrypted, active and oversized page sets', async () => {
    await expect(validateChatPdf(bytes)).resolves.toEqual({ pageCount: 1 });
    await expect(validateChatPdf(Buffer.from('%PDF-1.7\ncorrupt'))).rejects.toThrow('PDF không hợp lệ');
    const active = await PDFDocument.create(); active.addPage(); active.addJavaScript('script','app.alert(1)');
    await expect(validateChatPdf(Buffer.from(await active.save()))).rejects.toThrow();
    const encrypted = await PDFDocument.create(); encrypted.addPage(); encrypted.context.trailerInfo.Encrypt = encrypted.context.obj({ Filter: PDFName.of('Standard') });
    await expect(validateChatPdf(Buffer.from(await encrypted.save()))).rejects.toThrow();
    const many = await PDFDocument.create(); for (let i = 0; i < 101; i++) many.addPage();
    await expect(validateChatPdf(Buffer.from(await many.save()))).rejects.toThrow();
}, 15000);

test('PDF validation inspects direct actions nested inside annotation arrays and stream dictionaries', async () => {
    const action = { S: 'JavaScript', JS: PDFString.of('app.alert(1)') };
    const annotation = await PDFDocument.create();
    const page = annotation.addPage();
    page.node.set(PDFName.of('Annots'), annotation.context.obj([
        { Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 100], A: action },
    ]));
    await expect(validateChatPdf(Buffer.from(await annotation.save()))).rejects.toThrow('PDF không hợp lệ');

    const stream = await PDFDocument.create(); stream.addPage();
    stream.catalog.set(PDFName.of('Metadata'), stream.context.register(stream.context.stream('', {
        Type: 'Metadata', Subtype: 'XML', Custom: [[{ A: action }]],
    })));
    await expect(validateChatPdf(Buffer.from(await stream.save()))).rejects.toThrow('PDF không hợp lệ');
});

test('PDF validation bounds nested direct objects without rejecting ordinary annotations', async () => {
    const ordinary = await PDFDocument.create();
    ordinary.addPage().node.set(PDFName.of('Annots'), ordinary.context.obj([
        { Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 100], A: { S: 'URI', URI: PDFString.of('https://example.com') } },
    ]));
    await expect(validateChatPdf(Buffer.from(await ordinary.save()))).resolves.toEqual({ pageCount: 1 });
    const nested = await PDFDocument.create(); nested.addPage();
    let value = { Name: 'Harmless' };
    for (let depth = 0; depth < 35; depth++) value = [value];
    nested.catalog.set(PDFName.of('Custom'), nested.context.obj(value));
    await expect(validateChatPdf(Buffer.from(await nested.save()))).rejects.toThrow('PDF không hợp lệ');
});
test('uploads PDF privately and returns only metadata', async () => {
    const result = await media.uploadChatAttachment(1, { receiverId: 2, fileName: 'CV.pdf', fileBase64: bytes.toString('base64') });
    expect(result).toMatchObject({ errCode: 0, data: { name: 'CV.pdf', mimeType: 'application/pdf', size: bytes.length, pageCount: 1 } });
    expect(result.data).not.toHaveProperty('bytes');
    expect(mockDb.ChatAttachment.create.mock.calls[0][0].senderId).toBe(1);
});
test.each([{ fileName: '../cv.pdf' }, { fileName: 'cv.exe' }, { fileBase64: 'x'.repeat(7 * 1024 * 1024) }, { fileBase64: 'bm90IHBkZg==' }])('rejects invalid uploads', async override => {
    expect((await media.uploadChatAttachment(1, { receiverId: 2, fileName: 'CV.pdf', fileBase64: bytes.toString('base64'), ...override })).errCode).not.toBe(0);
    expect(mockDb.ChatAttachment.create).not.toHaveBeenCalled();
});
test('receiver cannot read unsent documents; strangers and support cannot read or upload', async () => {
    const row = { id, senderId: 1, receiverId: 2, name: 'CV.pdf', size: bytes.length, mimeType: 'application/pdf', pageCount: 1 };
    mockDb.ChatAttachment.findOne.mockResolvedValue(row);
    expect((await media.readChatAttachment(3,id)).httpStatus).toBe(404);
    expect((await media.readChatAttachment(2,id)).httpStatus).toBe(404);
    mockDb.ChatAttachment.unscoped.mockReturnValue({ findOne: jest.fn(async () => ({ bytes })) });
    expect((await media.readChatAttachment(1,id)).data.fileBase64).toBe(bytes.toString('base64'));
    mockDb.ChatMessage.findOne.mockResolvedValue({ id: 9 });
    expect((await media.readChatAttachment(2,id)).errCode).toBe(0);
    mockRelation.mockResolvedValue({ allowed: true });
    expect((await media.readChatAttachment(2,id)).httpStatus).toBe(403);
    expect((await media.uploadChatAttachment(1,{receiverId:2})).httpStatus).toBe(403);
});
test('attachment reference is scoped to sender and receiver and history omits private bytes', async () => {
    expect((await media.prepareChatMedia(1,3,{attachmentId:id})).httpStatus).toBe(403);
    expect(mockDb.ChatAttachment.findOne).toHaveBeenCalledWith({where:{id,senderId:1,receiverId:3},raw:true});
    mockDb.ChatAttachment.findAll.mockResolvedValue([{id,senderId:1,receiverId:2,name:'CV.pdf',bytes:'private',mimeType:'application/pdf',size:100,pageCount:1}]);
    const messages=await media.hydrateChatMessages([{id:1,senderId:1,receiverId:2,attachmentId:id},{id:2,senderId:3,receiverId:2,attachmentId:id}]);
    expect(messages[0].attachment.name).toBe('CV.pdf'); expect(messages[1]).not.toHaveProperty('attachment');
    expect(JSON.stringify(messages)).not.toContain('private');
});

test('history hydrates MariaDB string job snapshots and tolerates malformed stored JSON', async () => {
    const snapshot = { id: 7, name: 'Lập trình viên React', descriptionText: 'Chi tiết công việc đã gửi' };
    const raw = { id: 1, jobPostId: 7, jobSnapshot: JSON.stringify(snapshot) };
    const messages = await media.hydrateChatMessages([
        raw,
        { get: jest.fn(() => ({ id: 2, jobSnapshot: JSON.stringify(snapshot) })) },
        { id: 3, jobSnapshot: '{invalid' },
        { id: 4, jobSnapshot: snapshot },
        { id: 5, jobSnapshot: null },
    ]);
    expect(messages.map(message => message.jobSnapshot)).toEqual([snapshot, snapshot, null, snapshot, null]);
    expect(raw.jobSnapshot).toBe(JSON.stringify(snapshot));
    expect(mockDb.ChatAttachment.findAll).not.toHaveBeenCalled();
});
