import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { DatePicker } from 'antd';
import {
    Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { DAY, PERIODS, formatNumber, formatPercent } from './dashboardData';

// Cac khoi giao dien dung chung cua dashboard quan tri. Khong goi API.

export const Panel = ({ title, subtitle, actions, children, className = '', busy = false, id }) => (
    <section className={`jf-panel ${className}`} aria-busy={busy} id={id}>
        {(title || actions) && (
            <header className="jf-panel__head">
                <div>
                    {title && <h2 className="jf-panel__title">{title}</h2>}
                    {subtitle && <p className="jf-panel__subtitle">{subtitle}</p>}
                </div>
                {actions && <div className="jf-panel__actions">{actions}</div>}
            </header>
        )}
        <div className="jf-panel__body">{children}</div>
    </section>
);

export const EmptyState = ({ icon = 'far fa-folder-open', children }) => (
    <div className="jf-empty" role="status">
        <i className={icon} aria-hidden="true" />
        <span>{children}</span>
    </div>
);

export const ErrorNote = ({ children }) => <p className="jf-inline-error" role="alert">{children}</p>;

/** Chon ky bao cao: cac moc san co va mot khoang tuy chon. */
export const PeriodPicker = ({ period, onChange, disabled }) => {
    const [customOpen, setCustomOpen] = useState(period.key === 'custom');
    const { RangePicker } = DatePicker;
    const showCustom = customOpen || period.key === 'custom';
    return (
        <div className="jf-period">
            <div className="jf-segmented" role="group" aria-label="Khoảng thời gian">
                {PERIODS.map(item => (
                    <button key={item.key} type="button" disabled={disabled}
                        className={'jf-segmented__item' + (period.key === item.key ? ' is-active' : '')}
                        aria-pressed={period.key === item.key}
                        onClick={() => { setCustomOpen(false); onChange({ period: item.key, from: '', to: '' }); }}>
                        {item.label}
                    </button>
                ))}
                <button type="button" disabled={disabled}
                    className={'jf-segmented__item' + (period.key === 'custom' ? ' is-active' : '')}
                    aria-pressed={period.key === 'custom'}
                    onClick={() => setCustomOpen(true)}>
                    <i className="far fa-calendar-alt" aria-hidden="true" /> Tùy chọn
                </button>
            </div>
            {showCustom && (
                <RangePicker
                    className="jf-period__range"
                    format="DD/MM/YYYY"
                    allowClear={false}
                    value={[dayjs(period.from), dayjs(period.to)]}
                    disabledDate={date => date && date.isAfter(dayjs(), 'day')}
                    onChange={values => {
                        if (!values?.[0] || !values?.[1]) return;
                        onChange({ period: 'custom', from: values[0].format(DAY), to: values[1].format(DAY) });
                    }}
                />
            )}
        </div>
    );
};

/** Chip phan tram so voi ky truoc. `inverse` cho chi so cang thap cang tot. */
export const ChangeChip = ({ value, inverse = false }) => {
    if (value === undefined) return null;
    if (value === null) return <span className="jf-change jf-change--new">Mới phát sinh</span>;
    const rounded = Math.round(value * 10) / 10;
    const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    const good = direction === 'flat' ? 'flat' : (direction === 'up') !== inverse ? 'good' : 'bad';
    const arrow = direction === 'up' ? 'fa-arrow-up' : direction === 'down' ? 'fa-arrow-down' : 'fa-minus';
    return (
        <span className={`jf-change jf-change--${good}`} title="So với kỳ trước">
            <i className={`fas ${arrow}`} aria-hidden="true" />
            {formatPercent(Math.abs(rounded))}
        </span>
    );
};

export const Sparkline = ({ data, color = '#4b49ac', id }) => (
    <div className="jf-kpi__spark" aria-hidden="true">
        <ResponsiveContainer width="100%" height={44}>
            <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                    <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <Area type="monotone" dataKey="current" stroke={color} strokeWidth={1.75} fill={`url(#spark-${id})`}
                    isAnimationActive={false} dot={false} />
            </AreaChart>
        </ResponsiveContainer>
    </div>
);

export const KpiCard = ({ id, label, value, change, inverse, hint, icon, tone = 'primary', spark, to }) => {
    const body = (
        <>
            <div className="jf-kpi__top">
                <span className={`jf-kpi__icon jf-tone--${tone}`}><i className={icon} aria-hidden="true" /></span>
                <span className="jf-kpi__label">{label}</span>
            </div>
            <div className="jf-kpi__value-row">
                <strong className="jf-kpi__value">{value}</strong>
                <ChangeChip value={change} inverse={inverse} />
            </div>
            {hint && <div className="jf-kpi__hint">{hint}</div>}
            {spark && spark.length > 1 && <Sparkline data={spark} id={id} />}
        </>
    );
    return to
        ? <Link className="jf-kpi jf-kpi--link" to={to} data-kpi={id}>{body}</Link>
        : <div className="jf-kpi" data-kpi={id}>{body}</div>;
};

/** The "can xu ly": so viec ton dong va loi tat toi trang xu ly. */
export const AttentionCard = ({ icon, label, count, to, action, tone = 'warning', unknownText = 'Chưa có số liệu' }) => {
    const known = count !== null && count !== undefined;
    const pending = known && count > 0;
    // Lien ket "#..." cuon toi mot khoi tren chinh trang nay.
    const Anchor = to.startsWith('#') ? 'a' : Link;
    const target = to.startsWith('#') ? { href: to } : { to };
    return (
        <Anchor {...target} className={`jf-attention${pending ? ` jf-attention--${tone}` : ' jf-attention--clear'}`}>
            <span className={`jf-attention__icon jf-tone--${pending ? tone : 'success'}`}>
                <i className={pending ? icon : 'fas fa-check'} aria-hidden="true" />
            </span>
            <span className="jf-attention__text">
                <strong>{known ? formatNumber(count) : '—'}</strong>
                <span>{label}</span>
            </span>
            <span className="jf-attention__action">
                {!known ? unknownText : pending ? action : 'Không tồn đọng'}
                <i className="fas fa-chevron-right" aria-hidden="true" />
            </span>
        </Anchor>
    );
};

const TrendTooltip = ({ active, payload, label, format, previousLabel }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload;
    return (
        <div className="jf-chart-tooltip">
            <strong>{label}</strong>
            <span><i className="jf-dot jf-dot--current" />Kỳ này: {format(point.current)}</span>
            <span><i className="jf-dot jf-dot--previous" />{previousLabel}: {format(point.previous)}</span>
        </div>
    );
};

export const TrendChart = ({ data, format = formatNumber, previousLabel = 'Kỳ trước' }) => (
    <div className="jf-trend" data-testid="trend-chart" data-points={data.length}>
        <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                    <linearGradient id="jf-trend-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4b49ac" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#4b49ac" stopOpacity={0.02} />
                    </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eef0f6" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7084' }} tickLine={false} axisLine={false}
                    minTickGap={18} />
                <YAxis tick={{ fontSize: 12, fill: '#6b7084' }} tickLine={false} axisLine={false} width={48}
                    allowDecimals={false} tickFormatter={value => formatNumber(value)} />
                <Tooltip content={<TrendTooltip format={format} previousLabel={previousLabel} />} />
                <Area type="monotone" dataKey="current" name="Kỳ này" stroke="#4b49ac" strokeWidth={2}
                    fill="url(#jf-trend-fill)" dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="previous" name={previousLabel} stroke="#a7abc3" strokeWidth={1.5}
                    strokeDasharray="5 4" dot={false} />
            </ComposedChart>
        </ResponsiveContainer>
    </div>
);

/** Danh sach xep hang dang thanh ngang: de doc hon bieu do tron khi co nhieu muc. */
export const RankList = ({ rows, unit = '', color = 'primary' }) => (
    <ol className="jf-rank">
        {rows.map((row, index) => (
            <li key={row.name} className={row.other ? 'is-other' : undefined}>
                <div className="jf-rank__line">
                    <span className="jf-rank__name">{row.other ? '' : <span className="jf-rank__index">{index + 1}</span>}{row.name}</span>
                    <span className="jf-rank__value">{formatNumber(row.value)}{unit}<small>{formatPercent(row.share)}</small></span>
                </div>
                <div className="jf-rank__track"><span className={`jf-rank__bar jf-bar--${color}`} style={{ width: `${Math.max(row.share, 2)}%` }} /></div>
            </li>
        ))}
    </ol>
);

export const ActivityFeed = ({ items }) => (
    <ul className="jf-feed">
        {items.map(item => (
            <li key={item.id} className="jf-feed__item">
                <span className={`jf-feed__icon jf-tone--${item.tone}`}><i className={item.icon} aria-hidden="true" /></span>
                <div className="jf-feed__body">
                    <span className="jf-feed__title">{item.title}</span>
                    <span className="jf-feed__meta">
                        {item.target && (item.target.to
                            ? <a href={item.target.to} target="_blank" rel="noopener noreferrer">{item.target.label}</a>
                            : <span>{item.target.label}</span>)}
                        {item.target && ' · '}
                        <time dateTime={item.time} title={dayjs(item.time).format('HH:mm:ss DD/MM/YYYY')}>{item.relative}</time>
                    </span>
                </div>
            </li>
        ))}
    </ul>
);

export const ServiceList = ({ services }) => (
    <ul className="jf-services">
        {services.map(service => (
            <li key={service.key}>
                <span className={`jf-status-dot ${service.healthy ? 'is-up' : 'is-down'}`} aria-hidden="true" />
                <span className="jf-services__name">
                    {service.label}
                    <small>{service.name}</small>
                </span>
                <span className={`jf-services__state ${service.healthy ? 'is-up' : 'is-down'}`}>
                    {service.healthy ? 'Hoạt động' : 'Gián đoạn'}
                    {service.breaker && service.breaker !== 'closed' && <small>Ngắt mạch: {service.breaker}</small>}
                </span>
            </li>
        ))}
    </ul>
);
