const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
let events,notifications,navigate,focus,openWindow,dispatch,owner,client;
beforeEach(()=>{
    events={};notifications=[];navigate=jest.fn();focus=jest.fn();openWindow=jest.fn();owner=null;
    client={url:'https://jobs.example/chat',navigate,focus};
    const cache={match:async()=>({json:async()=>owner}),put:async(key,value)=>{owner=JSON.parse(value.body);}};
    const self={location:{origin:'https://jobs.example'},addEventListener:(type,handler)=>{events[type]=handler;},skipWaiting:jest.fn(),clients:{claim:jest.fn(),matchAll:async()=>[client],openWindow},registration:{getNotifications:async()=>notifications,showNotification:jest.fn(async(title,options)=>{
        notifications=notifications.filter(n=>n.tag!==options.tag);const notification={title,...options,close:()=>{notifications=notifications.filter(n=>n!==notification);}};notifications.push(notification);
    })}};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../frontend/public/push-sw.js'),'utf8'),{self,caches:{open:async()=>cache},URL,Response:class{constructor(body){this.body=body;}}});
    dispatch=async(type,data)=>{let work;const event={...data,waitUntil:p=>{work=p;}};events[type](event);await work;};
});
const setOwner=(id,expectedOwner)=>dispatch('message',{data:{type:'push-owner',ownerId:id,expectedOwner},source:{url:'https://jobs.example/chat'},ports:[{postMessage:jest.fn()}]});
const push=(changes={})=>dispatch('push',{data:{json:()=>({v:1,ownerId:7,path:'/chat/8',tag:'chat-1',...changes})}});
test('only current account receives generic notifications, duplicate message tags replace',async()=>{
    await setOwner(7);await push();await push();expect(notifications).toHaveLength(1);expect(notifications[0].body).not.toContain('/chat');
    await push({ownerId:8});await push({path:'https://evil.example'});await push({v:2});expect(notifications).toHaveLength(1);
});
test('logout and push delivery serialize; already visible notifications close',async()=>{
    await setOwner(7);await Promise.all([push(),setOwner(null,7)]);expect(notifications).toHaveLength(0);await push();expect(notifications).toHaveLength(0);
});
test('old logout cannot clear a new account; foreign window cannot set owner',async()=>{
    await setOwner(8);await setOwner(null,7);expect(owner).toBe(8);
    await dispatch('message',{data:{type:'push-owner',ownerId:7},source:{url:'https://evil.example'},ports:[]});expect(owner).toBe(8);
});
test('click focuses a same-origin chat, but rejects stale or external targets',async()=>{
    await setOwner(7);await push();await dispatch('notificationclick',{notification:notifications[0]});
    expect(navigate).toHaveBeenCalledWith('https://jobs.example/chat/8');expect(focus).toHaveBeenCalledTimes(1);
    for(const data of [{ownerId:8,path:'/chat/8'},{ownerId:7,path:'//evil.example'}])await dispatch('notificationclick',{notification:{data,close:jest.fn()}});
    expect(navigate).toHaveBeenCalledTimes(1);
});
test('click opens a window when no same-origin page exists',async()=>{
    await setOwner(7);await push();client.url='https://other.example';await dispatch('notificationclick',{notification:notifications[0]});expect(openWindow).toHaveBeenCalledWith('https://jobs.example/chat/8');
});
