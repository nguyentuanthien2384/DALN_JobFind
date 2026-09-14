const fs = require('node:fs');
const path = require('node:path');
const webPush = require('web-push');

// Never print a private key or overwrite a deployed identity.
const generate = (subject, output) => {
    if (!subject || !output || /[\r\n]/.test(subject)) throw new Error('Provide --subject=mailto:your-contact@example.com and --out=path');
    const keys = webPush.generateVAPIDKeys();
    webPush.generateRequestDetails({endpoint:'https://fcm.googleapis.com/test'}, null, {vapidDetails:{subject,...keys}});
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, `WEB_PUSH_ENABLED=true\nWEB_PUSH_SUBJECT=${subject}\nWEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}\n`, {flag:'wx',mode:0o600});
    return target;
};
module.exports = generate;
if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
        console.log('Saved Web Push configuration to ' + generate(value('subject'), value('out')));
    } catch { console.error('Could not create keys. Supply a valid contact and a NEW output file; existing files are preserved.'); process.exitCode = 1; }
}
