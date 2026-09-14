import { mergeMessages, synchronizeConversation } from './conversationSync';
const rows = (from, to) => Array.from({length: to-from+1}, (_, i) => ({id: from+i, content: `message ${from+i}`}));
const page = (data, hasMore = false) => ({errCode: 0, data, partnerData: {id: 2}, pageInfo: {hasMore}});
test('recovers more than 200 missed messages, ordered and deduplicated with the latest page', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce(page(rows(302,401), true))
        .mockResolvedValueOnce(page(rows(2,101), true)).mockResolvedValueOnce(page(rows(102,201), true))
        .mockResolvedValueOnce(page(rows(202,301), true)).mockResolvedValueOnce(page(rows(302,401)));
    const result = await synchronizeConversation({partnerId: 2, afterId: 1, fetchPage, current: () => true});
    expect(result.data).toEqual(rows(2,401));
    expect(fetchPage.mock.calls.map(([args]) => args.afterId)).toEqual([undefined,1,101,201,301]);
});
test('initial load only fetches the latest page; old history remains available on demand', async () => {
    const fetchPage = jest.fn().mockResolvedValue(page(rows(201,300),true));
    expect((await synchronizeConversation({partnerId:2, afterId:0, fetchPage, current:()=>true})).data).toHaveLength(100);
    expect(fetchPage).toHaveBeenCalledTimes(1);
});
test('merges out of order events without duplicates or reverting a known read receipt', () => {
    expect(mergeMessages([{id:2,isRead:1}], [{id:1}, {id:2,isRead:0}], [{id:3}]).map(m=>[m.id,m.isRead]))
        .toEqual([[1,undefined],[2,1],[3,undefined]]);
});
test('failed gap fetch is not treated as a completed snapshot', async () => {
    const failure = {errCode:-1};
    const fetchPage = jest.fn().mockResolvedValueOnce(page(rows(201,300))).mockResolvedValueOnce(failure);
    expect(await synchronizeConversation({partnerId:2,afterId:1,fetchPage,current:()=>true})).toBe(failure);
});
test('a non-advancing cursor fails instead of looping forever or skipping the gap', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce(page(rows(201,300))).mockResolvedValueOnce(page([]));
    expect((await synchronizeConversation({partnerId:2,afterId:1,fetchPage,current:()=>true})).errCode).toBe(-1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
});
test('stops loading when the user switches conversation during a page request', async () => {
    let active = true;
    const fetchPage = jest.fn().mockResolvedValueOnce(page(rows(201,300))).mockImplementationOnce(async () => {active=false;return page(rows(2,101),true);});
    expect(await synchronizeConversation({partnerId:2,afterId:1,fetchPage,current:()=>active})).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
});
