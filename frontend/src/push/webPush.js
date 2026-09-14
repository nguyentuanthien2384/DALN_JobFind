const URL_API=process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';
const STORAGE_KEY='jobfind:push-device';
let pending=Promise.resolve();
const locked=action=>{
    if(navigator.locks?.request)return navigator.locks.request('jobfind-push-device',action);
    const task=pending.catch(()=>{}).then(action);pending=task;return task;
};
export const supported=()=>window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const api=async(method,path,body,token=localStorage.getItem('token_user'))=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
        const response=await fetch(new URL(path,new URL(URL_API,window.location.origin)),{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
        const result=await response.json();if(!response.ok||result.errCode!==0)throw new Error(result.code==='DEVICE_LIMITED'?'Tài khoản đã bật thông báo trên 10 thiết bị. Hãy tắt ở thiết bị cũ.':'Không lưu được thiết lập thông báo. Vui lòng thử lại.');return result.data;
    }finally{clearTimeout(timer);}
};
export const getConfig=()=>api('GET',`/api/push/config${device()?.id?'?id='+encodeURIComponent(device().id):''}`);
const device=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY));}catch{return null;}};
const activeWorker=async registration=>{
    if(registration.active)return registration.active;
    const worker=registration.installing||registration.waiting;
    if(!worker)throw new Error('Chưa khởi tạo được thông báo.');
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.removeEventListener('statechange',check);reject(new Error('Khởi tạo thông báo quá lâu.'));},8000);const check=()=>{if(worker.state==='activated'){clearTimeout(timer);worker.removeEventListener('statechange',check);resolve();}};worker.addEventListener('statechange',check);check();});
    return registration.active||worker;
};
const setOwner=async(registration,ownerId,expectedOwner)=>{
    const worker=await activeWorker(registration);
    return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(new Error('Không cập nhật được thiết bị thông báo.'));},5000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data?.ok?resolve(event.data.changed):reject(new Error('Không lưu được thiết lập thiết bị.'));};
        worker.postMessage({type:'push-owner',ownerId,expectedOwner},[channel.port2]);
    });
};
const clearOwner=async(registration,expectedOwner)=>{
    try{return await setOwner(registration,null,expectedOwner);}
    catch(error){
        // A worker update may fail while logging out. Its account cache is also
        // accessible to this same-origin page, so invalidate it before leaving.
        if(!window.caches)throw error;
        const cache=await window.caches.open('jobfind-push-settings-v1');
        const stored=await cache.match('/__jobfind_push_owner');
        if(stored&&await stored.json()!==expectedOwner)return false;
        await cache.put('/__jobfind_push_owner',new Response('null'));
        for(const notification of await registration.getNotifications())notification.close();
        return true;
    }
};
const keyBytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),char=>char.charCodeAt(0));
export const status=async userId=>{
    if(!supported())return 'unsupported';
    if(Notification.permission==='denied')return 'denied';
    const registration=await navigator.serviceWorker.getRegistration('/');
    const subscription=await registration?.pushManager.getSubscription();
    return subscription&&device()?.userId===userId&&new Date(device()?.expiresAt)>new Date()&&Notification.permission==='granted'?'enabled':'disabled';
};
export const enable=async(userId,publicKey)=>{
    if(!supported())throw new Error('Trình duyệt này chưa hỗ trợ thông báo đẩy.');
    const token=localStorage.getItem('token_user');
    // Permission is requested directly from the button gesture, before networking.
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error(permission==='denied'?'Thông báo đã bị chặn. Bạn có thể mở quyền trong cài đặt trình duyệt.':'Bạn chưa cho phép nhận thông báo.');
    return locked(async()=>{
    if(localStorage.getItem('token_user')!==token)throw new Error('Phiên đăng nhập đã thay đổi.');
    const registration=await navigator.serviceWorker.register('/push-sw.js',{scope:'/'});
    await activeWorker(registration);
    let subscription=await registration.pushManager.getSubscription();
    if(subscription&&subscription.options.applicationServerKey && new Uint8Array(subscription.options.applicationServerKey).toString()!==keyBytes(publicKey).toString()){
        await subscription.unsubscribe();subscription=null;
    }
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
    let saved;
    try{
        saved=await api('POST','/api/push/subscription',subscription.toJSON(),token);
        if(localStorage.getItem('token_user')!==token)throw new Error('Phiên đăng nhập đã thay đổi. Hãy bật lại thông báo.');
        await setOwner(registration,userId);
        localStorage.setItem(STORAGE_KEY,JSON.stringify({userId,id:saved.id,expiresAt:saved.expiresAt}));
        window.dispatchEvent(new Event('jobfind:push-changed'));
    }catch(error){
        await clearOwner(registration,userId).catch(()=>{});
        if(saved)await api('DELETE','/api/push/subscription',{id:saved.id},token).catch(()=>{});
        await subscription.unsubscribe().catch(()=>{});throw error;
    }
    });
};
export const disable=()=>{
    const previous=device(),token=localStorage.getItem('token_user');
    if(!previous)return Promise.resolve();
    return locked(async()=>{
    if(device()?.id!==previous.id||device()?.userId!==previous.userId)return;
    const registration=await navigator.serviceWorker?.getRegistration('/');
    if(registration){
        const changed=await clearOwner(registration,previous.userId);
        if(changed){const subscription=await registration.pushManager.getSubscription();if(subscription&&!await subscription.unsubscribe())throw new Error('Chưa tắt được thông báo trên thiết bị. Hãy thử lại.');}
    }
    // The browser unsubscribe takes effect even when the backend is offline.
    localStorage.removeItem(STORAGE_KEY);window.dispatchEvent(new Event('jobfind:push-changed'));
    if(token)await api('DELETE','/api/push/subscription',{id:previous.id},token).catch(()=>{});
    });
};
export const clearPushOnLogout=()=>device()?disable().catch(()=>{}):undefined;
// Session expiry and cross-tab logout also clear the persisted worker account.
window.addEventListener('jobfind:session-ended',clearPushOnLogout);
export const reconcilePushSession=()=>{
    let user;try{user=JSON.parse(localStorage.getItem('userData'));}catch{}
    if(device()&&(!localStorage.getItem('token_user')||Number(user?.id)!==device().userId))clearPushOnLogout();
};
window.addEventListener('storage',event=>{if(event.key==='token_user'&&event.oldValue!==event.newValue)clearPushOnLogout();});
