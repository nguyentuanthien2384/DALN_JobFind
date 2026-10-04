import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { toast } from 'react-toastify';
import { DatePicker } from 'antd';
import { getStatisticalTypePost } from '../../../service/userService';
import { getStatisticalCv } from '../../../service/cvService';
import { PAGINATION } from '../../../util/constant';
import useAutoRefresh from '../../../util/useAutoRefresh';
import { hasPermission, PERMISSIONS } from '../../../auth/accessControl';
import AutoRefreshInfo from '../AutoRefreshInfo';
import { useStatisticsQuery, useStatisticsTable } from './useStatisticsTable';
import StatisticsTable from './StatisticsTable';
import { EmptyState, Panel, RankList } from './DashboardParts';
import { formatNumber } from './dashboardData';
import './Dashboard.css';

const SHORTCUTS = [
    { to: '/admin/add-post/', icon: 'fas fa-plus', label: 'Đăng tin mới', hint: 'Tạo tin tuyển dụng', permission: PERMISSIONS.MANAGE_POSTS },
    { to: '/admin/pipeline/', icon: 'fas fa-columns', label: 'Quy trình tuyển dụng', hint: 'Kanban hồ sơ ứng viên', permission: PERMISSIONS.MANAGE_CANDIDATES },
    { to: '/admin/interviews/', icon: 'far fa-calendar-alt', label: 'Lịch phỏng vấn', hint: 'Sắp xếp và theo dõi buổi hẹn', permission: PERMISSIONS.MANAGE_CANDIDATES },
    { to: '/admin/list-candiate/', icon: 'fas fa-search', label: 'Tìm ứng viên', hint: 'Lọc theo kỹ năng, ngành', permission: PERMISSIONS.MANAGE_CANDIDATES },
    { to: '/admin/chat', icon: 'far fa-comments', label: 'Tin nhắn', hint: 'Trao đổi với ứng viên', permission: PERMISSIONS.USE_CHAT },
];

// Bien du lieu "top linh vuc" thanh danh sach xep hang, gop phan con lai.
const toRanking = (response) => {
    const total = Number(response.totalPost) || 0;
    const rows = (response.data || []).map(item => ({
        name: item.postDetailData?.jobTypePostData?.value || 'Chưa phân loại',
        value: Number(item.amount) || 0,
    }));
    const other = total - rows.reduce((sum, row) => sum + row.value, 0);
    if (other > 0) rows.push({ name: 'Lĩnh vực khác', value: other, other: true });
    return rows.map(row => ({ ...row, share: total ? (row.value / total) * 100 : 0 }));
};

