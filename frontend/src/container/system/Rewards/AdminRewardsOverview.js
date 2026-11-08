import React, { useCallback, useEffect, useState } from 'react';
import { getAdminRewardsOverviewService } from '../../../service/rewardPaymentService';
import './EmployerRewardsSection.css';

const PURPOSE_LABELS = {
    POINT_TOPUP: 'Ứng viên nạp điểm',
    PACKAGE_POST: 'Doanh nghiệp mua gói đăng tin',
    PACKAGE_CV: 'Doanh nghiệp mua gói xem CV',
};

const STATUS_LABELS = {
    PAID: 'Đã thanh toán',
    PENDING: 'Chờ thanh toán',
    FAILED: 'Thất bại',
    CANCELLED: 'Đã hủy',
};

const statusClassName = (status) => {
    if (status === 'PAID') return 'jf-admin-rewards__status jf-admin-rewards__status--paid';
    if (status === 'PENDING') return 'jf-admin-rewards__status jf-admin-rewards__status--pending';
    return 'jf-admin-rewards__status jf-admin-rewards__status--failed';
};

const AdminRewardsOverview = () => {
    const [purpose, setPurpose] = useState('');
    const [status, setStatus] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [overview, setOverview] = useState(null);

    const loadOverview = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage('');
        try {
            const res = await getAdminRewardsOverviewService({
                purpose: purpose || undefined,
                status: status || undefined,
                limit: 20,
            });
            if (res && res.errCode === 0) {
                setOverview(res.data || null);
            } else if (res && res.errCode !== 0) {
                setErrorMessage(res.errMessage || 'Không thể tải dữ liệu quản lý nạp & tích điểm.');
            }
        } catch (_err) {
            setErrorMessage('Không thể tải dữ liệu quản lý nạp & tích điểm.');
        } finally {
            setIsLoading(false);
        }
    }, [purpose, status]);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    const summary = overview?.summary || {};
    const candidateWallets = summary.candidateWallets || {};
    const companyWallets = summary.companyWallets || {};
    const orders = Array.isArray(overview?.orders) ? overview.orders : [];
    const transactions = Array.isArray(overview?.transactions) ? overview.transactions : [];

    return (
        <section className="jf-admin-rewards" aria-label="Quản lý nạp & tích điểm toàn hệ thống">
            <div className="jf-admin-rewards__header">
                <div>
                    <h2 className="jf-admin-rewards__title">Quản lý Nạp điểm &amp; Tích điểm toàn hệ thống</h2>
                    <p className="jf-admin-rewards__subtitle">
                        Giám sát đơn thanh toán và biến động ví điểm của Ứng viên (Điểm) và Công ty (Top Point). Quản trị viên chỉ có quyền đối soát, không tự nạp hoặc đổi điểm.
                    </p>
                </div>
                <button
                    type="button"
                    className="jf-admin-rewards__btn"
                    onClick={loadOverview}
                    disabled={isLoading}
                >
                    {isLoading ? 'Đang tải...' : 'Làm mới'}
                </button>
            </div>

            {errorMessage && (
                <div className="jf-emp-rewards__permission-notice" role="alert">
                    {errorMessage}
                </div>
            )}

            <div className="jf-admin-rewards__kpis">
                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Tổng doanh thu thanh toán</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {Number(summary.totalPaidRevenueVnd || 0).toLocaleString('vi-VN')} VNĐ
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">
                        Nạp điểm UV: {Number(summary.candidateTopupPaidVnd || 0).toLocaleString('vi-VN')} VNĐ • Gói DN:{' '}
                        {Number(summary.companyPackagePaidVnd || 0).toLocaleString('vi-VN')} VNĐ
                    </div>
                </div>

                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Đơn giao dịch thành công</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {Number(summary.paidOrders || 0).toLocaleString('vi-VN')} đơn
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">
                        Tổng {Number(summary.totalOrders || 0)} đơn • Đang chờ: {Number(summary.pendingOrders || 0)}
                    </div>
                </div>

                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Ví điểm Ứng viên</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {Number(candidateWallets.totalBalance || 0).toLocaleString('vi-VN')} điểm
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">
                        {Number(candidateWallets.walletCount || 0)} ví • Đã tích:{' '}
                        {Number(candidateWallets.totalEarned || 0)} / Đã dùng: {Number(candidateWallets.totalSpent || 0)}
                    </div>
                </div>

                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Ví Top Point Doanh nghiệp</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {Number(companyWallets.totalBalance || 0).toLocaleString('vi-VN')} Top Point
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">
                        {Number(companyWallets.walletCount || 0)} công ty • Đã tích:{' '}
                        {Number(companyWallets.totalEarned || 0)} / Đã đổi: {Number(companyWallets.totalSpent || 0)}
                    </div>
                </div>
            </div>

            <div className="jf-admin-rewards__section">
                <div className="jf-admin-rewards__toolbar">
                    <h3 className="jf-emp-catalog-title">Đơn thanh toán trên hệ thống</h3>
                    <div className="jf-admin-rewards__filters">
                        <label htmlFor="admin-reward-purpose" className="sr-only">
                            Loại giao dịch
                        </label>
                        <select
                            id="admin-reward-purpose"
                            aria-label="Loại giao dịch"
                            className="jf-admin-rewards__select"
                            value={purpose}
                            onChange={(e) => setPurpose(e.target.value)}
                        >
                            <option value="">Tất cả loại giao dịch</option>
                            <option value="POINT_TOPUP">Ứng viên nạp điểm</option>
                            <option value="PACKAGE_POST">Doanh nghiệp mua gói đăng tin</option>
                            <option value="PACKAGE_CV">Doanh nghiệp mua gói xem CV</option>
                        </select>

                        <label htmlFor="admin-reward-status" className="sr-only">
                            Trạng thái đơn
                        </label>
                        <select
                            id="admin-reward-status"
                            aria-label="Trạng thái đơn"
                            className="jf-admin-rewards__select"
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                        >
                            <option value="">Tất cả trạng thái</option>
                            <option value="PAID">Đã thanh toán</option>
                            <option value="PENDING">Chờ thanh toán</option>
                            <option value="FAILED">Thất bại</option>
                            <option value="CANCELLED">Đã hủy</option>
                        </select>
                    </div>
                </div>

                <div className="jf-admin-rewards__table-wrap">
                    <table className="jf-admin-rewards__table">
                        <thead>
                            <tr>
                                <th>Mã đơn</th>
                                <th>Người thực hiện / Công ty</th>
                                <th>Loại giao dịch</th>
                                <th>Cổng TT</th>
                                <th>Số tiền</th>
                                <th>Điểm cộng</th>
                                <th>Trạng thái</th>
                                <th>Thời gian</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', color: '#64748b' }}>
                                        Chưa có đơn giao dịch nào phù hợp với bộ lọc hiện tại.
                                    </td>
                                </tr>
                            ) : (
                                orders.map((order) => {
                                    const amountVnd = Number(order.amount ?? order.finalAmountVnd ?? 0);
                                    const pointsGranted = Number(order.points ?? order.pointsGranted ?? 0);
                                    return (
                                        <tr key={order.id || order.orderCode}>
                                            <td>
                                                <strong>{order.orderCode}</strong>
                                            </td>
                                            <td>
                                                <div>{order.actorName || `Tài khoản #${order.userId}`}</div>
                                                {order.companyName && (
                                                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                                                        {order.companyName}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <div>{PURPOSE_LABELS[order.purpose] || order.purpose}</div>
                                                {order.itemName && (
                                                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                                                        {order.itemName}
                                                    </div>
                                                )}
                                            </td>
                                            <td>{order.provider}</td>
                                            <td>{amountVnd.toLocaleString('vi-VN')} VNĐ</td>
                                            <td>{pointsGranted > 0 ? `+${pointsGranted}` : '—'}</td>
                                            <td>
                                                <span className={statusClassName(order.status)}>
                                                    {STATUS_LABELS[order.status] || order.status}
                                                </span>
                                            </td>
                                            <td>
                                                {order.createdAt
                                                    ? new Date(order.createdAt).toLocaleString('vi-VN')
                                                    : '—'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="jf-admin-rewards__section">
                <h3 className="jf-emp-catalog-title" style={{ marginBottom: '12px' }}>
                    Nhật ký biến động ví điểm gần đây
                </h3>
                <div className="jf-admin-rewards__table-wrap">
                    <table className="jf-admin-rewards__table">
                        <thead>
                            <tr>
                                <th>Nhóm ví</th>
                                <th>Chủ sở hữu</th>
                                <th>Nội dung giao dịch</th>
                                <th>Biến động</th>
                                <th>Số dư sau GD</th>
                                <th>Thời gian</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                                        Chưa có lịch sử biến động ví điểm trên hệ thống.
                                    </td>
                                </tr>
                            ) : (
                                transactions.map((tx) => {
                                    const delta = Number(tx.pointsDelta || 0);
                                    const unit = tx.ownerType === 'COMPANY' ? 'Top Point' : 'điểm';
                                    return (
                                        <tr key={tx.id}>
                                            <td>{tx.ownerType === 'COMPANY' ? 'Doanh nghiệp' : 'Ứng viên'}</td>
                                            <td>{tx.ownerLabel || `#${tx.ownerId}`}</td>
                                            <td>{tx.description || tx.transactionType}</td>
                                            <td
                                                style={{
                                                    fontWeight: 600,
                                                    color: delta >= 0 ? '#047857' : '#b91c1c',
                                                }}
                                            >
                                                {delta >= 0 ? `+${delta}` : delta} {unit}
                                            </td>
                                            <td>
                                                {Number(tx.balanceAfter || 0)} {unit}
                                            </td>
                                            <td>
                                                {tx.createdAt
                                                    ? new Date(tx.createdAt).toLocaleString('vi-VN')
                                                    : '—'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    );
};

export default AdminRewardsOverview;
