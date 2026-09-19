// Current widget uses the durable support service. Keep the existing command as an alias.
const { spawn } = require('node:child_process');
const path = require('node:path');
const child = spawn(process.execPath, [path.resolve(__dirname, '../../microservices/scripts/test-support-chat.mjs'), '--browser'], { stdio: 'inherit', windowsHide: true });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });