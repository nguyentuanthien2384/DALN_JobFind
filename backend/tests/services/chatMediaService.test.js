const { PDFDocument, PDFName, PDFString } = require('pdf-lib');
const model = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn(), unscoped: jest.fn() });
const mockDb = { ChatAttachment: model(), ChatMessage: model(), User: model(), Company: model(), Post: model(), DetailPost: model(), Allcode: model(),
    sequelize: { escape: value => `'${String(value).replace(/'/g, "\\'")}'` } };
const mockRelation = jest.fn();
jest.mock('../../src/models', () => mockDb);
jest.mock('../../src/services/chatService', () => ({ canParticipantsChat: (...args) => mockRelation(...args) }));
jest.mock('../../src/utils/realtimeLimiter', () => ({ consume: jest.fn(async () => ({ allowed: true })) }));
const media = require('../../src/services/chatMediaService');
const limiter = require('../../src/utils/realtimeLimiter');
const { validateChatPdf } = require('../../src/utils/chatPdf');
const protocol = require('../../src/utils/chatProtocol');
const id = '8546b1f1-5e0d-4f1e-9476-0fdb6dffac11';
let bytes;
beforeAll(async () => { const pdf = await PDFDocument.create(); pdf.addPage(); bytes = Buffer.from(await pdf.save()); });
beforeEach(() => {
    jest.resetAllMocks();
    mockRelation.mockResolvedValue({ allowed: true, waitingReply: { candidateId: 1, recruiterId: 2 } });
    limiter.consume.mockResolvedValue({ allowed: true });
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

describe('uploadChatAttachment access, quotas and persistence', () => {
    const upload = override => media.uploadChatAttachment(1, {
        receiverId: 2, fileName: 'CV.pdf', fileBase64: bytes.toString('base64'), ...override,
    });

    test.each([0, -1, 1.5, 'NaN', Number.MAX_SAFE_INTEGER + 1])('rejects invalid receiver %s before using quota', async receiverId => {
        expect(await upload({ receiverId })).toMatchObject({ httpStatus: 403 });
        expect(mockRelation).not.toHaveBeenCalled();
        expect(limiter.consume).not.toHaveBeenCalled();
    });

    test('requires an active recruitment relationship before charging quota', async () => {
        mockRelation.mockResolvedValue({ allowed: false });
        expect(await upload()).toMatchObject({ httpStatus: 403 });
        expect(limiter.consume).not.toHaveBeenCalled();
        expect(mockDb.ChatAttachment.findOne).not.toHaveBeenCalled();
    });

    test.each([0, 1])('enforces upload quota when bucket %s denies access', async deniedBucket => {
        limiter.consume.mockResolvedValueOnce({ allowed: deniedBucket !== 0 })
            .mockResolvedValueOnce({ allowed: deniedBucket !== 1 });
        expect(await upload()).toMatchObject({ httpStatus: 429 });
        expect(limiter.consume).toHaveBeenNthCalledWith(1, 'chat-upload:1', 10, 60000);
        expect(limiter.consume).toHaveBeenNthCalledWith(2, 'chat-upload-daily:1', 100, 86400000);
        expect(mockDb.ChatAttachment.findOne).not.toHaveBeenCalled();
    });

    test.each([
        ['not a string', 123], ['path traversal', '../CV.pdf'], ['backslash', 'C:\\CV.pdf'],
        ['control character', 'CV\n.pdf'], ['wrong extension', 'CV.pdf.exe'], ['overlong', `${'a'.repeat(252)}.pdf`],
    ])('rejects %s file names without writing data', async (_, fileName) => {
        expect(await upload({ fileName })).toMatchObject({ httpStatus: 400 });
        expect(mockDb.ChatAttachment.findOne).not.toHaveBeenCalled();
    });

    test.each([
        ['non-string', 123], ['invalid alphabet', '%%%%'], ['noncanonical padding', 'JVBERi1='],
        ['empty', ''], ['not PDF', Buffer.from('not a PDF').toString('base64')],
    ])('rejects %s encoded data without writing it', async (_, fileBase64) => {
        expect(await upload({ fileBase64 })).toMatchObject({ httpStatus: 400 });
        expect(mockDb.ChatAttachment.findOne).not.toHaveBeenCalled();
    });

    test('returns the existing attachment for an identical retry without a second write', async () => {
        const existing = { id, name: 'CV.pdf', mimeType: 'application/pdf', size: bytes.length, pageCount: 1, bytes: 'secret' };
        mockDb.ChatAttachment.findOne.mockResolvedValue(existing);
        expect(await upload()).toEqual({ errCode: 0, data: media.attachmentMetadata(existing) });
        expect(mockDb.ChatAttachment.create).not.toHaveBeenCalled();
        expect(JSON.stringify(await upload())).not.toContain('secret');
    });

    test('recovers a concurrent unique-key insert by reading the winning attachment', async () => {
        const existing = { id, name: 'CV.pdf', mimeType: 'application/pdf', size: bytes.length, pageCount: 1 };
        mockDb.ChatAttachment.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
        mockDb.ChatAttachment.create.mockRejectedValue({ name: 'SequelizeUniqueConstraintError' });
        expect(await upload()).toEqual({ errCode: 0, data: media.attachmentMetadata(existing) });
        expect(mockDb.ChatAttachment.findOne).toHaveBeenCalledTimes(2);
    });

    test('propagates unexpected database failures and unresolved uniqueness races', async () => {
        const failure = new Error('database unavailable');
        mockDb.ChatAttachment.create.mockRejectedValue(failure);
        await expect(upload()).rejects.toBe(failure);
        const uniqueFailure = Object.assign(new Error('unique'), { name: 'SequelizeUniqueConstraintError' });
        mockDb.ChatAttachment.create.mockRejectedValue(uniqueFailure);
        await expect(upload()).rejects.toBe(uniqueFailure);
    });
});

describe('readChatAttachment private retrieval', () => {
    const row = () => ({ id, senderId: 1, receiverId: 2, name: 'CV.pdf', mimeType: 'application/pdf', size: bytes.length, pageCount: 1 });

    test.each(['not-a-uuid', '../file', null, 123])('rejects malformed attachment ID %s before querying', async attachmentId => {
        expect(await media.readChatAttachment(1, attachmentId)).toMatchObject({ httpStatus: 404 });
        expect(mockDb.ChatAttachment.findOne).not.toHaveBeenCalled();
    });

    test('does not reveal whether an attachment exists to outsiders', async () => {
        mockDb.ChatAttachment.findOne.mockResolvedValue(row());
        expect(await media.readChatAttachment(3, id)).toMatchObject({ httpStatus: 404 });
        expect(mockRelation).not.toHaveBeenCalled();
        expect(mockDb.ChatMessage.findOne).not.toHaveBeenCalled();
    });

    test('checks current relationship and requires an actual sent message for the receiver', async () => {
        mockDb.ChatAttachment.findOne.mockResolvedValue(row());
        mockRelation.mockResolvedValueOnce({ allowed: false });
        expect(await media.readChatAttachment(1, id)).toMatchObject({ httpStatus: 403 });
        expect(mockDb.ChatAttachment.unscoped).not.toHaveBeenCalled();
        expect(await media.readChatAttachment(2, id)).toMatchObject({ httpStatus: 404 });
        expect(mockDb.ChatMessage.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: { attachmentId: id, senderId: 1, receiverId: 2 },
        }));
    });

    test('returns base64 bytes only to an authorized participant', async () => {
        mockDb.ChatAttachment.findOne.mockResolvedValue(row());
        mockDb.ChatMessage.findOne.mockResolvedValue({ id: 5 });
        mockDb.ChatAttachment.unscoped.mockReturnValue({ findOne: jest.fn(async () => ({ bytes })) });
        const result = await media.readChatAttachment(2, id);
        expect(result).toEqual({ errCode: 0, data: { ...media.attachmentMetadata(row()), fileBase64: bytes.toString('base64') } });
        expect(mockDb.ChatAttachment.unscoped().findOne).toHaveBeenCalledWith({
            where: { id }, attributes: ['bytes'], raw: true,
        });
    });

    test('returns not found if the binary row disappears between metadata and bytes reads', async () => {
        mockDb.ChatAttachment.findOne.mockResolvedValue(row());
        mockDb.ChatAttachment.unscoped.mockReturnValue({ findOne: jest.fn(async () => null) });
        expect(await media.readChatAttachment(1, id)).toMatchObject({ httpStatus: 404 });
    });
});

