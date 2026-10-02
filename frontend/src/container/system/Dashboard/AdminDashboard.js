import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import useListQuery from '../../../util/useListQuery';
import useAutoRefresh from '../../../util/useAutoRefresh';
import CommonUtils from '../../../util/CommonUtils';
import { PAGINATION } from '../../../util/constant';
import { getStatisticalPackageCv, getStatisticalPackagePost } from '../../../service/userService';
import AutoRefreshInfo from '../AutoRefreshInfo';
import { refreshAdminAttention, useAdminAttention } from '../adminAttention';
import useAdminOverview from './useAdminOverview';
import { useStatisticsTable } from './useStatisticsTable';
import StatisticsTable from './StatisticsTable';
import {
    DEFAULT_PERIOD, STAGE_LABELS, SERVICE_LABELS, buildTrend, byDay, describeEvent, formatMoney, formatNumber,
    formatPercent, percentChange, relativeTime, resolvePeriod, sumRange, topWithOther, trendPeriodFor,
} from './dashboardData';
import {
    ActivityFeed, AttentionCard, EmptyState, ErrorNote, KpiCard, Panel, PeriodPicker, RankList, ServiceList, TrendChart,
} from './DashboardParts';
import './Dashboard.css';

const METRICS = [
    { key: 'applications', label: 'Hồ sơ ứng tuyển' },
    { key: 'posts', label: 'Tin tuyển dụng mới' },
    { key: 'users', label: 'Người dùng mới' },
    { key: 'revenue', label: 'Doanh thu', money: true },
];

const mergeMaps = (...maps) => {
    const merged = new Map();
    maps.forEach(map => map.forEach((value, day) => merged.set(day, (merged.get(day) || 0) + value)));
    return merged;
};

const packageRow = (item, index, page) => ({
    key: item.id,
    cells: [
        index + 1 + page * PAGINATION.pagerow,
        item.name,
        item.isHot === undefined ? undefined : (+item.isHot === 1 ? 'Nổi bật' : 'Thường'),
        formatNumber(item.count),
        formatMoney(item.total),
    ].filter(cell => cell !== undefined),
});

const exportPackages = async (service, period, hot, sheet) => {
    const response = await service({ fromDate: period.from, toDate: period.to, limit: '', offset: '' });
    if (response?.errCode !== 0) return;
    const rows = (response.data || []).map(item => {
        const row = { 'Mã gói': item.id, 'Tên gói': item.name };
        if (hot) row['Loại gói'] = +item.isHot === 1 ? 'Loại nổi bật' : 'Loại bình thường';
        return { ...row, 'Số lượng': +item.count, 'Tổng': `${+item.total}USD` };
    });
    await CommonUtils.exportExcel(rows, sheet, `${sheet} ${period.from} - ${period.to}`);
};

/**
 * Dashboard cua quan tri vien: mot bo loc ky dung chung cho KPI, xu huong va
 * doanh thu theo goi; cac khoi van hanh (can xu ly, nhat ky, tinh trang he
 * thong) luon la so lieu hien tai.
 */
