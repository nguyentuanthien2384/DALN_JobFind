jest.mock('../../src/models', () => ({ Account: { findOne: jest.fn() }, sequelize: { query: jest.fn() } }));
jest.mock('../../src/services/chatService', () => ({ handleSendMessage: jest.fn() }));
jest.mock('../../src/services/rewardService', () => ({ getCandidateRewardOverview: jest.fn(), getEmployerRewardOverview: jest.fn() }));
jest.mock('../../src/config/socket', () => ({ emitNewMessage: jest.fn() }));
jest.mock('../../src/services/supportJobTools', () => ({ executeSupportTool: jest.fn(), PUBLIC_TOOL_NAMES: ['search_jobs', 'get_job_details', 'job_market_overview'] }));
const { trustedSupport, publicTool, privateTool, deliverHandoff } = require('../../src/controllers/supportBridgeController');
const { supportChatAccess } = require('../../src/middlewares/supportChatAccess');
const db = require('../../src/models');
const chat = require('../../src/services/chatService');
const rewardService = require('../../src/services/rewardService');
const { emitNewMessage } = require('../../src/config/socket');
const { executeSupportTool } = require('../../src/services/supportJobTools');
const { createResponse } = require('../helpers/http');
const ticketId='12345678-1234-4234-8234-123456789012';
beforeEach(()=>{jest.resetAllMocks();process.env.INTERNAL_SECRET='test-support-internal';});
test('bridge rejects missing/forged credentials and missing server secret',()=>{
    for(const secret of ['', 'wrong']) {const res=createResponse();res.sendStatus=jest.fn();trustedSupport({headers:{'x-internal-secret':secret}},res,jest.fn());expect(res.sendStatus).toHaveBeenCalledWith(403);}
    delete process.env.INTERNAL_SECRET;const res=createResponse();res.sendStatus=jest.fn();trustedSupport({headers:{}},res,jest.fn());expect(res.sendStatus).toHaveBeenCalledWith(403);
});
test('public bridge only executes allowlisted read tools',async()=>{
    const res=createResponse();await publicTool({body:{name:'delete_account',args:{}}},res);expect(res.status).toHaveBeenCalledWith(400);expect(executeSupportTool).not.toHaveBeenCalled();
});
test('handoff sender and transcript come from assigned ticket, never caller body',async()=>{
    db.Account.findOne.mockResolvedValue({userId:21});db.sequelize.query.mockResolvedValue([[{id:ticketId,user_id:7,agent_id:21,messages:[{role:'user',text:'Help',status:'complete'}]}]]);
    chat.handleSendMessage.mockResolvedValue({errCode:0,data:{id:5}});
    const res=createResponse();await deliverHandoff({headers:{'x-user-id':'21'},body:{ticketId,senderId:999,content:'injected'}},res);
    expect(chat.handleSendMessage).toHaveBeenCalledWith(expect.objectContaining({senderId:7,receiverId:21,clientMessageId:ticketId}));expect(chat.handleSendMessage.mock.calls[0][0].content).not.toContain('injected');expect(emitNewMessage).toHaveBeenCalledTimes(1);
});
test('handoff retry reuses message id and does not publish duplicate sockets',async()=>{
    db.Account.findOne.mockResolvedValue({userId:21});db.sequelize.query.mockResolvedValue([[{id:ticketId,user_id:7,agent_id:21,messages:[]}]]);chat.handleSendMessage.mockResolvedValue({errCode:0,duplicate:true,data:{id:5}});
    await deliverHandoff({headers:{'x-user-id':'21'},body:{ticketId}},createResponse());expect(emitNewMessage).not.toHaveBeenCalled();
});
test('non-admin bridge caller cannot send messages even with internal access',async()=>{
    db.Account.findOne.mockResolvedValue(null);const res=createResponse();res.sendStatus=jest.fn();await deliverHandoff({headers:{'x-user-id':'7'},body:{ticketId}},res);expect(res.sendStatus).toHaveBeenCalledWith(403);expect(chat.handleSendMessage).not.toHaveBeenCalled();
});
test('pending recruiter can reach active ADMIN only; ordinary recipients remain forbidden',async()=>{
    const user={id:7,userAccountData:{roleCode:'EMPLOYER'}};
    const next=jest.fn(),res=createResponse();db.Account.findOne.mockResolvedValue(null);
    await supportChatAccess({user,body:{receiverId:8},query:{}},res,next);expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
    db.Account.findOne.mockResolvedValue({userId:21});await supportChatAccess({user,body:{receiverId:21},query:{}},createResponse(),next);expect(next).toHaveBeenCalledTimes(1);
    const list={user,path:'/api/get-list-chat-conversation'};await supportChatAccess(list,createResponse(),next);expect(list.supportOnly).toBe(true);
});