describe('listChatJobs scoped catalogue', () => {
    const list = override => media.listChatJobs(1, { partnerId: 2, ...override });
    const post = () => ({
        id: 43, updatedAt: new Date('2026-03-01T00:00:00Z'),
        userPostData: { userCompanyData: { name: 'Example Co' } },
        postDetailData: {
            name: 'Frontend Engineer',
            descriptionHTML: '<script>secret()</script><p>React &amp; TypeScript</p><div>Remote &#x1F310;</div>',
            salaryTypePostData: { value: 'Negotiable' }, expTypePostData: { value: '2 years' },
            provincePostData: { value: 'Hanoi' }, workTypePostData: { value: 'Hybrid' },
        },
    });

    test.each([0, -2, 1.5, 'missing', Number.MAX_SAFE_INTEGER + 1])('rejects invalid partner %s', async partnerId => {
        expect(await list({ partnerId })).toMatchObject({ httpStatus: 400 });
        expect(mockRelation).not.toHaveBeenCalled();
        expect(mockDb.Post.findAndCountAll).not.toHaveBeenCalled();
    });

    test('prevents unrelated participants from querying company jobs', async () => {
        mockRelation.mockResolvedValue({ allowed: true });
        expect(await list()).toMatchObject({ httpStatus: 403 });
        expect(mockDb.User.findOne).not.toHaveBeenCalled();
        expect(mockDb.Post.findAndCountAll).not.toHaveBeenCalled();
    });

    test.each([
        { limit: 0 }, { limit: 21 }, { offset: -1 }, { offset: 100001 },
        { search: 4 }, { search: 'x'.repeat(121) }, { jobPostId: 0 }, { jobPostId: 'oops' },
    ])('rejects invalid filtering %p before searching posts', async criteria => {
        mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
        expect(await list(criteria)).toMatchObject({ httpStatus: 400 });
        expect(mockDb.Post.findAndCountAll).not.toHaveBeenCalled();
    });

    test('rejects a recruiter without an associated company', async () => {
        mockDb.User.findOne.mockResolvedValue({ companyId: null });
        expect(await list()).toMatchObject({ httpStatus: 403 });
        expect(mockDb.Post.findAndCountAll).not.toHaveBeenCalled();
    });

    test('lists only current, public jobs in the recruiter company and returns a safe snapshot', async () => {
        mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
        mockDb.Post.findAndCountAll.mockResolvedValue({ rows: [post()], count: 1 });
        const result = await list({ search: 'Frontend', limit: 20, offset: 2 });
        expect(result).toMatchObject({ errCode: 0, count: 1, data: [{
            id: 43, name: 'Frontend Engineer', companyName: 'Example Co',
            salary: 'Negotiable', experience: '2 years', location: 'Hanoi', workType: 'Hybrid',
        }] });
        expect(result.data[0].descriptionText).toMatch(/^React & TypeScript\s+Remote 🌐$/);
        expect(result.data[0].descriptionText).not.toContain('secret');
        expect(result.data[0].sharedAt).toEqual(expect.any(String));
        expect(mockDb.User.findOne).toHaveBeenCalledWith({
            where: { id: 2 }, attributes: ['companyId'], raw: true,
        });
        const query = mockDb.Post.findAndCountAll.mock.calls[0][0];
        expect(query.where.statusCode).toBe('PS1');
        expect(query.include[0].where.companyId).toBe(4);
        expect(query.include[0].include[0].where).toEqual({ statusCode: 'S1', censorCode: 'CS1' });
        expect(query.limit).toBe(20);
        expect(query.offset).toBe(2);
        expect(query.distinct).toBe(true);
        expect(query.order).toEqual([['id', 'DESC']]);
    });

    test('limits an exact job reference to the same company and published status', async () => {
        mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
        mockDb.Post.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
        expect(await list({ jobPostId: 43 })).toEqual({ errCode: 0, data: [], count: 0 });
        expect(mockDb.Post.findAndCountAll.mock.calls[0][0].where).toMatchObject({ statusCode: 'PS1', id: 43 });
    });
});

