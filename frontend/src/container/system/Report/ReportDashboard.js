import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import dayjs from "dayjs";
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
    getActivity, getOverview, getTimeseries, getDistribution, getSystemFunnel, getAuditLogs
} from "../../../service/adminReportService";
import { useLocation } from "react-router-dom";
import useListQuery from "../../../util/useListQuery";
import {
    DEFAULT_PERIOD, REPORT_PERIODS, STAGE_LABELS, bucketSeries, byDay, describeEvent,
    formatMoney, formatNumber, labelAuditSources, percentChange, resolvePeriod, topWithOther,
} from "../Dashboard/dashboardData";
import { EmptyState, KpiCard, Panel, PeriodPicker, RankList } from "../Dashboard/DashboardParts";
import "../Dashboard/Dashboard.css";
import "./ReportDashboard.scss";

// Bang bao cao cua quan tri vien.
//
// Gop so lieu tu ba nguon khac nhau (MySQL, PostgreSQL, MongoDB) nhung nguoi xem
// khong can biet dieu do - Admin Service da noi lai o phia may chu, giao dien chi
// goi mot API cho moi khoi.

// Bang mau dung chung cho tat ca bieu do, de cac khoi nhin nhu mot the thong nhat.
const COLORS = ["#4b49ac", "#7da0fa", "#f3797e", "#7978e9", "#98bdff", "#ffc100", "#57b657"];
const AXIS = { fontSize: 12, fill: "#6b7084" };
const AUDIT_PAGE = 15;
const AUDIT_FILTERS = [
    { key: "", label: "Tất cả" },
    { key: "action", label: "Thao tác người dùng" },
    { key: "event", label: "Sự kiện hệ thống" },
];
const ROLE_LABELS = { ADMIN: "Quản trị", COMPANY: "Chủ công ty", EMPLOYER: "Nhà tuyển dụng", CANDIDATE: "Ứng viên" };

const dataOf = (promise) => Promise.resolve(promise).then(
    (response) => (response?.errCode === 0 ? response.data : undefined),
    () => undefined
);

const auditTitle = (log) => (log.kind === "event" ? describeEvent(log).title : log.name);

