import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
    DEFAULT_PROMO_CATALOG,
    deleteAdminPromoCodeService,
    getAdminPromoCodesService,
    upsertAdminPromoCodeService,
} from '../../../service/rewardPaymentService';
import '../Rewards/EmployerRewardsSection.css';

const PURPOSE_LABELS = {
    POINT_TOPUP: 'Ứng viên nạp điểm',
    PACKAGE_POST: 'Doanh nghiệp mua gói đăng tin',
    PACKAGE_CV: 'Doanh nghiệp mua gói xem CV',
};

const EMPTY_FORM = {
    code: '',
    discountType: 'FIXED',
    discount: 10000,
    discountPercent: 10,
    maxDiscount: 50000,
    minAmount: 20000,
    provider: '',
    purpose: '',
    expiresAt: '',
    description: '',
    isActive: true,
};

const ManagePromoCode = () => {
    const [promoList, setPromoList] = useState([]);
    const [summary, setSummary] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingCode, setEditingCode] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);
    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [providerFilter, setProviderFilter] = useState('ALL');

    const loadPromos = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await getAdminPromoCodesService();
            if (res && res.errCode === 0 && Array.isArray(res.data)) {
                setPromoList(res.data);
                setSummary(res.summary || null);
            } else {
                setPromoList(Object.values(DEFAULT_PROMO_CATALOG));
            }
        } catch (_err) {
            setPromoList(Object.values(DEFAULT_PROMO_CATALOG));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPromos();
    }, [loadPromos]);

    const effectivePromos = useMemo(() => {
        const list = promoList.length > 0 ? promoList : Object.values(DEFAULT_PROMO_CATALOG);
        const kw = String(searchText || '').trim().toLowerCase();
        return list.filter((item) => {
            const active = item.isActive !== false;
            if (statusFilter === 'ACTIVE' && !active) return false;
            if (statusFilter === 'INACTIVE' && active) return false;
            if (providerFilter !== 'ALL') {
                if (providerFilter === 'ANY' && item.provider) return false;
                if (providerFilter !== 'ANY' && item.provider !== providerFilter) return false;
            }
            if (!kw) return true;
            const codeMatch = String(item.code || '').toLowerCase().includes(kw);
            const descMatch = String(item.description || item.label || '').toLowerCase().includes(kw);
            return codeMatch || descMatch;
        });
    }, [promoList, searchText, statusFilter, providerFilter]);

    const kpis = useMemo(() => {
        const all = promoList.length > 0 ? promoList : Object.values(DEFAULT_PROMO_CATALOG);
        const activeCount = all.filter((i) => i.isActive !== false).length;
        const percentCount = all.filter(
            (i) => i.discountType === 'PERCENT' || Number(i.discountPercent) > 0
        ).length;
        return {
            totalCodes: summary?.totalCodes ?? all.length,
            activeCodes: summary?.activeCodes ?? activeCount,
            inactiveCodes: summary?.inactiveCodes ?? all.length - activeCount,
            percentCount,
            fixedCount: all.length - percentCount,
            totalOrdersWithPromo: Number(summary?.totalOrdersWithPromo || 0),
            totalDiscountGrantedVnd: Number(summary?.totalDiscountGrantedVnd || 0),
        };
    }, [promoList, summary]);

    const resetForm = () => {
        setEditingCode('');
        setForm(EMPTY_FORM);
    };

    const handleEdit = (item) => {
        setEditingCode(item.code);
        setForm({
            code: item.code || '',
            discountType: item.discountType === 'PERCENT' ? 'PERCENT' : 'FIXED',
            discount: Number(item.discount ?? item.discountVnd ?? 10000) || 10000,
            discountPercent: Number(item.discountPercent ?? 10) || 10,
            maxDiscount: Number(item.maxDiscount ?? 0) || 0,
            minAmount: Number(item.minAmount ?? item.minAmountVnd ?? 0) || 0,
            provider: item.provider || '',
            purpose: item.purpose || '',
            expiresAt: item.expiresAt ? String(item.expiresAt).slice(0, 10) : '',
            description: item.description || item.label || '',
            isActive: item.isActive !== false,
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const code = String(form.code || '').trim().toUpperCase();
        if (!code || !/^[A-Z0-9_-]{3,32}$/.test(code)) {
            toast.warning?.('Mã giảm giá cần từ 3 đến 32 ký tự (chữ in hoa, số, dấu gạch ngang/dưới).');
            return;
        }
        setSaving(true);
        try {
            const res = await upsertAdminPromoCodeService({
                ...form,
                code,
                provider: form.provider || null,
                purpose: form.purpose || null,
                expiresAt: form.expiresAt || null,
            });
            if (res && res.errCode === 0) {
                toast.success?.(res.errMessage || `Đã lưu mã giảm giá ${code}`);
                resetForm();
                await loadPromos();
            } else {
                toast.error?.(res?.errMessage || 'Không thể lưu mã giảm giá.');
            }
        } catch (_err) {
            toast.error?.('Lỗi kết nối khi lưu mã giảm giá.');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (item) => {
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
                await loadPromos();
            } else {
                toast.error?.(res?.errMessage || 'Không thể cập nhật trạng thái mã.');
            }
        } catch (_err) {
            toast.error?.('Không thể cập nhật trạng thái mã.');
        }
    };

    const handleDelete = async (code) => {
        try {
            const res = await deleteAdminPromoCodeService(code);
            if (res && res.errCode === 0) {
                toast.success?.(res.errMessage || `Đã xóa mã giảm giá ${code}`);
                if (editingCode === code) resetForm();
                await loadPromos();
            } else {
                toast.error?.(res?.errMessage || 'Không thể xóa mã giảm giá.');
            }
        } catch (_err) {
            toast.error?.('Không thể xóa mã giảm giá.');
        }
    };

    return (
        <section className="jf-admin-rewards" aria-label="Quản lý mã giảm giá">
            <div className="jf-admin-rewards__header">
                <div>
                    <h2 className="jf-admin-rewards__title">Quản lý Mã giảm giá &amp; Ưu đãi thanh toán</h2>
                    <p className="jf-admin-rewards__subtitle">
                        Tạo mới, chỉnh sửa mức giảm (tiền mặt hoặc %), cấu hình điều kiện cổng thanh toán và bật/tắt các mã ưu đãi cho Ứng viên &amp; Nhà tuyển dụng.
                    </p>
                </div>
                <button
                    type="button"
                    className="jf-admin-rewards__btn"
                    onClick={loadPromos}
                    disabled={isLoading}
                >
                    {isLoading ? 'Đang tải...' : 'Làm mới'}
                </button>
            </div>

            <div className="jf-admin-rewards__kpis">
                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Tổng số mã ưu đãi</div>
                    <div className="jf-admin-rewards__kpi-value">{kpis.totalCodes} mã</div>
                    <div className="jf-admin-rewards__kpi-meta">
                        Đang bật: {kpis.activeCodes} • Tạm ngưng: {kpis.inactiveCodes}
                    </div>
                </div>
                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Cơ cấu loại ưu đãi</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {kpis.fixedCount} tiền mặt / {kpis.percentCount} theo %
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">
                        Áp dụng tự động trên Modal nạp điểm &amp; Mua gói
                    </div>
                </div>
                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Đơn thanh toán dùng mã</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {kpis.totalOrdersWithPromo.toLocaleString('vi-VN')} đơn
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">Tính trên các đơn đã thanh toán thành công</div>
                </div>
                <div className="jf-admin-rewards__kpi">
                    <div className="jf-admin-rewards__kpi-label">Tổng số tiền đã giảm</div>
                    <div className="jf-admin-rewards__kpi-value">
                        {kpis.totalDiscountGrantedVnd.toLocaleString('vi-VN')} VNĐ
                    </div>
                    <div className="jf-admin-rewards__kpi-meta">Tổng giá trị ưu đãi khách hàng đã nhận</div>
                </div>
            </div>

            <div className="jf-admin-rewards__section">
                <div className="jf-admin-rewards__toolbar">
                    <h3 className="jf-emp-catalog-title">
                        {editingCode ? `Chỉnh sửa mã giảm giá: ${editingCode}` : 'Thêm mã giảm giá mới'}
                    </h3>
                </div>

                <form
                    onSubmit={handleSubmit}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                        gap: '12px',
                        padding: '16px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                    }}
                >
                    <div>
                        <label
                            htmlFor="manage-promo-code"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Mã giảm giá *
                        </label>
                        <input
                            id="manage-promo-code"
                            type="text"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            placeholder="VD: JOBFIND50K"
                            value={form.code}
                            onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="manage-promo-type"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Hình thức giảm
                        </label>
                        <select
                            id="manage-promo-type"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={form.discountType}
                            onChange={(e) => setForm((p) => ({ ...p, discountType: e.target.value }))}
                        >
                            <option value="FIXED">Giảm tiền mặt (VNĐ)</option>
                            <option value="PERCENT">Giảm theo phần trăm (%)</option>
                        </select>
                    </div>

                    {form.discountType === 'PERCENT' ? (
                        <>
                            <div>
                                <label
                                    htmlFor="manage-promo-pct"
                                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                                >
                                    Phần trăm giảm (%)
                                </label>
                                <input
                                    id="manage-promo-pct"
                                    type="number"
                                    min="1"
                                    max="90"
                                    className="jf-admin-rewards__select"
                                    style={{ width: '100%' }}
                                    value={form.discountPercent}
                                    onChange={(e) =>
                                        setForm((p) => ({ ...p, discountPercent: Number(e.target.value) }))
                                    }
                                />
                            </div>
                            <div>
                                <label
                                    htmlFor="manage-promo-max"
                                    style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                                >
                                    Giảm tối đa (VNĐ)
                                </label>
                                <input
                                    id="manage-promo-max"
                                    type="number"
                                    min="0"
                                    step="1000"
                                    className="jf-admin-rewards__select"
                                    style={{ width: '100%' }}
                                    value={form.maxDiscount}
                                    onChange={(e) => setForm((p) => ({ ...p, maxDiscount: Number(e.target.value) }))}
                                />
                            </div>
                        </>
                    ) : (
                        <div>
                            <label
                                htmlFor="manage-promo-discount"
                                style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                            >
                                Số tiền giảm (VNĐ)
                            </label>
                            <input
                                id="manage-promo-discount"
                                type="number"
                                min="1000"
                                step="1000"
                                className="jf-admin-rewards__select"
                                style={{ width: '100%' }}
                                value={form.discount}
                                onChange={(e) => setForm((p) => ({ ...p, discount: Number(e.target.value) }))}
                            />
                        </div>
                    )}

                    <div>
                        <label
                            htmlFor="manage-promo-min"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Đơn tối thiểu (VNĐ)
                        </label>
                        <input
                            id="manage-promo-min"
                            type="number"
                            min="0"
                            step="5000"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={form.minAmount}
                            onChange={(e) => setForm((p) => ({ ...p, minAmount: Number(e.target.value) }))}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="manage-promo-provider"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Cổng thanh toán
                        </label>
                        <select
                            id="manage-promo-provider"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={form.provider}
                            onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value }))}
                        >
                            <option value="">Tất cả các cổng</option>
                            <option value="VNPAY">Chỉ VNPAY</option>
                            <option value="MOMO">Chỉ MoMo</option>
                            <option value="ZALOPAY">Chỉ ZaloPay</option>
                            <option value="PAYPAL">Chỉ PayPal</option>
                        </select>
                    </div>

                    <div>
                        <label
                            htmlFor="manage-promo-purpose"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Phạm vi giao dịch
                        </label>
                        <select
                            id="manage-promo-purpose"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={form.purpose}
                            onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))}
                        >
                            <option value="">Mọi giao dịch</option>
                            <option value="POINT_TOPUP">Ứng viên nạp điểm</option>
                            <option value="PACKAGE_POST">Mua gói đăng tin</option>
                            <option value="PACKAGE_CV">Mua gói xem CV</option>
                        </select>
                    </div>

                    <div>
                        <label
                            htmlFor="manage-promo-expires"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Ngày hết hạn (tùy chọn)
                        </label>
                        <input
                            id="manage-promo-expires"
                            type="date"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            value={form.expiresAt}
                            onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
                        />
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                        <label
                            htmlFor="manage-promo-desc"
                            style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}
                        >
                            Mô tả hiển thị
                        </label>
                        <input
                            id="manage-promo-desc"
                            type="text"
                            className="jf-admin-rewards__select"
                            style={{ width: '100%' }}
                            placeholder="VD: Giảm 20.000đ cho đơn từ 100.000đ"
                            value={form.description}
                            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                        <button
                            type="submit"
                            className="jf-admin-rewards__btn"
                            disabled={saving}
                            style={{ background: '#252b60', color: '#fff', borderColor: '#252b60' }}
                        >
                            {saving ? 'Đang lưu...' : editingCode ? 'Cập nhật mã' : 'Tạo mã giảm giá'}
                        </button>
                        {(editingCode || form.code) && (
                            <button type="button" className="jf-admin-rewards__btn" onClick={resetForm}>
                                Hủy / Đặt lại
                            </button>
                        )}
                    </div>
                </form>
            </div>

            <div className="jf-admin-rewards__section">
                <div className="jf-admin-rewards__toolbar">
                    <h3 className="jf-emp-catalog-title">
                        Danh sách Mã giảm giá ({effectivePromos.length})
                    </h3>
                    <div className="jf-admin-rewards__filters">
                        <input
                            type="text"
                            aria-label="Tìm kiếm mã giảm giá"
                            className="jf-admin-rewards__select"
                            placeholder="Tìm theo mã hoặc mô tả..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                        />
                        <select
                            aria-label="Lọc cổng thanh toán"
                            className="jf-admin-rewards__select"
                            value={providerFilter}
                            onChange={(e) => setProviderFilter(e.target.value)}
                        >
                            <option value="ALL">Mọi cổng thanh toán</option>
                            <option value="ANY">Áp dụng tất cả cổng</option>
                            <option value="VNPAY">Chỉ VNPAY</option>
                            <option value="MOMO">Chỉ MoMo</option>
                            <option value="ZALOPAY">Chỉ ZaloPay</option>
                            <option value="PAYPAL">Chỉ PayPal</option>
                        </select>
                        <select
                            aria-label="Lọc trạng thái mã"
                            className="jf-admin-rewards__select"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="ALL">Tất cả trạng thái</option>
                            <option value="ACTIVE">Đang hoạt động</option>
                            <option value="INACTIVE">Đang tạm ngưng</option>
                        </select>
                    </div>
                </div>

                <div className="jf-admin-rewards__table-wrap">
                    <table className="jf-admin-rewards__table">
                        <thead>
                            <tr>
                                <th>Mã ưu đãi</th>
                                <th>Mức giảm</th>
                                <th>Đơn tối thiểu</th>
                                <th>Cổng &amp; Phạm vi</th>
                                <th>Mô tả</th>
                                <th>Lượt dùng</th>
                                <th>Trạng thái</th>
                                <th>Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {effectivePromos.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', color: '#64748b' }}>
                                        Không tìm thấy mã giảm giá nào phù hợp với bộ lọc.
                                    </td>
                                </tr>
                            ) : (
                                effectivePromos.map((item) => {
                                    const isPercent =
                                        item.discountType === 'PERCENT' || Number(item.discountPercent) > 0;
                                    const discountVal = Number(item.discount ?? item.discountVnd ?? 0);
                                    const minVal = Number(item.minAmount ?? item.minAmountVnd ?? 0);
                                    const active = item.isActive !== false;
                                    return (
                                        <tr key={item.code}>
                                            <td>
                                                <strong>{item.code}</strong>
                                                {item.expiresAt && (
                                                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                                                        HSD: {new Date(item.expiresAt).toLocaleDateString('vi-VN')}
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                {isPercent ? (
                                                    <strong style={{ color: '#047857' }}>
                                                        -{item.discountPercent}%
                                                        {Number(item.maxDiscount) > 0
                                                            ? ` (tối đa ${Number(item.maxDiscount).toLocaleString('vi-VN')}đ)`
                                                            : ''}
                                                    </strong>
                                                ) : (
                                                    <strong style={{ color: '#047857' }}>
                                                        -{discountVal.toLocaleString('vi-VN')} VNĐ
                                                    </strong>
                                                )}
                                            </td>
                                            <td>{minVal.toLocaleString('vi-VN')} VNĐ</td>
                                            <td>
                                                <div>{item.provider ? `Cổng ${item.provider}` : 'Tất cả cổng'}</div>
                                                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                                                    {item.purpose
                                                        ? PURPOSE_LABELS[item.purpose] || item.purpose
                                                        : 'Mọi giao dịch'}
                                                </div>
                                            </td>
                                            <td>{item.description || item.label || '—'}</td>
                                            <td>
                                                <div>{Number(item.paidCount || 0)} đơn TT</div>
                                                {Number(item.totalDiscountVnd || 0) > 0 && (
                                                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                                                        -{Number(item.totalDiscountVnd).toLocaleString('vi-VN')}đ
                                                    </div>
                                                )}
                                            </td>
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
                                                        onClick={() => handleEdit(item)}
                                                    >
                                                        Sửa
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="jf-admin-rewards__btn"
                                                        style={{ padding: '3px 8px', fontSize: '12px' }}
                                                        onClick={() => handleToggleActive(item)}
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
                                                        onClick={() => handleDelete(item.code)}
                                                    >
                                                        Xóa
                                                    </button>
                                                </div>
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

export default ManagePromoCode;
