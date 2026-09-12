// Compose can return a map or KEY=value entries with --no-interpolate.
// Convert before assigning overrides, otherwise JSON drops array properties.
export function composeEnvironment(value = {}) {
    if (!Array.isArray(value)) return { ...value };
    return Object.fromEntries(value.map(entry => {
        const at = entry.indexOf('=');
        return at < 0 ? [entry, null] : [entry.slice(0, at), entry.slice(at + 1)];
    }));
}
