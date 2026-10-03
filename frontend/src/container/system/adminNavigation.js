import { hasCompanyMembership, hasPermission, PERMISSIONS as P } from '../../auth/accessControl';

/**
 * Mot nguon duy nhat cho menu, breadcrumb, nut thao tac chinh va tieu de tab
 * cua khu quan tri.
 *
 * Menu chia theo nhom nghiep vu (section) giong cac backoffice lon. Moi muc la
 * mot lien ket (`to`) hoac mot nhom con (`children`). Trang "Them moi" khong
 * nam trong menu nua: no la nut thao tac chinh (`action`) tren trang danh sach,
 * con breadcrumb van biet no thuoc danh sach nao nho HIDDEN_ROUTES.
 */

const DASHBOARD = { key: 'dashboard', to: '/admin/', label: 'Tổng quan', icon: 'fas fa-th-large', permission: P.VIEW_ADMIN_HOME };
const CHAT = { key: 'chat', to: '/admin/chat', label: 'Tin nhắn', icon: 'far fa-comments', permission: P.USE_CHAT, badge: 'unreadChat' };

const ADMIN_SECTIONS = [
    { key: 'main', items: [DASHBOARD, CHAT] },
    {
        key: 'moderation', title: 'Kiểm duyệt & hỗ trợ', items: [
            { key: 'admin-post', to: '/admin/list-post-admin/', label: 'Tin tuyển dụng', icon: 'fas fa-clipboard-check', permission: P.MODERATE_POSTS, badge: 'pendingPosts' },
            { key: 'admin-company', to: '/admin/list-company-admin/', label: 'Công ty', icon: 'far fa-building', permission: P.MODERATE_COMPANIES, badge: 'pendingCompanies' },
            { key: 'support', to: '/admin/support', label: 'Yêu cầu hỗ trợ', icon: 'fas fa-headset', permission: P.SUPPORT_MANAGE, badge: 'waitingSupport' },
        ],
    },
    {
        key: 'insight', title: 'Báo cáo', items: [
            { key: 'report', to: '/admin/reports/', label: 'Báo cáo tổng hợp', icon: 'fas fa-chart-pie', permission: P.VIEW_PLATFORM_REPORTS },
            {
                key: 'revenue', title: 'Doanh thu theo năm', icon: 'fas fa-chart-bar', permission: P.VIEW_PLATFORM_REPORTS, children: [
                    { to: '/admin/sum-by-year-post/', label: 'Doanh thu gói đăng tin' },
                    { to: '/admin/sum-by-year-cv/', label: 'Doanh thu gói xem ứng viên' },
                ],
            },
        ],
    },
    {
        key: 'commerce', title: 'Kinh doanh', items: [
            { key: 'package-post', to: '/admin/list-package-post/', label: 'Gói đăng tin', icon: 'fas fa-box-open', permission: P.MANAGE_PACKAGES, action: { to: '/admin/add-package-post/', label: 'Thêm gói đăng tin' } },
            { key: 'package-cv', to: '/admin/list-package-cv/', label: 'Gói xem ứng viên', icon: 'fas fa-id-card', permission: P.MANAGE_PACKAGES, action: { to: '/admin/add-package-cv/', label: 'Thêm gói xem ứng viên' } },
        ],
    },
    {
        key: 'system', title: 'Hệ thống', items: [
            { key: 'user', to: '/admin/list-user/', label: 'Người dùng', icon: 'fas fa-users', permission: P.MANAGE_USERS, action: { to: '/admin/add-user/', label: 'Thêm người dùng' } },
            {
                key: 'catalog', title: 'Danh mục tuyển dụng', icon: 'fas fa-sitemap', permission: P.MANAGE_REFERENCE_DATA, children: [
                    { to: '/admin/list-job-type/', label: 'Ngành nghề', action: { to: '/admin/add-job-type/', label: 'Thêm ngành nghề' } },
                    { to: '/admin/list-job-skill/', label: 'Kỹ năng', action: { to: '/admin/add-job-skill/', label: 'Thêm kỹ năng' } },
                    { to: '/admin/list-job-level/', label: 'Cấp bậc', action: { to: '/admin/add-job-level/', label: 'Thêm cấp bậc' } },
                    { to: '/admin/list-work-type/', label: 'Hình thức làm việc', action: { to: '/admin/add-work-type/', label: 'Thêm hình thức' } },
                    { to: '/admin/list-salary-type/', label: 'Khoảng lương', action: { to: '/admin/add-salary-type/', label: 'Thêm khoảng lương' } },
                    { to: '/admin/list-exp-type/', label: 'Kinh nghiệm', action: { to: '/admin/add-exp-type/', label: 'Thêm kinh nghiệm' } },
                ],
            },
        ],
    },
];

