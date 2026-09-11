const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
process.chdir(path.join(root, 'backend'));
backendRequire('@babel/register')({
    presets: [backendRequire.resolve('@babel/preset-env')],
    extensions: ['.js'],
    ignore: [/node_modules/],
});
backendRequire('./src/server.js');
