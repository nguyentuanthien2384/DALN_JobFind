const metrics=require('../../src/utils/realtimeMetrics');
test('reports payload and client ACK histograms plus transport changes without arbitrary labels',()=>{
    metrics.transport('polling',1);metrics.transport('polling',-1);metrics.transport('websocket',1);metrics.transport('attacker-label',1);
    metrics.payload('chat:send',450);metrics.ack('ack',0.2);metrics.ack('fallback',5.4);
    const value=metrics.render();
    expect(value).toContain('socket_connected_by_transport{transport="polling"} 0');
    expect(value).toContain('socket_connected_by_transport{transport="websocket"} 1');
    expect(value).toContain('socket_payload_bytes_bucket{event="chat:send",le="512"} 1');
    expect(value).toContain('chat_send_ack_seconds_bucket{outcome="ack",le="0.25"} 1');
    expect(value).not.toContain('attacker-label');metrics.transport('websocket',-1);
});
