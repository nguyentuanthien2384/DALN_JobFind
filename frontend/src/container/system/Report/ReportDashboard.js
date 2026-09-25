import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
    getOverview, getTimeseries, getDistribution, getSystemFunnel, getAuditLogs
} from "../../../service/adminReportService";
import "./ReportDashboard.scss";

// Bang bao cao cua quan tri vien.
//
// Gop so lieu tu ba nguon khac nhau (MySQL, PostgreSQL, MongoDB) nhung nguoi xem
// khong can biet dieu do - Admin Service da noi lai o phia may chu, giao dien chi
// goi mot API cho moi khoi.

// Bang mau dung chung cho tat ca bieu do, de cac khoi nhin nhu mot the thong nhat.
const COLORS = ["#2563eb", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#ec4899"];

const money = (n) => Number(n || 0).toLocaleString("vi-VN");
const shortDate = (d) => {
    if (!d) return "";
    const date = new Date(d);
    return `${date.getDate()}/${date.getMonth() + 1}`;
};

const ReportDashboard = () => {
    const [overview, setOverview] = useState(null);
    const [series, setSeries] = useState(null);
    const [dist, setDist] = useState(null);
    const [funnel, setFunnel] = useState(null);
    const [logs, setLogs] = useState([]);
    const [days, setDays] = useState(30);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            setIsLoading(true);
            const to = new Date();
            const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
            const params = {
                fromDate: from.toISOString().slice(0, 10),
                toDate: to.toISOString().slice(0, 10)
            };

            const [ov, ts, ds, fn, lg] = await Promise.all([
                getOverview(params), getTimeseries(params), getDistribution(),
                getSystemFunnel(), getAuditLogs({ limit: 15 })
            ]);
            if (!mounted) return;

            if (ov?.errCode === 0) setOverview(ov.data);
            else toast.error("Không tải được số liệu tổng quan");
            if (ts?.errCode === 0) setSeries(ts.data);
            if (ds?.errCode === 0) setDist(ds.data);
            if (fn?.errCode === 0) setFunnel(fn.data);
            if (lg?.errCode === 0) setLogs(lg.data || []);
            setIsLoading(false);
        };
        load();
        return () => { mounted = false; };
    }, [days]);

    // Gop hai chuoi (tin tuyen dung + nguoi dung moi) vao mot mang de ve chung
    // mot bieu do - recharts can du lieu dang mot hang mot moc thoi gian.
    const mergedSeries = React.useMemo(() => {
        if (!series) return [];
        const byDate = new Map();
        const put = (rows, key) => {
            (rows || []).forEach((r) => {
                const d = shortDate(r.ngay);
                if (!byDate.has(d)) byDate.set(d, { ngay: d });
                byDate.get(d)[key] = Number(r.soLuong ?? r.tien ?? 0);
            });
        };
        put(series.tinTuyenDung, "tin");
        put(series.nguoiDungMoi, "nguoiDung");
        put(series.hoSoUngTuyen, "hoSo");
        return [...byDate.values()];
    }, [series]);

    if (isLoading) return <div className="report-dashboard"><div className="rp-loading">Đang tải số liệu…</div></div>;

    return (
        <div className="report-dashboard">
            <div className="rp-head">
                <div>
                    <h3>Báo cáo &amp; Thống kê</h3>
                    <p className="rp-sub">Số liệu tổng hợp từ toàn hệ thống</p>
                </div>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    <option value={7}>7 ngày qua</option>
                    <option value={30}>30 ngày qua</option>
                    <option value={90}>90 ngày qua</option>
                    <option value={365}>1 năm qua</option>
                </select>
            </div>

            {/* Khoi so lieu lon */}
            {overview && (
                <div className="rp-cards">
                    <Card label="Người dùng" value={overview.nguoiDung.tong}
                        sub={`+${overview.nguoiDung.moi} mới`} color="#2563eb" />
                    <Card label="Công ty" value={overview.congTy} color="#8b5cf6" />
                    <Card label="Tin đang hiển thị" value={overview.tinTuyenDung.dangHienThi}
                        sub={`${overview.tinTuyenDung.choDuyet} chờ duyệt`} color="#10b981" />
                    <Card label="Hồ sơ ứng tuyển" value={overview.hoSoUngTuyen.tong}
                        sub={`${overview.hoSoUngTuyen.daTuyen} đã tuyển`} color="#f59e0b" />
                    <Card label="Doanh thu" value={money(overview.doanhThu.tong)}
                        sub={`Tin: ${money(overview.doanhThu.goiTin)} · CV: ${money(overview.doanhThu.goiXemCv)}`}
                        color="#ef4444" wide />
                </div>
            )}

            <div className="rp-grid">
                {/* Bieu do duong theo thoi gian */}
                <div className="rp-panel wide">
                    <h4>Hoạt động theo thời gian</h4>
                    {mergedSeries.length === 0 ? (
                        <Empty text="Chưa có dữ liệu trong khoảng thời gian này" />
                    ) : (
                        <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={mergedSeries}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                                <XAxis dataKey="ngay" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                                <Tooltip />
                                <Legend />
                                <Line type="monotone" dataKey="tin" name="Tin tuyển dụng"
                                    stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="nguoiDung" name="Người dùng mới"
                                    stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="hoSo" name="Hồ sơ ứng tuyển"
                                    stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Phan bo theo nganh nghe */}
                <div className="rp-panel">
                    <h4>Tin theo ngành nghề</h4>
                    {!dist?.theoNganhNghe?.length ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={260}>
                            <PieChart>
                                <Pie data={dist.theoNganhNghe} dataKey="soLuong" nameKey="ten"
                                    cx="50%" cy="50%" outerRadius={85} label={(e) => e.soLuong}>
                                    {dist.theoNganhNghe.map((entry, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Phan bo theo tinh thanh */}
                <div className="rp-panel">
                    <h4>Tin theo tỉnh thành</h4>
                    {!dist?.theoTinhThanh?.length ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={dist.theoTinhThanh.slice(0, 8)} layout="vertical"
                                margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                                <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                                <YAxis type="category" dataKey="ten" width={90} tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <Bar dataKey="soLuong" name="Số tin" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Pheu tuyen dung */}
                <div className="rp-panel">
                    <h4>
                        Phễu tuyển dụng
                        {funnel && <span className="rp-badge">Tỷ lệ tuyển {funnel.tyLeTuyen}%</span>}
                    </h4>
                    {!funnel?.pheu?.length ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={funnel.pheu}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                                <XAxis dataKey="ten" tick={{ fontSize: 10 }} interval={0} angle={-20}
                                    textAnchor="end" height={60} />
                                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                                <Tooltip />
                                <Bar dataKey="soLuong" name="Hồ sơ" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Phan bo vai tro */}
                <div className="rp-panel">
                    <h4>Người dùng theo vai trò</h4>
                    {!dist?.theoVaiTro?.length ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={260}>
                            <PieChart>
                                <Pie data={dist.theoVaiTro} dataKey="soLuong" nameKey="ten"
                                    cx="50%" cy="50%" innerRadius={45} outerRadius={85}
                                    label={(e) => e.soLuong}>
                                    {dist.theoVaiTro.map((entry, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Nhat ky hoat dong */}
                <div className="rp-panel wide">
                    <h4>Nhật ký hoạt động gần đây</h4>
                    {logs.length === 0 ? <Empty text="Chưa có hoạt động nào được ghi" /> : (
                        <div className="rp-logs">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Thời gian</th>
                                        <th>Loại</th>
                                        <th>Hoạt động</th>
                                        <th>Người thực hiện</th>
                                        <th>Đối tượng</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((l) => (
                                        <tr key={l._id}>
                                            <td className="nowrap">
                                                {new Date(l.createdAt).toLocaleString("vi-VN")}
                                            </td>
                                            <td>
                                                <span className={`rp-tag ${l.kind}`}>
                                                    {l.kind === "action" ? "Thao tác" : "Sự kiện"}
                                                </span>
                                            </td>
                                            <td>{l.name}</td>
                                            <td>
                                                {l.actorId ? `#${l.actorId}` : "hệ thống"}
                                                {l.actorRole ? ` (${l.actorRole})` : ""}
                                            </td>
                                            <td>
                                                {l.targetType ? `${l.targetType} #${l.targetId}` : "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Card = ({ label, value, sub, color, wide }) => (
    <div className={`rp-card ${wide ? "wide" : ""}`} style={{ borderTopColor: color }}>
        <div className="rp-card-label">{label}</div>
        <div className="rp-card-value" style={{ color }}>{value}</div>
        {sub && <div className="rp-card-sub">{sub}</div>}
    </div>
);

const Empty = ({ text }) => (
    <div className="rp-empty">{text || "Chưa có dữ liệu"}</div>
);

export default ReportDashboard;
