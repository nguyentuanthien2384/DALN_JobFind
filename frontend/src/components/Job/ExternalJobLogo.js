import React, { useEffect, useState } from 'react';
import { externalAssetUrl } from '../../service/externalJobs';
import './ExternalJobLogo.css';

const LEGAL_PREFIX = /^(tổng công ty|công ty|cty)(\s+(cổ phần|cp|tnhh|trách nhiệm hữu hạn))?\s+/i;

/** Two-letter mark for employers whose source page publishes no logo. */
export const employerInitials = name => {
    const words = String(name || '').replace(LEGAL_PREFIX, '').split(/\s+/).filter(word => /\p{L}/u.test(word));
    const picked = words.length > 1 ? words.slice(-2) : words;
    return picked.map(word => word.match(/\p{L}/u)[0]).join('').toLocaleUpperCase('vi') || 'DN';
};

export default function ExternalJobLogo({ job, size = 'card' }) {
    const src = externalAssetUrl(job?.logo);
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);
    const background = /^#[0-9a-f]{6}$/i.test(job?.logoBackground || '') ? job.logoBackground : undefined;
    return <span className={`external-job-logo external-job-logo--${size}`} style={background ? { background, borderColor: background } : undefined}>
        {src && !failed
            ? <img src={src} alt={`Logo ${job.employer}`} loading="lazy" decoding="async" onError={() => setFailed(true)} />
            : <span className="external-job-logo__initials" aria-hidden="true">{employerInitials(job?.employer)}</span>}
    </span>;
}
