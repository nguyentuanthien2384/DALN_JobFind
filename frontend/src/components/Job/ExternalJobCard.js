import React from 'react';
import './ExternalJobCard.css';

export const externalJobDate = value => {
    if (typeof value !== 'string') return 'Chưa công bố';
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Chưa công bố';
};

export default function ExternalJobCard({ data }) {
    const provinces = Array.isArray(data.provinceCodes) ? data.provinceCodes : [];
    const location = provinces.length > 3
        ? `${provinces.slice(0, 3).join(', ')} và ${provinces.length - 3} tỉnh/thành khác`
        : provinces.join(', ');
    return <article className="external-job-card">
        <span className="external-job-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="3" y="7" width="18" height="14" rx="2" />
                <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M10 12v3h4v-3" />
            </svg>
        </span>
        <div className="external-job-card__body">
            <span className="external-job-card__badge">Tin từ nguồn bên ngoài</span>
            <h3>{data.title}</h3>
            <p className="external-job-card__employer">{data.employer}</p>
            <div className="external-job-card__facts">
                <span>{location || data.sourceLocation || 'Địa điểm chưa công bố'}</span>
                <span>{data.salaryText || 'Lương: nguồn chưa công bố'}</span>
            </div>
            <p className="external-job-card__source">Nguồn: {data.sourceName} · Kiểm tra {externalJobDate(data.checkedAt)}</p>
        </div>
        <div className="external-job-card__action">
            <span>{data.deadline ? `Hạn nộp: ${externalJobDate(data.deadline)}` : 'Hạn nộp: nguồn chưa công bố'}</span>
            <strong>Xem thông tin <span aria-hidden="true">→</span></strong>
        </div>
    </article>;
}