test('trusted bridge accepts the configured secret and rejects same-length forgeries', () => {
    const next = jest.fn(), res = createResponse(); res.sendStatus = jest.fn();
    trustedSupport({ headers: { 'x-internal-secret': 'x'.repeat(process.env.INTERNAL_SECRET.length) } }, res, next);
    expect(res.sendStatus).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
    trustedSupport({ headers: { 'x-internal-secret': process.env.INTERNAL_SECRET } }, createResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
});

test('public read tool returns its result and fails safely when a dependency rejects', async () => {
    executeSupportTool.mockResolvedValueOnce({ jobs: [{ id: 10 }] });
    const res = createResponse();
    await publicTool({ body: { name: 'search_jobs', args: { query: 'Node' } } }, res);
    expect(executeSupportTool).toHaveBeenCalledWith('search_jobs', { query: 'Node' });
    expect(res.json).toHaveBeenCalledWith({ errCode: 0, data: { jobs: [{ id: 10 }] } });
    executeSupportTool.mockRejectedValueOnce(new Error('private SQL details'));
    const unavailable = createResponse();
    await publicTool({ body: { name: 'search_jobs', args: {} } }, unavailable);
    expect(unavailable.status).toHaveBeenCalledWith(503);
    expect(unavailable.json).toHaveBeenCalledWith({ errCode: 503, errMessage: 'Chưa đọc được tin tuyển dụng.' });
});

test('missing public-tool body is rejected before tool execution', async () => {
    const res = createResponse(); await publicTool({}, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(executeSupportTool).not.toHaveBeenCalled();
});

test.each([undefined, '0', '-1', '1.5', 'not-id', '9007199254740992'])(
    'rejects malformed handoff agent identity %j before database access', async agentId => {
        const res = createResponse(); res.sendStatus = jest.fn();
        await deliverHandoff({ headers: { 'x-user-id': agentId }, body: { ticketId } }, res);
        expect(res.sendStatus).toHaveBeenCalledWith(403);
        expect(db.Account.findOne).not.toHaveBeenCalled(); expect(db.sequelize.query).not.toHaveBeenCalled();
        expect(chat.handleSendMessage).not.toHaveBeenCalled();
    }
);

test('rejects malformed ticket IDs before reading any transcripts', async () => {
    db.Account.findOne.mockResolvedValueOnce({ userId: 21 });
    const res = createResponse(); res.sendStatus = jest.fn();
    await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId: '../another-ticket' } }, res);
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(db.sequelize.query).not.toHaveBeenCalled(); expect(chat.handleSendMessage).not.toHaveBeenCalled();
});

test('requires an unexpired assigned ticket owned by the exact active administrator', async () => {
    db.Account.findOne.mockResolvedValueOnce({ userId: 21 }); db.sequelize.query.mockResolvedValueOnce([[]]);
    const res = createResponse(); res.sendStatus = jest.fn();
    await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, res);
    expect(db.Account.findOne).toHaveBeenCalledWith({ where: { userId: 21, roleCode: 'ADMIN', statusCode: 'S1' }, attributes: ['userId'] });
    const [sql, query] = db.sequelize.query.mock.calls[0];
    expect(sql).toContain('h.id=:id'); expect(sql).toContain('h.agent_id=:agent');
    expect(sql).toContain("h.status='assigned'"); expect(sql).toContain('c.expires_at>:now');
    expect(query.replacements).toEqual({ id: ticketId, agent: 21, now: expect.any(Number) });
    expect(res.sendStatus).toHaveBeenCalledWith(404); expect(chat.handleSendMessage).not.toHaveBeenCalled();
});