describe('prepareChatMedia send-time authorization', () => {
    test('ordinary text messages require no media queries', async () => {
        expect(await media.prepareChatMedia(1, 2, {})).toEqual({ errCode: 0, values: {} });
        expect(mockRelation).not.toHaveBeenCalled();
    });

    test('media is limited to active recruitment conversations', async () => {
        mockRelation.mockResolvedValue({ allowed: true });
        expect(await media.prepareChatMedia(1, 2, { attachmentId: id })).toMatchObject({ httpStatus: 403 });
        expect(mockDb.ChatAttachment.findOne).not.toHaveBeenCalled();
    });

    test('refuses an attachment belonging to another sender or conversation', async () => {
        expect(await media.prepareChatMedia(1, 2, { attachmentId: id })).toMatchObject({ httpStatus: 403 });
        expect(mockDb.ChatAttachment.findOne).toHaveBeenCalledWith({
            where: { id, senderId: 1, receiverId: 2 }, raw: true,
        });
    });

    test('sends only the attachment ID when the ownership query matches', async () => {
        mockDb.ChatAttachment.findOne.mockResolvedValue({ id, bytes: 'private' });
        expect(await media.prepareChatMedia(1, 2, { attachmentId: id })).toEqual({ errCode: 0, values: { attachmentId: id } });
    });

    test('rejects unpublished or out-of-company jobs at send time', async () => {
        mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
        mockDb.Post.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
        expect(await media.prepareChatMedia(1, 2, { jobPostId: 43 })).toMatchObject({ httpStatus: 403 });
        expect(mockDb.Post.findAndCountAll.mock.calls[0][0].where.id).toBe(43);
    });

    test('stores the validated job snapshot with the message', async () => {
        mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
        mockDb.Post.findAndCountAll.mockResolvedValue({ rows: [{
            id: 43, updatedAt: new Date('2026-03-01T00:00:00Z'),
            userPostData: { userCompanyData: { name: 'Example Co' } },
            postDetailData: { name: 'Frontend Engineer', descriptionMarkdown: '<p>Hello</p>' },
        }], count: 1 });
        const result = await media.prepareChatMedia(1, 2, { jobPostId: 43 });
        expect(result).toMatchObject({ errCode: 0, values: { jobPostId: 43, jobSnapshot: {
            id: 43, name: 'Frontend Engineer', companyName: 'Example Co', descriptionText: 'Hello',
        } } });
        expect(result.values.jobSnapshot).not.toHaveProperty('userPostData');
    });
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
