// Run the unmodified production Gateway app, capturing its ephemeral listener
// over IPC. Never bind to the project's serving port or load project .env.
import assert from 'node:assert/strict';
import http from 'node:http';
assert.ok(process.send && process.env.JOBFIND_BROWSER_FIXTURE === 'owned-disposable');
assert.equal(process.env.PORT, '0');
assert.equal(process.env.MYSQL_DATABASE, 'jobfind_posting_quota_test');
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (port, callback) {
    assert.equal(port, 0);
    this.once('listening', () => process.send({ port: this.address().port }));
    http.Server.prototype.listen = listen;
    return listen.call(this, 0, '127.0.0.1', callback);
};
process.on('message', message => { if (message === 'stop') process.emit('SIGTERM'); });
process.on('disconnect', () => process.emit('SIGTERM'));
await import('../../api-gateway/src/app.js');
