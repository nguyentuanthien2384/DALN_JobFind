try {
    const response = await fetch(`http://127.0.0.1:${Number(process.env.PORT || 4000)}/readyz`, {
        signal: AbortSignal.timeout(3000)
    });
    await response.body?.cancel();
    process.exit(response.status === 200 ? 0 : 1);
} catch { process.exit(1); }
