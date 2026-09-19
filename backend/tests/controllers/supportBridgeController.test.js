jest.mock('../../src/models', () => ({ Account: { findOne: jest.fn() }, sequelize: { query: jest.fn() } }));
jest.mock('../../src/services/chatService', () => ({ handleSendMessage: jest.fn() }));
jest.mock('../../src/config/socket', () => ({ emitNewMessage: jest.fn() }));
jest.mock('../../src/services/supportJobTools', () => ({ executeSupportTool: jest.fn() }));
const { trustedSupport, publicTool, deliverHandoff } = require('../../src/controllers/supportBridgeController');
const { supportChatAccess } = require('../../src/middlewares/supportChatAccess');
const db = require('../../src/models');
const chat = require('../../src/services/chatService');
const { emitNewMessage } = require('../../src/config/socket');
const { executeSupportTool } = require('../../src/services/supportJobTools');
const { createResponse } = require('../helpers/http');
const ticketId='12345678-1234-4234-8234-123456789012';
beforeEach(()=>{jest.clearAllMocks();process.env.INTERNAL_SECRET='test-support-internal';});
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
