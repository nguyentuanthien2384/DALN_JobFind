const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const generate=require('../../scripts/generate-push-keys.cjs');
test('creates a valid key pair without overwriting an existing identity',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jobfind-push-keys-'));
  const target=path.join(directory,'device.env');
  try{
    expect(()=>generate('not-a-contact',target)).toThrow();expect(fs.existsSync(target)).toBe(false);
    generate('mailto:tests@example.com',target);
    const original=fs.readFileSync(target,'utf8'),settings=require('dotenv').parse(original);
    expect(settings.WEB_PUSH_ENABLED).toBe('true');
    expect(()=>require('web-push').generateRequestDetails({endpoint:'https://fcm.googleapis.com/test'},null,{vapidDetails:{subject:settings.WEB_PUSH_SUBJECT,publicKey:settings.WEB_PUSH_PUBLIC_KEY,privateKey:settings.WEB_PUSH_PRIVATE_KEY}})).not.toThrow();
    expect(()=>generate('mailto:tests@example.com',target)).toThrow();expect(fs.readFileSync(target,'utf8')).toBe(original);
  }finally{if(fs.existsSync(target))fs.unlinkSync(target);fs.rmdirSync(directory);}
});
