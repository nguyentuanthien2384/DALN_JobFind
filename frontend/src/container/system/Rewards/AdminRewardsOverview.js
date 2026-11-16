import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
    DEFAULT_PROMO_CATALOG,
    deleteAdminPromoCodeService,
    getAdminRewardsOverviewService,
    upsertAdminPromoCodeService,
} from '../../../service/rewardPaymentService';
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

const EMPTY_PROMO_FORM = {
    code: '',
    discountType: 'FIXED',
    discount: 10000,
    discountPercent: 10,
    maxDiscount: 50000,
    minAmount: 20000,
    provider: '',
    purpose: '',
    description: '',
    isActive: true,
};

const AdminRewardsOverview = () => {
    const [purpose, setPurpose] = useState('');
    const [status, setStatus] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [overview, setOverview] = useState(null);
    const [promoForm, setPromoForm] = useState(EMPTY_PROMO_FORM);
    const [savingPromo, setSavingPromo] = useState(false);

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
    const promoCodes =
        Array.isArray(overview?.promoCodes) && overview.promoCodes.length > 0
            ? overview.promoCodes
            : Object.values(DEFAULT_PROMO_CATALOG);

    const handleSavePromo = async (e) => {
        e.preventDefault();
        const code = String(promoForm.code || '').trim().toUpperCase();
        if (!code) {
            toast.warning?.('Vui lòng nhập mã giảm giá.');
            return;
        }
        setSavingPromo(true);
        try {
            const res = await upsertAdminPromoCodeService({
                ...promoForm,
                code,
                provider: promoForm.provider || null,
                purpose: promoForm.purpose || null,
            });
            if (res && res.errCode === 0) {
                toast.success?.(res.errMessage || `Đã lưu mã ${code}`);
                setPromoForm(EMPTY_PROMO_FORM);
                if (Array.isArray(res.promoCodes)) {
                    setOverview((prev) => ({ ...(prev || {}), promoCodes: res.promoCodes }));
                } else {
                    await loadOverview();
                }
            } else {
                toast.error?.(res?.errMessage || 'Không thể lưu mã giảm giá.');
            }
        } catch (_err) {
            toast.error?.('Không thể kết nối máy chủ khi lưu mã giảm giá.');
        } finally {
            setSavingPromo(false);
        }
    };

    const handleTogglePromo = async (item) => {
        try {
            const res = await upsertAdminPromoCodeService({
                ...item,
                code: item.code,
                isActive: item.isActive === false,
            });
            if (res && res.errCode === 0) {
                toast.success?.(
                    item.isActive === false
                        ? `Đã kích hoạt lại mã ${item.code}`
                        : `Đã tạm ngưng mã ${item.code}`
                );
                if (Array.isArray(res.promoCodes)) {
                    setOverview((prev) => ({ ...(prev || {}), promoCodes: res.promoCodes }));
                } else {
                    await loadOverview();
                }
            } else {
                toast.error?.(res?.errMessage || 'Không thể cập nhật trạng thái mã.');
            }
        } catch (_err) {
            toast.error?.('Không thể cập nhật trạng thái mã.');
        }
    };

    const handleDeletePromo = async (code) => {
        try {
            const res = await deleteAdminPromoCodeService(code);
            if (res && res.errCode === 0) {
                toast.success?.(res.errMessage || `Đã xóa mã ${code}`);
                if (Array.isArray(res.promoCodes)) {
                    setOverview((prev) => ({ ...(prev || {}), promoCodes: res.promoCodes }));
                } else {
                    await loadOverview();
                }
            } else {
                toast.error?.(res?.errMessage || 'Không thể xóa mã giảm giá.');
            }
        } catch (_err) {
            toast.error?.('Không thể xóa mã giảm giá.');
        }
    };

    const handleEditPromo = (item) => {
        setPromoForm({
            code: item.code || '',
            discountType: item.discountType === 'PERCENT' ? 'PERCENT' : 'FIXED',
            discount: Number(item.discount ?? item.discountVnd ?? 10000) || 10000,
            discountPercent: Number(item.discountPercent ?? 10) || 10,
            maxDiscount: Number(item.maxDiscount ?? 0) || 0,
            minAmount: Number(item.minAmount ?? item.minAmountVnd ?? 0) || 0,
            provider: item.provider || '',
            purpose: item.purpose || '',
            description: item.description || item.label || '',
            isActive: item.isActive !== false,
        });
    };

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
                    <h3 className="jf-emp-catalog-title">Quản lý Mã giảm giá (Promo Codes)</h3>
                </div>

                <form
                    onSubmit={handleSavePromo}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: '10px',
                        padding: '14px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        marginBottom: '14px',
                    }}
                >
                    <div>
                        <label htmlFor="promo-code-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            Mã ưu đãi *
                        </label>
                        <input
                            id="promo-code-input"
                            type="text"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            placeholder="VD: SUMMER20K"
                            value={promoForm.code}
                            onChange={(e) => setPromoForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                        />
                    </div>
                    <div>
                        <label htmlFor="promo-type-select" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            Hình thức giảm
                        </label>
                        <select
                            id="promo-type-select"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={promoForm.discountType}
                            onChange={(e) => setPromoForm((p) => ({ ...p, discountType: e.target.value }))}
                        >
                            <option value="FIXED">Giảm tiền mặt (VNĐ)</option>
                            <option value="PERCENT">Giảm theo phần trăm (%)</option>
                        </select>
                    </div>
                    {promoForm.discountType === 'PERCENT' ? (
                        <>
                            <div>
                                <label htmlFor="promo-percent-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                                    Mức giảm (%)
                                </label>
                                <input
                                    id="promo-percent-input"
                                    type="number"
                                    min="1"
                                    max="90"
                                    className="jf-admin-rewards__select"
                                    style={{ width: '100%' }}
                                    value={promoForm.discountPercent}
                                    onChange={(e) => setPromoForm((p) => ({ ...p, discountPercent: Number(e.target.value) }))}
                                />
                            </div>
                            <div>
                                <label htmlFor="promo-max-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                                    Giảm tối đa (VNĐ)
                                </label>
                                <input
                                    id="promo-max-input"
                                    type="number"
                                    min="0"
                                    step="1000"
                                    className="jf-admin-rewards__select"
                                    style={{ width: '100%' }}
                                    value={promoForm.maxDiscount}
                                    onChange={(e) => setPromoForm((p) => ({ ...p, maxDiscount: Number(e.target.value) }))}
                                />
                            </div>
                        </>
                    ) : (
                        <div>
                            <label htmlFor="promo-amount-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                                Số tiền giảm (VNĐ)
                            </label>
                            <input
                                id="promo-amount-input"
                                type="number"
                                min="1000"
                                step="1000"
                                className="jf-admin-rewards__select"
                                style={{ width: '100%' }}
                                value={promoForm.discount}
                                onChange={(e) => setPromoForm((p) => ({ ...p, discount: Number(e.target.value) }))}
                            />
                        </div>
                    )}
                    <div>
                        <label htmlFor="promo-min-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            Đơn tối thiểu (VNĐ)
                        </label>
                        <input
                            id="promo-min-input"
                            type="number"
                            min="0"
                            step="5000"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={promoForm.minAmount}
                            onChange={(e) => setPromoForm((p) => ({ ...p, minAmount: Number(e.target.value) }))}
                        />
                    </div>
                    <div>
                        <label htmlFor="promo-provider-select" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            Cổng thanh toán
                        </label>
                        <select
                            id="promo-provider-select"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={promoForm.provider}
                            onChange={(e) => setPromoForm((p) => ({ ...p, provider: e.target.value }))}
                        >
                            <option value="">Tất cả các cổng</option>
                            <option value="VNPAY">Chỉ VNPAY</option>
                            <option value="MOMO">Chỉ MoMo</option>
                            <option value="ZALOPAY">Chỉ ZaloPay</option>
                            <option value="PAYPAL">Chỉ PayPal</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="promo-purpose-select" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            Phạm vi giao dịch
                        </label>
                        <select
                            id="promo-purpose-select"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={promoForm.purpose}
                            onChange={(e) => setPromoForm((p) => ({ ...p, purpose: e.target.value }))}
                        >
                            <option value="">Mọi giao dịch</option>
                            <option value="POINT_TOPUP">Ứng viên nạp điểm</option>
                            <option value="PACKAGE_POST">Mua gói đăng tin</option>
                            <option value="PACKAGE_CV">Mua gói xem CV</option>
                        </select>
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                        <label htmlFor="promo-desc-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                            Mô tả hiển thị
                        </label>
                        <input
                            id="promo-desc-input"
                            type="text"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            placeholder="VD: Giảm 20.000đ cho đơn từ 100.000đ"
                            value={promoForm.description}
                            onChange={(e) => setPromoForm((p) => ({ ...p, description: e.target.value }))}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                        <button
                            type="submit"
                            className="jf-admin-rewards__btn"
                            disabled={savingPromo}
                            style={{ background: '#252b60', color: '#fff', borderColor: '#252b60' }}
                        >
                            {savingPromo ? 'Đang lưu...' : 'Lưu mã giảm giá'}
                        </button>
                        {promoForm.code && (
                            <button
                                type="button"
                                className="jf-admin-rewards__btn"
                                onClick={() => setPromoForm(EMPTY_PROMO_FORM)}
                            >
                                Đặt lại
                            </button>
                        )}
                    </div>
                </form>

                <div className="jf-admin-rewards__table-wrap">
                    <table className="jf-admin-rewards__table">
                        <thead>
                            <tr>
                                <th>Mã ưu đãi</th>
                                <th>Mức giảm</th>
                                <th>Đơn tối thiểu</th>
                                <th>Cổng / Phạm vi</th>
                                <th>Mô tả</th>
                                <th>Trạng thái</th>
                                <th>Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {promoCodes.map((item) => {
                                const isPercent =
                                    item.discountType === 'PERCENT' || Number(item.discountPercent) > 0;
                                const discountVal = Number(item.discount ?? item.discountVnd ?? 0);
                                const minVal = Number(item.minAmount ?? item.minAmountVnd ?? 0);
                                const active = item.isActive !== false;
                                return (
                                    <tr key={item.code}>
                                        <td>
                                            <strong>{item.code}</strong>
                                        </td>
                                        <td>
                                            {isPercent ? (
                                                <span>
                                                    -{item.discountPercent}%
                                                    {Number(item.maxDiscount) > 0
                                                        ? ` (tối đa ${Number(item.maxDiscount).toLocaleString('vi-VN')}đ)`
                                                        : ''}
                                                </span>
                                            ) : (
                                                <span>-{discountVal.toLocaleString('vi-VN')} VNĐ</span>
                                            )}
                                        </td>
                                        <td>{minVal.toLocaleString('vi-VN')} VNĐ</td>
                                        <td>
                                            <div>{item.provider ? `Cổng ${item.provider}` : 'Tất cả cổng'}</div>
                                            <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                                                {item.purpose ? PURPOSE_LABELS[item.purpose] || item.purpose : 'Mọi giao dịch'}
                                            </div>
                                        </td>
                                        <td>{item.description || item.label || '—'}</td>
                                        <td>
                                            <span
                                                className={
                                                    active
                                                        ? 'jf-admin-rewards__status jf-admin-rewards__status--paid'
                                                        : 'jf-admin-rewards__status jf-admin-rewards__status--failed'
                                                }
                                            >
                                                {active ? 'Đang bật' : 'Tạm ngưng'}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                <button
                                                    type="button"
                                                    className="jf-admin-rewards__btn"
                                                    style={{ padding: '3px 8px', fontSize: '12px' }}
                                                    onClick={() => handleEditPromo(item)}
                                                >
                                                    Sửa
                                                </button>
                                                <button
                                                    type="button"
                                                    className="jf-admin-rewards__btn"
                                                    style={{ padding: '3px 8px', fontSize: '12px' }}
                                                    onClick={() => handleTogglePromo(item)}
                                                >
                                                    {active ? 'Tạm ngưng' : 'Bật lại'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="jf-admin-rewards__btn"
                                                    style={{
                                                        padding: '3px 8px',
                                                        fontSize: '12px',
                                                        color: '#b91c1c',
                                                        borderColor: '#fecaca',
                                                    }}
                                                    onClick={() => handleDeletePromo(item.code)}
                                                >
                                                    Xóa
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
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