/** Dashboard cua nha tuyen dung (chu cong ty va nhan vien tuyen dung). */
const CompanyDashboard = ({ user }) => {
    const { RangePicker } = DatePicker;
    const today = dayjs().format('YYYY-MM-DD');
    const [categories, setCategories] = useState([]);
    const [chartError, setChartError] = useState('');
    const [locCv, setLocCv] = useStatisticsQuery({ fromDate: today, toDate: today, page: 0 }, 'cv.');
    const cvTable = useStatisticsTable(locCv, setLocCv, getStatisticalCv, Boolean(user.companyId), user.companyId);

    // Tu dong cap nhat chay lien tuc nen neu API loi keo dai se do toast lien
    // tuc 30 giay mot cai. Chi bao MOT lan, tai lai duoc thi mo khoa de lan sau
    // hong nua van con bao.
    const daBaoLoiBieuDo = useRef(false);
    const loadCategories = async () => {
        let res;
        try {
            res = await getStatisticalTypePost(4);
        } catch {
            res = { errCode: -1 };
        }
        if (res?.errCode === 0) {
            setCategories(toRanking(res));
            setChartError('');
            daBaoLoiBieuDo.current = false;
            return;
        }
        const message = res?.errMessage && res.errMessage !== 'Error from server'
            ? res.errMessage : res?.message || 'Không tải được biểu đồ thống kê. Vui lòng thử Làm mới.';
        setChartError(message);
        if (!daBaoLoiBieuDo.current) {
            daBaoLoiBieuDo.current = true;
            toast.error(message);
        }
    };

    const { capNhatLuc, dangTai, lamMoi } = useAutoRefresh(() => Promise.all([loadCategories(), cvTable.reload()]));
    useEffect(() => {
        loadCategories();
        // Table effects separately load the restored URL filters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onDatePicker = (values) => {
        const fromDate = values?.[0]?.format('YYYY-MM-DD') || today;
        const toDate = values?.[1]?.format('YYYY-MM-DD') || today;
        if (fromDate !== locCv.fromDate || toDate !== locCv.toDate) setLocCv({ fromDate, toDate, page: 0 });
    };
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const shortcuts = SHORTCUTS.filter(item => hasPermission(user, item.permission));

    return (
        <div className="jf-dash">
            <header className="jf-dash__header">
                <div>
                    <p className="jf-dash__eyebrow">Khu vực nhà tuyển dụng</p>
                    <h1 className="jf-dash__title">Tổng quan tuyển dụng</h1>
                    <p className="jf-dash__subtitle">{name ? `Xin chào ${name}. ` : ''}Theo dõi hồ sơ ứng tuyển và thị trường tuyển dụng.</p>
                </div>
                <div className="jf-dash__toolbar">
                    <AutoRefreshInfo capNhatLuc={capNhatLuc} dangTai={dangTai} onLamMoi={lamMoi} />
                </div>
            </header>

            {shortcuts.length > 0 && (
                <nav className="jf-shortcuts" aria-label="Lối tắt">
                    {shortcuts.map(item => (
                        <Link key={item.to} to={item.to} className="jf-shortcut">
                            <span className="jf-shortcut__icon"><i className={item.icon} aria-hidden="true" /></span>
                            <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                        </Link>
                    ))}
                </nav>
            )}

            <div className="jf-dash__grid jf-dash__grid--company">
                {user.companyId && (
                    <StatisticsTable
                        title="Hồ sơ nhận được theo tin"
                        subtitle="Số CV ứng viên nộp vào từng tin trong khoảng ngày đã chọn"
                        toolbar={(
                            <RangePicker
                                value={[dayjs(locCv.fromDate), dayjs(locCv.toDate)]}
                                format="DD/MM/YYYY"
                                allowClear={false}
                                onChange={(values) => onDatePicker(values)}
                            />
                        )}
                        table={cvTable}
                        page={locCv.page}
                        resetKey={JSON.stringify([locCv.fromDate, locCv.toDate])}
                        onPageChange={page => setLocCv({ page })}
                        columns={['#', 'Tin tuyển dụng', 'Mã tin', 'Người đăng', 'Số CV']}
                        alignRight={[4]}
                        rows={cvTable.data.map((item, index) => ({
                            key: item.id,
                            cells: [
                                index + 1 + locCv.page * PAGINATION.pagerow,
                                item.postDetailData?.name,
                                `#${item.id}`,
                                [item.userPostData?.firstName, item.userPostData?.lastName].filter(Boolean).join(' '),
                                formatNumber(item.total),
                            ],
                        }))}
                    />
                )}
                <Panel title="Lĩnh vực có nhiều tin tuyển dụng" subtitle="Toàn hệ thống JobFind">
                    {chartError ? <EmptyState icon="fas fa-exclamation-circle">{chartError}</EmptyState>
                        : categories.length > 0 ? <div data-testid="job-type-chart"><RankList rows={categories} unit=" tin" /></div>
                            : <EmptyState>{dangTai ? 'Đang tải biểu đồ thống kê...' : 'Chưa có dữ liệu thống kê lĩnh vực.'}</EmptyState>}
                </Panel>
            </div>
        </div>
    );
};

export default CompanyDashboard;