const RECRUITING_POSTS = {
    key: 'company-post', title: 'Quản lý bài đăng', icon: 'fas fa-briefcase', permission: P.MANAGE_POSTS, children: [
        { to: '/admin/add-post/', label: 'Tạo mới bài đăng' },
        { to: '/admin/list-post/', label: 'Danh sách bài đăng' },
        { to: '/admin/buy-post/', label: 'Mua thêm lượt đăng bài', permission: P.PURCHASE_PACKAGES },
    ],
};
const RECRUITING_CANDIDATES = {
    key: 'company-candidate', title: 'Quản lý ứng viên', icon: 'fas fa-user-check', permission: P.MANAGE_CANDIDATES, children: [
        { to: '/admin/pipeline/', label: 'Quy trình tuyển dụng' },
        { to: '/admin/list-candiate/', label: 'Tìm kiếm ứng viên' },
        { to: '/admin/buy-cv/', label: 'Mua thêm lượt xem ứng viên', permission: P.PURCHASE_PACKAGES },
    ],
};

const COMPANY_SECTIONS = [
    { key: 'main', items: [DASHBOARD, CHAT] },
    { key: 'recruiting', title: 'Tuyển dụng', items: [RECRUITING_POSTS, RECRUITING_CANDIDATES] },
    {
        key: 'company', title: 'Doanh nghiệp', items: [
            {
                key: 'company-info', title: 'Quản lý công ty', icon: 'far fa-building', permission: P.MANAGE_COMPANY, children: [
                    { to: '/admin/edit-company/', label: 'Thông tin công ty', permission: P.MANAGE_COMPANY },
                    { to: '/admin/recruitment/', label: 'Tuyển dụng vào công ty', permission: P.MANAGE_TEAM },
                    { to: '/admin/list-employer/', label: 'Danh sách nhân viên', permission: P.MANAGE_TEAM },
                    { to: '/admin/add-user/', label: 'Thêm nhân viên', permission: P.MANAGE_TEAM },
                ],
            },
            {
                key: 'company-history', title: 'Lịch sử giao dịch', icon: 'fas fa-receipt', permission: P.VIEW_TRANSACTIONS, children: [
                    { to: '/admin/history-post/', label: 'Lịch sử gói bài đăng' },
                    { to: '/admin/history-cv/', label: 'Lịch sử gói xem ứng viên' },
                ],
            },
        ],
    },
];

const EMPLOYER_SECTIONS = [
    { key: 'main', items: [DASHBOARD, CHAT] },
    { key: 'recruiting', title: 'Tuyển dụng', items: [RECRUITING_POSTS, RECRUITING_CANDIDATES] },
];

const EMPLOYER_WITHOUT_COMPANY_SECTIONS = [
    {
        key: 'main', items: [{
            key: 'employer-company', title: 'Công ty', icon: 'far fa-building', permission: P.CREATE_COMPANY, children: [
                { to: '/admin/add-company/', label: 'Tạo mới công ty' },
            ],
        }],
    },
];

