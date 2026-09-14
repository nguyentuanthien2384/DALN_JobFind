import {enable,disable,status,clearPushOnLogout,getConfig,reconcilePushSession} from './webPush';

const key='AQID',storageKey='jobfind:push-device';
let subscription,registration,owner;
const response=data=>({ok:true,json:async()=>({errCode:0,data})});
beforeEach(()=>{
    localStorage.clear();localStorage.setItem('token_user','current-token');owner=null;
    Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
    window.PushManager=function(){};
    window.Notification={permission:'granted',requestPermission:jest.fn().mockResolvedValue('granted')};
    window.MessageChannel=class{
        constructor(){this.port1={close:jest.fn()};this.port2={reply:data=>this.port1.onmessage({data})};}
    };
    subscription={options:{applicationServerKey:new Uint8Array([1,2,3]).buffer},unsubscribe:jest.fn().mockResolvedValue(true),toJSON:()=>({endpoint:'https://fcm.googleapis.com/test',keys:{auth:'test',p256dh:'test'}})};
    registration={active:{postMessage:jest.fn((data,ports)=>{
        const changed=data.expectedOwner===undefined||data.expectedOwner===owner;
        if(changed)owner=data.ownerId;ports[0].reply({ok:true,changed});
    })},pushManager:{getSubscription:jest.fn().mockResolvedValue(subscription),subscribe:jest.fn().mockResolvedValue(subscription)}};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:jest.fn().mockResolvedValue(registration),getRegistration:jest.fn().mockResolvedValue(registration)}});
    Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
    global.fetch=jest.fn().mockResolvedValue(response({id:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}));
});
afterEach(()=>{localStorage.clear();jest.restoreAllMocks();});
test('explicit enable persists only device identity and sends authenticated browser subscription',async()=>{
    expect(await status(7)).toBe('disabled');expect(Notification.requestPermission).not.toHaveBeenCalled();
    await enable(7,key);expect(owner).toBe(7);expect(await status(7)).toBe('enabled');
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({method:'POST',headers:expect.objectContaining({Authorization:'Bearer current-token'})}));
    expect(localStorage.getItem(storageKey)).not.toContain('token');
    await getConfig();expect(fetch.mock.calls[1][0].searchParams.get('id')).toBe('a'.repeat(64));
});
test('denied or dismissed permission never registers or saves a device',async()=>{
    for(const permission of ['denied','default']){Notification.requestPermission.mockResolvedValueOnce(permission);await expect(enable(7,key)).rejects.toThrow();}
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
test('failed server registration unsubscribes the browser and clears worker ownership',async()=>{
    owner=7;fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(enable(7,key)).rejects.toThrow('offline');expect(subscription.unsubscribe).toHaveBeenCalled();expect(owner).toBeNull();expect(localStorage.getItem(storageKey)).toBeNull();
});
test('logout stops local delivery even if backend deletion is offline',async()=>{
    await enable(7,key);fetch.mockRejectedValueOnce(new Error('offline'));await clearPushOnLogout();
    expect(owner).toBeNull();expect(subscription.unsubscribe).toHaveBeenCalled();expect(localStorage.getItem(storageKey)).toBeNull();
});
test('session change during registration rolls back using the captured account token',async()=>{
    fetch.mockImplementationOnce(async()=>{localStorage.setItem('token_user','new-token');return response({id:'a'.repeat(64)});});
    await expect(enable(7,key)).rejects.toThrow('Phiên đăng nhập');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer current-token');expect(owner).toBeNull();expect(subscription.unsubscribe).toHaveBeenCalled();
});
test('session change while permission is open cannot create a subscription',async()=>{
    Notification.requestPermission.mockImplementationOnce(async()=>{localStorage.setItem('token_user','new-token');return 'granted';});
    await expect(enable(7,key)).rejects.toThrow('Phiên đăng nhập');expect(fetch).not.toHaveBeenCalled();
});
test('expired local preference and a different account are not reported enabled',async()=>{
    await enable(7,key);expect(await status(8)).toBe('disabled');
    const previous=JSON.parse(localStorage.getItem(storageKey));localStorage.setItem(storageKey,JSON.stringify({...previous,expiresAt:new Date(0)}));expect(await status(7)).toBe('disabled');
});
test('logout does not unsubscribe a newer account owned by the worker',async()=>{
    await enable(7,key);owner=8;await disable();expect(owner).toBe(8);expect(subscription.unsubscribe).not.toHaveBeenCalled();
});
test('startup detects stale push ownership after account changes',async()=>{
    await enable(7,key);localStorage.setItem('userData',JSON.stringify({id:8}));reconcilePushSession();
    await disable();expect(owner).toBeNull();expect(localStorage.getItem(storageKey)).toBeNull();
});
test('cross-tab Web Lock covers the full subscription update',async()=>{
    let inside=false;
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request:jest.fn(async(name,action)=>{expect(name).toBe('jobfind-push-device');inside=true;try{return await action();}finally{inside=false;}})}});
    fetch.mockImplementation(async()=>{expect(inside).toBe(true);return response({id:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000)});});
    await enable(7,key);await disable();expect(navigator.locks.request).toHaveBeenCalledTimes(2);
});