const AdminDashboard = ({ user }) => {
    const [query, setQuery] = useListQuery({ period: DEFAULT_PERIOD, from: '', to: '' });
    const [postQuery, setPostQuery] = useListQuery({ page: 0 }, { prefix: 'post.' });
    const [cvQuery, setCvQuery] = useListQuery({ page: 0 }, { prefix: 'packageCv.' });
    const period = useMemo(() => resolvePeriod(query), [query]);
    const trendPeriod = useMemo(() => trendPeriodFor(period), [period]);
    const [metric, setMetric] = useState('applications');

    const overview = useAdminOverview(period);
    const attention = useAdminAttention(true);
    const postTable = useStatisticsTable({ page: postQuery.page, fromDate: period.from, toDate: period.to }, setPostQuery, getStatisticalPackagePost, true);
    const cvTable = useStatisticsTable({ page: cvQuery.page, fromDate: period.from, toDate: period.to }, setCvQuery, getStatisticalPackageCv, true);
    const { capNhatLuc, dangTai, lamMoi } = useAutoRefresh(
        () => Promise.all([overview.reload(), postTable.reload(), cvTable.reload(), refreshAdminAttention()]),
        { khoangPoll: 60000 }
    );

    const changePeriod = (next) => {
        setQuery(next);
        setPostQuery({ page: 0 });
        setCvQuery({ page: 0 });
    };

    const { data, failed } = overview;
    const current = data.current;
    const previous = data.previous;
    const maps = useMemo(() => {
        const series = data.series || {};
        return {
            posts: byDay(series.tinTuyenDung),
            users: byDay(series.nguoiDungMoi),
            applications: byDay(series.hoSoUngTuyen),
            revenue: mergeMaps(byDay(series.doanhThu, 'tien'), byDay(series.doanhThuXemCv, 'tien')),
        };
    }, [data.series]);
    const trends = useMemo(() => Object.fromEntries(Object.entries(maps)
        .map(([key, map]) => [key, buildTrend(map, trendPeriod)])), [maps, trendPeriod]);
    const hasSeries = Boolean(data.series);
    const newPosts = hasSeries ? sumRange(maps.posts, period.from, period.to) : null;
    const newPostsBefore = hasSeries ? sumRange(maps.posts, period.previous.from, period.previous.to) : null;
    const change = (now, before) => (now == null || before == null ? undefined : percentChange(now, before));
    const applications = current?.hoSoUngTuyen?.tong;
    const hired = current?.hoSoUngTuyen?.daTuyen;

    const kpis = [
        {
            id: 'revenue', label: 'Doanh thu', icon: 'fas fa-wallet', tone: 'success',
            value: formatMoney(current?.doanhThu?.tong),
            change: change(current?.doanhThu?.tong, previous?.doanhThu?.tong),
            hint: current && `Gói đăng tin ${formatMoney(current.doanhThu.goiTin)} · Gói xem ứng viên ${formatMoney(current.doanhThu.goiXemCv)}`,
            spark: trends.revenue,
        },
        {
            id: 'applications', label: 'Hồ sơ ứng tuyển', icon: 'fas fa-file-alt', tone: 'primary',
            value: formatNumber(applications), change: change(applications, previous?.hoSoUngTuyen?.tong),
            hint: current && `${formatNumber(hired)} hồ sơ đã nhận việc`, spark: trends.applications,
        },
        {
            id: 'posts', label: 'Tin tuyển dụng mới', icon: 'fas fa-briefcase', tone: 'info',
            value: formatNumber(newPosts), change: change(newPosts, newPostsBefore),
            hint: current && `${formatNumber(current.tinTuyenDung.dangHienThi)} tin đang hiển thị`, spark: trends.posts,
        },
        {
            id: 'users', label: 'Người dùng mới', icon: 'fas fa-user-plus', tone: 'violet',
            value: formatNumber(current?.nguoiDung?.moi), change: change(current?.nguoiDung?.moi, previous?.nguoiDung?.moi),
            hint: current && `${formatNumber(current.nguoiDung.tong)} tài khoản đang hoạt động`, spark: trends.users,
        },
        {
            id: 'hired', label: 'Tuyển dụng thành công', icon: 'fas fa-handshake', tone: 'warning',
            value: formatNumber(hired), change: change(hired, previous?.hoSoUngTuyen?.daTuyen),
            hint: current && `Tỷ lệ nhận việc ${formatPercent(applications ? (hired / applications) * 100 : 0)}`,
        },
        {
            id: 'companies', label: 'Doanh nghiệp', icon: 'far fa-building', tone: 'neutral',
            value: formatNumber(current?.congTy),
            hint: attention.pendingCompanies != null && `${formatNumber(attention.pendingCompanies)} hồ sơ chờ duyệt`,
        },
    ];

    const activeMetric = METRICS.find(item => item.key === metric);
    const trend = trends[metric];
    const trendTotal = trend.reduce((sum, point) => sum + point.current, 0);
    const trendPrevious = trend.reduce((sum, point) => sum + point.previous, 0);
    const formatMetric = activeMetric.money ? formatMoney : formatNumber;

    const stages = data.funnel?.pheu || [];
    const maxStage = Math.max(1, ...stages.map(stage => Number(stage.soLuong) || 0));
    const categories = topWithOther(data.distribution?.theoNganhNghe, 5);
    const provinces = topWithOther(data.distribution?.theoTinhThanh, 5);
    const events = (data.events || []).map(log => ({
        id: log._id, time: log.createdAt, relative: relativeTime(log.createdAt), ...describeEvent(log),
    }));
    const breakers = new Map((data.status?.circuitBreakers || []).map(item => [item.service, item.state]));
    const services = (data.status?.services || []).map(service => ({
        key: service.key, name: service.name, healthy: Boolean(service.healthy),
        label: SERVICE_LABELS[service.key] || service.name, breaker: breakers.get(service.key),
        lastCheck: service.lastCheck,
    }));
    const down = services.filter(service => !service.healthy).length;
    const lastCheck = services.map(service => service.lastCheck).filter(Boolean).sort().pop();
    const busy = overview.loading;
    const rangeText = period.from === period.to
        ? dayjs(period.from).format('DD/MM/YYYY')
        : `${dayjs(period.from).format('DD/MM')} – ${dayjs(period.to).format('DD/MM/YYYY')}`;
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

    return (
        <div className={'jf-dash' + (busy ? ' is-busy' : '')} aria-busy={busy}>
            <header className="jf-dash__header">
                <div>
                    <p className="jf-dash__eyebrow">Bảng điều khiển quản trị</p>
                    <h1 className="jf-dash__title">Tổng quan hệ thống</h1>
                    <p className="jf-dash__subtitle">
                        {name ? `Xin chào ${name}. ` : ''}Số liệu từ <strong>{rangeText}</strong>, so với {period.days} ngày liền trước.
                    </p>
                </div>
                <div className="jf-dash__toolbar">
                    <PeriodPicker period={period} onChange={changePeriod} />
                    <AutoRefreshInfo capNhatLuc={capNhatLuc} dangTai={dangTai} onLamMoi={lamMoi} />
                </div>
            </header>

            <section className="jf-attention-grid" aria-label="Việc cần xử lý">
                <AttentionCard icon="fas fa-clipboard-check" label="Tin tuyển dụng chờ duyệt" count={attention.pendingPosts}
                    to="/admin/list-post-admin/" action="Duyệt ngay" />
                <AttentionCard icon="far fa-building" label="Công ty chờ duyệt" count={attention.pendingCompanies}
                    to="/admin/list-company-admin/?censorCode=CS3" action="Xem hồ sơ" />
                <AttentionCard icon="fas fa-headset" label="Yêu cầu hỗ trợ chờ tiếp nhận" count={attention.waitingSupport}
                    to="/admin/support" action="Tiếp nhận" tone="info" />
                <AttentionCard icon="fas fa-server" label="Dịch vụ đang gián đoạn" count={data.status ? down : null}
                    to="#jf-system-status" action="Xem chi tiết" tone="danger" unknownText="Chưa kiểm tra được" />
            </section>

            {failed.current && !current && <ErrorNote>Không tải được số liệu tổng quan. Bấm Làm mới để thử lại.</ErrorNote>}
            <section className="jf-kpi-grid" aria-label="Chỉ số chính">
                {kpis.map(kpi => <KpiCard key={kpi.id} {...kpi} />)}
            </section>

            <div className="jf-dash__grid jf-dash__grid--trend">
                <Panel
                    title="Xu hướng theo ngày"
                    subtitle={trendPeriod === period
                        ? 'Đường nét đứt là cùng thời điểm của kỳ trước.'
                        : '14 ngày gần nhất (kỳ đang chọn quá ngắn để thấy xu hướng).'}
                    actions={(
                        <div className="jf-tabs" role="tablist" aria-label="Chỉ số xu hướng">
                            {METRICS.map(item => (
                                <button key={item.key} type="button" role="tab" aria-selected={metric === item.key}
                                    className={'jf-tabs__item' + (metric === item.key ? ' is-active' : '')}
                                    onClick={() => setMetric(item.key)}>{item.label}</button>
                            ))}
                        </div>
                    )}
                >
                    {failed.series && !hasSeries ? <ErrorNote>Không tải được dữ liệu xu hướng.</ErrorNote> : (
                        <>
                            <div className="jf-trend__summary">
                                <span><strong>{formatMetric(trendTotal)}</strong> {activeMetric.label.toLowerCase()}</span>
                                <span className="jf-trend__versus">Kỳ trước: {formatMetric(trendPrevious)}</span>
                            </div>
                            <TrendChart data={trend} format={formatMetric} />
                        </>
                    )}
                </Panel>

                <Panel title="Hồ sơ theo giai đoạn" subtitle="Toàn bộ hồ sơ hiện có trên hệ thống"
                    actions={data.funnel && <span className="jf-pill jf-pill--success">Nhận việc {formatPercent(data.funnel.tyLeTuyen)}</span>}>
                    {!stages.length ? (failed.funnel ? <ErrorNote>Không tải được phễu tuyển dụng.</ErrorNote> : <EmptyState>Chưa có hồ sơ ứng tuyển.</EmptyState>) : (
                        <ul className="jf-stages">
                            {stages.map(stage => (
                                <li key={stage.stage} className={stage.stage === 'tu_choi' ? 'is-negative' : undefined}>
                                    <span className="jf-stages__name">{STAGE_LABELS[stage.stage] || stage.ten}</span>
                                    <span className="jf-stages__track">
                                        <span className="jf-stages__bar" style={{ width: `${Math.max((Number(stage.soLuong) / maxStage) * 100, 2)}%` }} />
                                    </span>
                                    <span className="jf-stages__value">{formatNumber(stage.soLuong)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {data.funnel && <p className="jf-panel__foot">Tổng {formatNumber(data.funnel.tong)} hồ sơ</p>}
                </Panel>
            </div>

            <div className="jf-dash__grid jf-dash__grid--thirds">
                <Panel title="Ngành nghề nhiều tin nhất" subtitle="Tin đang hiển thị"
                    actions={<Link className="jf-link" to="/admin/reports/">Báo cáo</Link>}>
                    {categories.rows.length ? <RankList rows={categories.rows} /> : <EmptyState>Chưa có tin đang hiển thị.</EmptyState>}
                </Panel>
                <Panel title="Tỉnh/thành nhiều tin nhất" subtitle="Tin đang hiển thị">
                    {provinces.rows.length ? <RankList rows={provinces.rows} color="violet" /> : <EmptyState>Chưa có tin đang hiển thị.</EmptyState>}
                </Panel>
                <Panel title="Tình trạng hệ thống" id="jf-system-status"
                    subtitle={data.status
                        ? `${services.length - down}/${services.length} dịch vụ hoạt động${lastCheck ? ` · kiểm tra ${dayjs(lastCheck).format('HH:mm:ss')}` : ''}`
                        : 'Trạng thái các dịch vụ sau API Gateway'}>
                    {services.length ? <ServiceList services={services} />
                        : failed.status ? <ErrorNote>Không lấy được trạng thái dịch vụ.</ErrorNote>
                            : <EmptyState icon="fas fa-server">Đang kiểm tra…</EmptyState>}
                </Panel>
            </div>

            <div className="jf-dash__grid jf-dash__grid--activity">
                <Panel title="Hoạt động gần đây" subtitle="Sự kiện nghiệp vụ mới nhất giữa các dịch vụ"
                    actions={<Link className="jf-link" to="/admin/reports/#audit">Xem nhật ký</Link>}>
                    {events.length ? <ActivityFeed items={events} />
                        : failed.events ? <ErrorNote>Không tải được nhật ký hoạt động.</ErrorNote>
                            : <EmptyState icon="far fa-clock">Chưa có hoạt động nào được ghi.</EmptyState>}
                </Panel>
                <div className="jf-dash__stack">
                    <StatisticsTable
                        title="Doanh thu gói đăng tin"
                        subtitle={rangeText}
                        table={postTable}
                        page={postQuery.page}
                        resetKey={JSON.stringify([period.from, period.to])}
                        onPageChange={page => setPostQuery({ page })}
                        columns={['#', 'Gói', 'Loại', 'Đã bán', 'Doanh thu']}
                        alignRight={[3, 4]}
                        rows={postTable.data.map((item, index) => packageRow(item, index, postQuery.page))}
                        total={postTable.data.length > 0 ? `Tổng doanh thu: ${formatMoney(postTable.sum)}` : null}
                        actions={(
                            <button type="button" className="jf-btn jf-btn--ghost"
                                onClick={() => exportPackages(getStatisticalPackagePost, period, true, 'Doanh thu goi dang tin')}>
                                <i className="fas fa-file-excel" aria-hidden="true" /> Xuất Excel
                            </button>
                        )}
                    />
                    <StatisticsTable
                        title="Doanh thu gói xem ứng viên"
                        subtitle={rangeText}
                        table={cvTable}
                        page={cvQuery.page}
                        resetKey={JSON.stringify([period.from, period.to])}
                        onPageChange={page => setCvQuery({ page })}
                        columns={['#', 'Gói', 'Đã bán', 'Doanh thu']}
                        alignRight={[2, 3]}
                        rows={cvTable.data.map((item, index) => packageRow({ ...item, isHot: undefined }, index, cvQuery.page))}
                        total={cvTable.data.length > 0 ? `Tổng doanh thu: ${formatMoney(cvTable.sum)}` : null}
                        actions={(
                            <button type="button" className="jf-btn jf-btn--ghost"
                                onClick={() => exportPackages(getStatisticalPackageCv, period, false, 'Doanh thu goi xem ung vien')}>
                                <i className="fas fa-file-excel" aria-hidden="true" /> Xuất Excel
                            </button>
                        )}
                    />
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
