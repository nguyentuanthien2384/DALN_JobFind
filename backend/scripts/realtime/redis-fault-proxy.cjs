const net = require('node:net');
module.exports = async (targetUrl) => {
    const target = new URL(targetUrl), sockets = new Set(); let paused=false;
    const server=net.createServer(client=>{
        if (paused) return client.destroy();
        const upstream=net.connect(Number(target.port)||6379,target.hostname);
        sockets.add(client);sockets.add(upstream);
        const close=()=>{client.destroy();upstream.destroy();sockets.delete(client);sockets.delete(upstream);};
        client.on('error',close);upstream.on('error',close);client.on('close',close);upstream.on('close',close);
        client.pipe(upstream);upstream.pipe(client);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=new URL(target);url.hostname='127.0.0.1';url.port=String(server.address().port);
    return {url:url.href,pause:()=>{paused=true;for(const s of sockets)s.destroy();},resume:()=>{paused=false;},
        close:async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));}};
};
