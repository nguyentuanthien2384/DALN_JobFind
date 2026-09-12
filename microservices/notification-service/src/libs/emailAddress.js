// Shared by email templates and transport without opening a database connection.
export const normalizeEmailRecipient = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const isValidEmailRecipient = (value) => {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return false;
    const email = normalizeEmailRecipient(value);
    if (!email || email.length > 254) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const [localPart, domain] = parts;
    if (
        !localPart || localPart.length > 64
        || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')
        || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
    ) return false;
    const labels = domain.split('.');
    if (domain.length > 253 || labels.length < 2) return false;
    return labels.every((label) => (
        label.length > 0 && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ));
};