test('summarizes only six latest completed transcript entries within the delivery bound', async () => {
    db.Account.findOne.mockResolvedValueOnce({ userId: 21 });
    const messages = [
        { role: 'user', text: 'older-completed-message', status: 'complete' },
        ...Array.from({ length: 6 }, (_, index) => ({ role: index === 0 ? 'user' : 'assistant', text: `recent-${index}`, status: 'complete' })),
        { role: 'assistant', text: 'pending-secret', status: 'pending' }
    ];
    db.sequelize.query.mockResolvedValueOnce([[{ id: ticketId, user_id: 7, agent_id: 21, messages: JSON.stringify(messages) }]]);
    chat.handleSendMessage.mockResolvedValueOnce({ errCode: 0, data: { id: 5 } });
    const res = createResponse(); await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, res);
    const { content } = chat.handleSendMessage.mock.calls[0][0];
    expect(content).toContain('Khách: recent-0'); expect(content).toContain('Trợ lý: recent-5');
    expect(content).not.toContain('older-completed-message'); expect(content).not.toContain('pending-secret');
    expect(res.json).toHaveBeenCalledWith({ errCode: 0, data: { delivered: true } });

    db.Account.findOne.mockResolvedValueOnce({ userId: 21 });
    db.sequelize.query.mockResolvedValueOnce([[{ id: ticketId, user_id: 7, agent_id: 21, messages: [{ role: 'user', text: 'x'.repeat(4000), status: 'complete' }] }]]);
    chat.handleSendMessage.mockResolvedValueOnce({ errCode: 0, duplicate: true });
    await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, createResponse());
    expect(chat.handleSendMessage.mock.calls[1][0].content.split('\n').slice(1).join('\n')).toHaveLength(1750);
});

test('does not publish a handoff that the chat service refused to persist', async () => {
    db.Account.findOne.mockResolvedValueOnce({ userId: 21 });
    db.sequelize.query.mockResolvedValueOnce([[{ id: ticketId, user_id: 7, agent_id: 21, messages: [] }]]);
    chat.handleSendMessage.mockResolvedValueOnce({ errCode: 3 });
    const res = createResponse(); await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, res);
    expect(res.status).toHaveBeenCalledWith(503); expect(emitNewMessage).not.toHaveBeenCalled();
});

test('contains malformed stored transcripts without delivering or disclosing the error', async () => {
    db.Account.findOne.mockResolvedValueOnce({ userId: 21 });
    db.sequelize.query.mockResolvedValueOnce([[{ id: ticketId, messages: 'invalid JSON' }]]);
    const res = createResponse(); await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ errCode: 503, errMessage: 'Yêu cầu đã lưu; vui lòng thử chuyển lại.' });
    expect(chat.handleSendMessage).not.toHaveBeenCalled(); expect(emitNewMessage).not.toHaveBeenCalled();
});


test('privateTool returns candidate and employer reward summaries from verified headers only', async () => {
    const unauth = createResponse(); unauth.sendStatus = jest.fn();
    await privateTool({ headers: {}, body: { name: 'getMyRewards' } }, unauth);
    expect(unauth.sendStatus).toHaveBeenCalledWith(401);

    const badTool = createResponse();
    await privateTool({ headers: { 'x-user-id': '7', 'x-user-role': 'CANDIDATE' }, body: { name: 'deleteWallet' } }, badTool);
    expect(badTool.status).toHaveBeenCalledWith(400);

    rewardService.getCandidateRewardOverview.mockResolvedValueOnce({
        errCode: 0,
        data: {
            wallet: { balance: 40, valueVnd: 40000, tierLabel: 'Bạc', lifetimeEarned: 40 },
            missions: { checkedInToday: true, profileCompletionClaimed: false, profileCompletionPercent: 75 }
        }
    });
    const candRes = createResponse();
    await privateTool({ headers: { 'x-user-id': '7', 'x-user-role': 'CANDIDATE' }, body: { name: 'getMyRewards', userId: 999 } }, candRes);
    expect(rewardService.getCandidateRewardOverview).toHaveBeenCalledWith(7);
    expect(candRes.json).toHaveBeenCalledWith(expect.objectContaining({
        errCode: 0,
        data: expect.objectContaining({ title: 'Điểm thưởng & hạng thành viên', href: '/candidate/info' })
    }));

    const unapproved = createResponse(); unapproved.sendStatus = jest.fn();
    await privateTool({ headers: { 'x-user-id': '9', 'x-user-role': 'EMPLOYER', 'x-company-id': '4', 'x-company-status': 'S1', 'x-company-censor': 'CS2' }, body: { name: 'getMyRewards' } }, unapproved);
    expect(unapproved.sendStatus).toHaveBeenCalledWith(403);

    rewardService.getEmployerRewardOverview.mockResolvedValueOnce({
        errCode: 0,
        data: {
            wallet: { balance: 15, tierLabel: 'Bạc', multiplier: 1.1 },
            allowances: { allowPost: 3, allowHotPost: 1, allowCv: 20, allowCvFree: 5 }
        }
    });
    const empRes = createResponse();
    await privateTool({ headers: { 'x-user-id': '9', 'x-user-role': 'EMPLOYER', 'x-company-id': '4', 'x-company-status': 'S1', 'x-company-censor': 'CS1' }, body: { name: 'getMyRewards' } }, empRes);
    expect(rewardService.getEmployerRewardOverview).toHaveBeenCalledWith(4, { canRedeem: false });
    expect(empRes.json).toHaveBeenCalledWith(expect.objectContaining({
        errCode: 0,
        data: expect.objectContaining({ title: 'Top Point & Quỹ lượt công ty', href: '/admin/rewards' })
    }));
});


