const realModes = new Set(['claude', 'openai', 'gemini', 'ollama']);

// Parse actual SSE events: a model writing "event: done" in its answer must
// never make a truncated transport look successful.
export async function readSupportStream(response, { startedAt = Date.now(), now = Date.now } = {}) {
    const result = { events: [], firstTextMs: null, text: '', malformed: false };
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) return result;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', bytes = 0;
    const consume = block => {
        const lines = block.split('\n');
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!event) return;
        try {
            const payload = JSON.parse(data);
            result.events.push({ event, payload });
            if (event === 'token' && typeof payload.text === 'string') {
                if (result.firstTextMs === null) result.firstTextMs = now() - startedAt;
                result.text += payload.text;
            }
        } catch { result.malformed = true; }
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
            bytes += value?.byteLength || 0;
            if (bytes > 256000) throw new Error('evaluation_stream_too_large');
            pending = pending.replace(/\r\n/g, '\n');
            let split;
            while ((split = pending.indexOf('\n\n')) >= 0) {
                consume(pending.slice(0, split)); pending = pending.slice(split + 2);
            }
            if (done) break;
        }
        if (pending.trim()) result.malformed = true;
        return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function assessSupportTurn({ responseStatus, parsed, answer, scenario, previousCards = [], reviewedSources = [] }) {
    const toolCalls = parsed.events.filter(item => item.event === 'tool').map(item => item.payload);
    const cards = toolCalls.flatMap(call => call.jobs || (call.job ? [call.job] : []));
    const verifiedIds = new Set([...cards, ...previousCards].map(job => String(job.id)));
    const citedIds = [...(answer?.text || '').matchAll(/\/detail-job\/(\d+)/g)].map(match => match[1]);
    const checks = {
        httpSuccess: responseStatus >= 200 && responseStatus < 300,
        completedStream: parsed.events.some(item => item.event === 'done') && !parsed.events.some(item => item.event === 'error') && !parsed.malformed,
        storedCompleteAnswer: answer?.status === 'complete' && Boolean(answer?.text?.trim()),
        storedTextMatchesStream: Boolean(answer?.text) && answer.text === parsed.text,
        expectedAnswerMode: scenario.expectedLocalRead ? answer?.mode === 'account' : realModes.has(answer?.mode),
        requiredToolCalled: !scenario.requiredTool || toolCalls.some(call => call.name === scenario.requiredTool),
        toolsSucceeded: toolCalls.every(call => !call.error),
        linksReferToVerifiedJobs: citedIds.every(id => verifiedIds.has(id)),
        cardsReferToToolResults: (answer?.cards || []).every(job => cards.some(card => card.id === job.id)),
        sourcesAreReviewed: (answer?.sources || []).every(source => reviewedSources.some(known => known.id === source.id && known.href === source.href)),
        expectedFollowUpJob: !scenario.followUpJobId || toolCalls.some(call => call.name === 'get_job_details' && call.job?.id === scenario.followUpJobId),
    };
    return { automaticChecks: checks, transportPass: checks.httpSuccess && checks.completedStream && checks.storedCompleteAnswer && checks.storedTextMatchesStream,
        automaticPass: Object.values(checks).every(Boolean), usedRealModel: realModes.has(answer?.mode), toolCalls };
}