const ReportDashboard = () => {
    const [query, setQuery] = useListQuery({ period: DEFAULT_PERIOD, from: "", to: "" });
    const period = useMemo(() => resolvePeriod(query), [query]);
    const [report, setReport] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const sequence = useRef(0);

    const [auditKind, setAuditKind] = useState("");
    const [audit, setAudit] = useState({ rows: [], count: 0, loading: true, failed: false });
    const auditSequence = useRef(0);

    useEffect(() => {
        const request = ++sequence.current;
        setIsLoading(true);
        const range = { fromDate: period.from, toDate: period.to };
        Promise.all([
            dataOf(getOverview(range)),
            dataOf(getOverview({ fromDate: period.previous.from, toDate: period.previous.to })),
            dataOf(getTimeseries(range)),
            dataOf(getDistribution()),
            dataOf(getSystemFunnel()),
            dataOf(getActivity(range)),
        ]).then(([overview, previous, series, distribution, funnel, activity]) => {
            if (request !== sequence.current) return;
            if (!overview) toast.error("Không tải được số liệu tổng quan");
            setReport({ overview, previous, series, distribution, funnel, activity });
            setIsLoading(false);
        });
        return () => { sequence.current += 1; };
    }, [period]);

    // Nhat ky co bo loc va phan trang rieng: doi bo loc thi tai lai tu dau,
    // "Xem them" thi noi tiep trang sau.
    const loadAudit = useCallback(async (kind, offset) => {
        const request = ++auditSequence.current;
        setAudit((current) => ({ ...current, loading: true, failed: false }));
        const params = { limit: AUDIT_PAGE, ...(kind ? { kind } : {}), ...(offset ? { offset } : {}) };
        let response;
        try { response = await getAuditLogs(params); } catch { response = undefined; }
        if (request !== auditSequence.current) return;
        if (response?.errCode !== 0) {
            setAudit((current) => ({ ...current, loading: false, failed: true }));
            return;
        }
        setAudit((current) => ({
            rows: offset ? [...current.rows, ...(response.data || [])] : response.data || [],
            count: Number(response.count) || 0,
            loading: false,
            failed: false,
        }));
    }, []);
    useEffect(() => { loadAudit(auditKind, 0); }, [auditKind, loadAudit]);

    // Lien ket "Xem nhat ky" tu dashboard (#audit): cuon toi khi bang da hien.
    const { hash } = useLocation();
    const reportReady = Boolean(report);
    useEffect(() => {
        if (hash !== "#audit" || !reportReady) return;
        document.getElementById("audit")?.scrollIntoView?.({ block: "start" });
    }, [hash, reportReady]);

    const daily = useMemo(() => {
        const series = report?.series || {};
        return bucketSeries({
            tin: byDay(series.tinTuyenDung),
            nguoiDung: byDay(series.nguoiDungMoi),
            hoSo: byDay(series.hoSoUngTuyen),
            goiTin: byDay(series.doanhThu, "tien"),
            goiXemCv: byDay(series.doanhThuXemCv, "tien"),
        }, period);
    }, [report, period]);

    if (isLoading && !report) return <div className="report-dashboard"><div className="rp-loading">Đang tải số liệu…</div></div>;

    const { overview, previous, distribution: dist, funnel, activity } = report;
    const change = (now, before) => (now == null || before == null ? undefined : percentChange(now, before));
    const hasActivity = daily.points.some((point) => point.tin || point.nguoiDung || point.hoSo);
    const hasRevenue = daily.points.some((point) => point.goiTin || point.goiXemCv);
    const categories = topWithOther(dist?.theoNganhNghe, 7);
    const salaries = (dist?.theoMucLuong || []).map((row) => ({ ten: row.ten || "Chưa rõ", soLuong: Number(row.soLuong) || 0 }));
    const funnelRows = (funnel?.pheu || []).map((row) => ({ ...row, ten: STAGE_LABELS[row.stage] || row.ten }));
    const services = labelAuditSources(activity?.theoService);
    const bucketLabel = daily.monthly ? "theo tháng" : "theo ngày";

    return (
        <div className={"report-dashboard jf-dash" + (isLoading ? " is-busy" : "")} aria-busy={isLoading}>
            <header className="jf-dash__header">
                <div>
                    <p className="jf-dash__eyebrow">Phân tích</p>
                    <h1 className="jf-dash__title">Báo cáo &amp; Thống kê</h1>
                    <p className="jf-dash__subtitle">
                        Số liệu tổng hợp từ toàn hệ thống · <strong>{dayjs(period.from).format("DD/MM/YYYY")} – {dayjs(period.to).format("DD/MM/YYYY")}</strong>
                    </p>
                </div>
                <div className="jf-dash__toolbar">
                    <PeriodPicker period={period} options={REPORT_PERIODS} onChange={(next) => setQuery(next)} />
                </div>
            </header>

            {overview ? (
                <section className="jf-kpi-grid rp-kpis" aria-label="Chỉ số chính">
                    <KpiCard id="users" label="Người dùng" icon="fas fa-users" tone="primary"
                        value={formatNumber(overview.nguoiDung.tong)}
                        hint={`+${formatNumber(overview.nguoiDung.moi)} mới trong kỳ`} />
                    <KpiCard id="companies" label="Công ty" icon="far fa-building" tone="violet"
                        value={formatNumber(overview.congTy)} hint="Đã đăng ký trên hệ thống" />
                    <KpiCard id="jobs" label="Tin đang hiển thị" icon="fas fa-briefcase" tone="info"
                        value={formatNumber(overview.tinTuyenDung.dangHienThi)}
                        hint={`${formatNumber(overview.tinTuyenDung.choDuyet)} chờ duyệt`} />
                    <KpiCard id="applications" label="Hồ sơ ứng tuyển" icon="fas fa-file-alt" tone="warning"
                        value={formatNumber(overview.hoSoUngTuyen.tong)}
                        change={change(overview.hoSoUngTuyen.tong, previous?.hoSoUngTuyen?.tong)}
                        hint={`${formatNumber(overview.hoSoUngTuyen.daTuyen)} đã tuyển`} />
                    <KpiCard id="revenue" label="Doanh thu" icon="fas fa-wallet" tone="success"
                        value={formatMoney(overview.doanhThu.tong)}
                        change={change(overview.doanhThu.tong, previous?.doanhThu?.tong)}
                        hint={`Tin: ${formatMoney(overview.doanhThu.goiTin)} · CV: ${formatMoney(overview.doanhThu.goiXemCv)}`} />
                    <KpiCard id="new-users" label="Người dùng mới" icon="fas fa-user-plus" tone="neutral"
                        value={formatNumber(overview.nguoiDung.moi)}
                        change={change(overview.nguoiDung.moi, previous?.nguoiDung?.moi)}
                        hint="So với kỳ liền trước" />
                </section>
            ) : <p className="jf-inline-error" role="alert">Không tải được số liệu tổng quan. Chọn lại khoảng thời gian để thử lại.</p>}

            <div className="jf-dash__grid rp-two">
                <Panel title={`Hoạt động ${bucketLabel}`} subtitle="Tin tuyển dụng, người dùng mới và hồ sơ ứng tuyển">
                    {!hasActivity ? <EmptyState>Chưa có dữ liệu trong khoảng thời gian này</EmptyState> : (
                        <ResponsiveContainer width="100%" height={290}>
                            <LineChart data={daily.points}>
                                <CartesianGrid vertical={false} stroke="#eef0f6" />
                                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
                                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line type="monotone" dataKey="tin" name="Tin tuyển dụng" stroke={COLORS[0]} strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="nguoiDung" name="Người dùng mới" stroke={COLORS[6]} strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="hoSo" name="Hồ sơ ứng tuyển" stroke={COLORS[2]} strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </Panel>
                <Panel title={`Doanh thu ${bucketLabel}`} subtitle="Theo nguồn gói dịch vụ (USD)">
                    {!hasRevenue ? <EmptyState>Chưa phát sinh doanh thu trong khoảng thời gian này</EmptyState> : (
                        <ResponsiveContainer width="100%" height={290}>
                            <BarChart data={daily.points}>
                                <CartesianGrid vertical={false} stroke="#eef0f6" />
                                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
                                <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} />
                                <Tooltip formatter={(value) => formatMoney(value)} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Bar dataKey="goiTin" name="Gói đăng tin" stackId="revenue" fill={COLORS[0]} />
                                <Bar dataKey="goiXemCv" name="Gói xem ứng viên" stackId="revenue" fill={COLORS[1]} radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Panel>
            </div>

            <div className="jf-dash__grid jf-dash__grid--thirds">
                <Panel title="Tin theo ngành nghề" subtitle="Tin đang hiển thị">
                    {!categories.rows.length ? <EmptyState /> : <RankList rows={categories.rows} />}
                </Panel>
                <Panel title="Tin theo tỉnh thành" subtitle="Top 8 tỉnh/thành">
                    {!dist?.theoTinhThanh?.length ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={dist.theoTinhThanh.slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
                                <CartesianGrid horizontal={false} stroke="#eef0f6" />
                                <XAxis type="number" tick={AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
                                <YAxis type="category" dataKey="ten" width={96} tick={{ ...AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip />
                                <Bar dataKey="soLuong" name="Số tin" fill={COLORS[1]} radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Panel>
                <Panel title="Tin theo mức lương" subtitle="Tin đang hiển thị">
                    {!salaries.length ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={salaries}>
                                <CartesianGrid vertical={false} stroke="#eef0f6" />
                                <XAxis dataKey="ten" tick={{ ...AXIS, fontSize: 11 }} interval={0} tickLine={false} axisLine={false} />
                                <YAxis tick={AXIS} allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                                <Tooltip />
                                <Bar dataKey="soLuong" name="Số tin" fill={COLORS[3]} radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Panel>
            </div>

            <div className="jf-dash__grid jf-dash__grid--thirds">
                <Panel title="Phễu tuyển dụng" subtitle="Hồ sơ theo giai đoạn hiện tại"
                    actions={funnel && <span className="rp-badge">Tỷ lệ tuyển {funnel.tyLeTuyen}%</span>}>
                    {!funnelRows.length ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={funnelRows}>
                                <CartesianGrid vertical={false} stroke="#eef0f6" />
                                <XAxis dataKey="ten" tick={{ ...AXIS, fontSize: 10 }} interval={0} angle={-20}
                                    textAnchor="end" height={60} tickLine={false} axisLine={false} />
                                <YAxis tick={AXIS} allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                                <Tooltip />
                                <Bar dataKey="soLuong" name="Hồ sơ" radius={[4, 4, 0, 0]}>
                                    {funnelRows.map((row, i) => (
                                        <Cell key={row.stage || i} fill={row.stage === "tu_choi" ? COLORS[2] : COLORS[0]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Panel>
                <Panel title="Người dùng theo vai trò">
                    {!dist?.theoVaiTro?.length ? <EmptyState /> : (
                        <ResponsiveContainer width="100%" height={280}>
                            <PieChart>
                                <Pie data={dist.theoVaiTro} dataKey="soLuong" nameKey="ten"
                                    cx="50%" cy="45%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                                    {dist.theoVaiTro.map((entry, i) => (
                                        <Cell key={entry.ten || i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </Panel>
                <Panel title="Công ty nhận nhiều hồ sơ nhất" subtitle="Toàn thời gian">
                    {!funnel?.topCongTy?.length ? <EmptyState /> : (
                        <table className="jf-table rp-compact">
                            <thead><tr><th scope="col">Công ty</th><th scope="col" className="is-numeric">Hồ sơ</th><th scope="col" className="is-numeric">Đã tuyển</th></tr></thead>
                            <tbody>
                                {funnel.topCongTy.slice(0, 8).map((row) => (
                                    <tr key={row.congTyId ?? "none"}>
                                        <td>{row.tenCongTy || (row.congTyId ? `Công ty #${row.congTyId}` : "Không rõ")}</td>
                                        <td className="is-numeric">{formatNumber(row.soHoSo)}</td>
                                        <td className="is-numeric">{formatNumber(row.daTuyen)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Panel>
            </div>

            {services.length > 0 && (
                <Panel title="Lưu lượng theo dịch vụ" subtitle="Số bản ghi nhật ký mỗi dịch vụ tạo ra trong kỳ">
                    <RankList rows={topWithOther(services, 8).rows} color="violet" />
                </Panel>
            )}

            <Panel id="audit" title="Nhật ký hoạt động"
                subtitle={audit.count ? `${formatNumber(audit.count)} bản ghi · lưu tối đa 180 ngày` : "Thao tác người dùng qua API Gateway và sự kiện giữa các dịch vụ"}
                actions={(
                    <div className="jf-tabs" role="tablist" aria-label="Lọc nhật ký">
                        {AUDIT_FILTERS.map((filter) => (
                            <button key={filter.key || "all"} type="button" role="tab" aria-selected={auditKind === filter.key}
                                className={"jf-tabs__item" + (auditKind === filter.key ? " is-active" : "")}
                                onClick={() => setAuditKind(filter.key)}>{filter.label}</button>
                        ))}
                    </div>
                )}>
                {audit.failed && !audit.rows.length ? <p className="jf-inline-error" role="alert">Không tải được nhật ký hoạt động.</p>
                    : !audit.rows.length ? (audit.loading ? <EmptyState icon="far fa-clock">Đang tải nhật ký…</EmptyState>
                        : <EmptyState>Chưa có hoạt động nào được ghi</EmptyState>) : (
                        <div className="rp-logs">
                            <table className="jf-table">
                                <thead>
                                    <tr>
                                        <th scope="col">Thời gian</th>
                                        <th scope="col">Loại</th>
                                        <th scope="col">Hoạt động</th>
                                        <th scope="col">Người thực hiện</th>
                                        <th scope="col">Đối tượng</th>
                                        <th scope="col" className="is-numeric">Kết quả</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {audit.rows.map((l) => (
                                        <tr key={l._id}>
                                            <td className="nowrap">{dayjs(l.createdAt).format("HH:mm:ss DD/MM/YYYY")}</td>
                                            <td><span className={`rp-tag ${l.kind}`}>{l.kind === "action" ? "Thao tác" : "Sự kiện"}</span></td>
                                            <td className="rp-logs__name">
                                                {auditTitle(l)}
                                                {l.kind === "event" && <small>{l.name}</small>}
                                            </td>
                                            <td>
                                                {l.actorId ? `#${l.actorId}` : "hệ thống"}
                                                {l.actorRole ? ` (${ROLE_LABELS[l.actorRole] || l.actorRole})` : ""}
                                            </td>
                                            <td>{l.targetType ? `${l.targetType} #${l.targetId}` : "—"}</td>
                                            <td className="is-numeric">
                                                {l.status ? <span className={`rp-status ${l.status >= 400 ? "is-error" : "is-ok"}`}>{l.status}</span> : "—"}
                                                {l.durationMs != null && <small className="rp-duration">{formatNumber(l.durationMs)} ms</small>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                {audit.rows.length > 0 && audit.rows.length < audit.count && (
                    <div className="rp-more">
                        <button type="button" className="jf-btn jf-btn--ghost" disabled={audit.loading}
                            onClick={() => loadAudit(auditKind, audit.rows.length)}>
                            {audit.loading ? "Đang tải…" : `Xem thêm (${formatNumber(audit.count - audit.rows.length)} bản ghi)`}
                        </button>
                    </div>
                )}
            </Panel>
        </div>
    );
};

export default ReportDashboard;