test('privateTool and deliverHandoff cover remaining role, error and wrapped-transcript branches', async () => {
    rewardService.getCandidateRewardOverview
        .mockResolvedValueOnce({
            errCode: 0,
            data: {
                wallet: { balance: 0, valueVnd: 0, tierLabel: 'Đồng', lifetimeEarned: 20 },
                missions: { checkedInToday: false, profileCompletionClaimed: true, profileCompletionPercent: 100 }
            }
        })
        .mockResolvedValueOnce({ errCode: 2 })
        .mockRejectedValueOnce(new Error('db down'));

    const candClaimed = createResponse();
    await privateTool({ headers: { 'x-user-id': '7', 'x-user-role': 'CANDIDATE' }, body: { name: 'getMyRewards' } }, candClaimed);
    expect(candClaimed.json.mock.calls[0][0].data.lines.join('\n')).toContain('Chưa điểm danh');
    expect(candClaimed.json.mock.calls[0][0].data.lines.join('\n')).toContain('Đã nhận (+20 điểm)');

    const candUnavailable = createResponse();
    await privateTool({ headers: { 'x-user-id': '7', 'x-user-role': 'CANDIDATE' }, body: { name: 'getMyRewards' } }, candUnavailable);
    expect(candUnavailable.status).toHaveBeenCalledWith(503);

    const candCrashed = createResponse();
    await privateTool({ headers: { 'x-user-id': '7', 'x-user-role': 'CANDIDATE' }, body: { name: 'getMyRewards' } }, candCrashed);
    expect(candCrashed.status).toHaveBeenCalledWith(503);

    for (const headers of [
        { 'x-user-id': '9', 'x-user-role': 'COMPANY', 'x-company-id': '0', 'x-company-status': 'S1', 'x-company-censor': 'CS1' },
        { 'x-user-id': '9', 'x-user-role': 'COMPANY', 'x-company-id': '4', 'x-company-status': 'S2', 'x-company-censor': 'CS1' },
        { 'x-user-id': '1', 'x-user-role': 'ADMIN' },
        { 'x-user-id': '1' }
    ]) {
        const res = createResponse(); res.sendStatus = jest.fn();
        await privateTool({ headers, body: { name: 'getMyRewards' } }, res);
        expect(res.sendStatus).toHaveBeenCalledWith(403);
    }

    rewardService.getEmployerRewardOverview
        .mockResolvedValueOnce({
            errCode: 0,
            data: {
                wallet: { balance: 60, tierLabel: 'Vàng', multiplier: 1.2 },
                allowances: { allowPost: 5, allowHotPost: 2, allowCv: 30, allowCvFree: 10 }
            }
        })
        .mockResolvedValueOnce({ errCode: 2 });

    const ownerRes = createResponse();
    await privateTool({ headers: { 'x-user-id': '9', 'x-user-role': 'COMPANY', 'x-company-id': '4', 'x-company-status': 'S1', 'x-company-censor': 'CS1' }, body: { name: 'getMyRewards' } }, ownerRes);
    expect(rewardService.getEmployerRewardOverview).toHaveBeenCalledWith(4, { canRedeem: true });
    expect(ownerRes.json.mock.calls[0][0].data.lines[3]).toContain('Chủ công ty');

    const ownerUnavailable = createResponse();
    await privateTool({ headers: { 'x-user-id': '9', 'x-user-role': 'COMPANY', 'x-company-id': '4', 'x-company-status': 'S1', 'x-company-censor': 'CS1' }, body: { name: 'getMyRewards' } }, ownerUnavailable);
    expect(ownerUnavailable.status).toHaveBeenCalledWith(503);

    db.Account.findOne.mockResolvedValue({ userId: 21 });
    db.sequelize.query
        .mockResolvedValueOnce([[{ id: ticketId, user_id: 7, agent_id: 21, messages: { messages: [{ role: 'user', text: 'Wrapped', status: 'complete' }], rejectReason: null } }]])
        .mockResolvedValueOnce([[{ id: ticketId, user_id: 7, agent_id: 21, messages: {} }]]);
    chat.handleSendMessage.mockResolvedValue({ errCode: 0, duplicate: true });
    await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, createResponse());
    expect(chat.handleSendMessage.mock.calls[0][0].content).toContain('Khách: Wrapped');
    await deliverHandoff({ headers: { 'x-user-id': '21' }, body: { ticketId } }, createResponse());
});