// Trang khong co trong menu: ten trang va (nhung) trang cha co the co, theo
// thu tu uu tien. Trang cha dau tien ma nguoi dung nhin thay trong menu se duoc
// dung, nen cung mot duong dan (vd: sua tin) dat dung cho cho quan tri vien
// lan nha tuyen dung.
const HIDDEN_ROUTES = [
    { path: '/admin/add-user', label: 'Thêm người dùng', parents: ['/admin/list-user/'] },
    { path: '/admin/edit-user/:id', label: 'Chỉnh sửa người dùng', parents: ['/admin/list-user/', '/admin/list-employer/'] },
    { path: '/admin/add-package-post', label: 'Thêm gói đăng tin', parents: ['/admin/list-package-post/'] },
    { path: '/admin/edit-package-post/:id', label: 'Chỉnh sửa gói đăng tin', parents: ['/admin/list-package-post/'] },
    { path: '/admin/add-package-cv', label: 'Thêm gói xem ứng viên', parents: ['/admin/list-package-cv/'] },
    { path: '/admin/edit-package-cv/:id', label: 'Chỉnh sửa gói xem ứng viên', parents: ['/admin/list-package-cv/'] },
    { path: '/admin/add-job-type', label: 'Thêm ngành nghề', parents: ['/admin/list-job-type/'] },
    { path: '/admin/edit-job-type/:code', label: 'Chỉnh sửa ngành nghề', parents: ['/admin/list-job-type/'] },
    { path: '/admin/add-job-skill', label: 'Thêm kỹ năng', parents: ['/admin/list-job-skill/'] },
    { path: '/admin/edit-job-skill/:code', label: 'Chỉnh sửa kỹ năng', parents: ['/admin/list-job-skill/'] },
    { path: '/admin/add-job-level', label: 'Thêm cấp bậc', parents: ['/admin/list-job-level/'] },
    { path: '/admin/edit-job-level/:id', label: 'Chỉnh sửa cấp bậc', parents: ['/admin/list-job-level/'] },
    { path: '/admin/add-work-type', label: 'Thêm hình thức làm việc', parents: ['/admin/list-work-type/'] },
    { path: '/admin/edit-work-type/:id', label: 'Chỉnh sửa hình thức làm việc', parents: ['/admin/list-work-type/'] },
    { path: '/admin/add-salary-type', label: 'Thêm khoảng lương', parents: ['/admin/list-salary-type/'] },
    { path: '/admin/edit-salary-type/:id', label: 'Chỉnh sửa khoảng lương', parents: ['/admin/list-salary-type/'] },
    { path: '/admin/add-exp-type', label: 'Thêm kinh nghiệm', parents: ['/admin/list-exp-type/'] },
    { path: '/admin/edit-exp-type/:id', label: 'Chỉnh sửa kinh nghiệm', parents: ['/admin/list-exp-type/'] },
    { path: '/admin/edit-company-admin/:id', label: 'Chi tiết công ty', parents: ['/admin/list-company-admin/'] },
    { path: '/admin/edit-post/:id', label: 'Chỉnh sửa tin tuyển dụng', parents: ['/admin/list-post-admin/', '/admin/list-post/'] },
    { path: '/admin/note/:id', label: 'Lịch sử kiểm duyệt', parents: ['/admin/list-post-admin/', '/admin/list-post/'] },
    { path: '/admin/list-cv/:id', label: 'Hồ sơ đã nộp', parents: ['/admin/list-post/', '/admin/list-post-admin/'] },
    { path: '/admin/list-post/:id', label: 'Bài đăng của nhân viên', parents: ['/admin/list-employer/', '/admin/list-post/'] },
    { path: '/admin/user-cv/:id', label: 'Chi tiết hồ sơ', parents: ['/admin/pipeline/', '/admin/list-post-admin/'] },
    { path: '/admin/candiate/:id', label: 'Chi tiết ứng viên', parents: ['/admin/list-candiate/'] },
    { path: '/admin/chat/:partnerId', label: 'Cuộc trò chuyện', parents: ['/admin/chat'] },
    { path: '/admin/payment/success', label: 'Thanh toán thành công', parents: ['/admin/buy-post/'] },
    { path: '/admin/payment/cancel', label: 'Thanh toán đã hủy', parents: ['/admin/buy-post/'] },
    { path: '/admin/paymentCv/success', label: 'Thanh toán thành công', parents: ['/admin/buy-cv/'] },
    { path: '/admin/paymentCv/cancel', label: 'Thanh toán đã hủy', parents: ['/admin/buy-cv/'] },
    { path: '/admin/user-info', label: 'Thông tin tài khoản', section: 'Tài khoản' },
    { path: '/admin/changepassword', label: 'Đổi mật khẩu', section: 'Tài khoản' },
];

