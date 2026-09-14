const {createECDH,randomBytes}=require('crypto');
const config=require('../../src/utils/webPushConfig');
const valid=()=>({endpoint:'https://fcm.googleapis.com/fcm/send/device',keys:{p256dh:createECDH('prime256v1').generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')},expirationTime:null});
test.each(['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://localhost/x','https://fcm.googleapis.com.evil.test/x','https://user:password@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://fcm.googleapis.com/x#secret','https://169.254.169.254/latest/meta-data'])('rejects untrusted or ambiguous endpoint %s',endpoint=>expect(config.validSubscription({...valid(),endpoint})).toBe(false));
test('accepts real curve keys only, rejects extra identity fields and expired subscriptions',()=>{
    const subscription=valid();expect(config.validSubscription(subscription)).toBe(true);
    expect(config.validSubscription({...subscription,userId:999})).toBe(false);
    expect(config.validSubscription({...subscription,expirationTime:1})).toBe(false);
    expect(config.validSubscription({...subscription,keys:{...subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}})).toBe(false);
    expect(config.validSubscription({...subscription,keys:{...subscription.keys,auth:'tiny'}})).toBe(false);
    expect(config.endpointId(subscription.endpoint)).toMatch(/^[a-f0-9]{64}$/);
});
test('disabled by default, validates VAPID without exposing private keys',()=>{
    const env={...process.env};
    try{
        delete process.env.WEB_PUSH_ENABLED;expect(config.settings()).toBeNull();
        process.env.WEB_PUSH_ENABLED='true';process.env.WEB_PUSH_PRIVATE_KEY='sensitive-invalid';
        expect(()=>config.settings()).toThrow('Invalid Web Push configuration');
        const keys=require('web-push').generateVAPIDKeys();
        process.env.WEB_PUSH_PUBLIC_KEY=keys.publicKey;process.env.WEB_PUSH_PRIVATE_KEY=keys.privateKey;process.env.WEB_PUSH_SUBJECT='mailto:tests@example.com';
        expect(config.settings()).toEqual(expect.objectContaining({timeout:5000,TTL:3600}));
    }finally{process.env=env;}
});