export const normalizePath = (path) => String(path || '').replace(/\/+$/, '') || '/';

export const matchRoute = (pattern, pathname) => {
    const expected = normalizePath(pattern).split('/');
    const actual = normalizePath(pathname).split('/');
    return expected.length === actual.length
        && expected.every((part, index) => part.startsWith(':') ? actual[index] !== '' : part === actual[index]);
};

const sectionsFor = (user) => {
    if (!user) return [];
    if (user.roleCode === 'ADMIN') return ADMIN_SECTIONS;
    if (user.roleCode === 'COMPANY') return COMPANY_SECTIONS;
    if (user.roleCode === 'EMPLOYER') return hasCompanyMembership(user) ? EMPLOYER_SECTIONS : EMPLOYER_WITHOUT_COMPANY_SECTIONS;
    return [];
};

/** Menu da loc theo quyen: an muc/nhom/section ma nguoi dung khong duoc dung. */
export const getAdminNavigation = (user) => sectionsFor(user)
    .map(section => ({
        ...section,
        items: section.items
            .filter(item => hasPermission(user, item.permission))
            .map(item => item.children ? {
                ...item,
                children: item.children.filter(child => !child.permission || hasPermission(user, child.permission)),
            } : item)
            .filter(item => !item.children || item.children.length > 0),
    }))
    .filter(section => section.items.length > 0);

// Tim muc menu ung voi mot duong dan: tra ve section, nhom (neu co) va muc.
const findInNavigation = (navigation, pathname) => {
    for (const section of navigation) {
        for (const item of section.items) {
            if (item.children) {
                const child = item.children.find(entry => matchRoute(entry.to, pathname));
                if (child) return { section, group: item, item: child };
            } else if (matchRoute(item.to, pathname)) {
                return { section, item };
            }
        }
    }
    return null;
};

/**
 * Thong tin trang hien tai cho khung quan tri.
 * @returns {{ title: string, navPath: string|null, crumbs: {label: string, to?: string}[], action?: {to: string, label: string}, isDashboard: boolean }|null}
 */
export const resolveAdminPage = (user, pathname) => {
    const navigation = getAdminNavigation(user);
    const crumbsFor = ({ section, group, item }) => [
        ...(section.title ? [{ label: section.title }] : []),
        ...(group ? [{ label: group.title }] : []),
        { label: item.label, to: item.to },
    ];
    const direct = findInNavigation(navigation, pathname);
    if (direct) {
        return {
            title: direct.item.label,
            navPath: normalizePath(direct.item.to),
            crumbs: crumbsFor(direct),
            action: direct.item.action,
            isDashboard: direct.item.key === DASHBOARD.key,
        };
    }
    const hidden = HIDDEN_ROUTES.find(route => matchRoute(route.path, pathname));
    if (!hidden) return null;
    const parent = (hidden.parents || []).map(path => findInNavigation(navigation, path)).find(Boolean);
    return {
        title: hidden.label,
        navPath: parent ? normalizePath(parent.item.to) : null,
        crumbs: [
            ...(parent ? crumbsFor(parent) : hidden.section ? [{ label: hidden.section }] : []),
            { label: hidden.label },
        ],
        isDashboard: false,
    };
};
