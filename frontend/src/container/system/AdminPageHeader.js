import React, { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getDefaultRouteForUser } from '../../auth/accessControl';
import { resolveAdminPage } from './adminNavigation';

const APP_TITLE = 'Quản trị JobFind';

/**
 * Thanh dau trang dung chung: breadcrumb, nut thao tac chinh (vd: "Them nguoi
 * dung" tren trang danh sach) va tieu de tab trinh duyet. Moi thong tin lay tu
 * adminNavigation.js nen cac trang con khong phai tu khai bao.
 */
const AdminPageHeader = ({ user }) => {
    const { pathname } = useLocation();
    const page = useMemo(() => resolveAdminPage(user, pathname), [user, pathname]);
    const title = page?.title;

    useEffect(() => {
        const previous = document.title;
        document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
        return () => { document.title = previous; };
    }, [title]);

    // Trang tong quan tu co phan dau trang rieng.
    if (!page || page.isDashboard) return null;
    const home = getDefaultRouteForUser(user);
    return (
        <div className="jf-page-bar">
            <nav aria-label="Breadcrumb" className="jf-page-bar__trail">
                <ol className="jf-breadcrumb">
                    <li><Link to={home}><i className="fas fa-home" aria-hidden="true" /><span className="sr-only">Trang chủ</span></Link></li>
                    {page.crumbs.map((crumb, index) => {
                        const last = index === page.crumbs.length - 1;
                        return (
                            <li key={`${crumb.label}-${index}`} aria-current={last ? 'page' : undefined}>
                                {crumb.to && !last ? <Link to={crumb.to}>{crumb.label}</Link> : <span>{crumb.label}</span>}
                            </li>
                        );
                    })}
                </ol>
            </nav>
            {page.action && (
                <Link className="jf-btn jf-btn--primary" to={page.action.to}>
                    <i className="fas fa-plus" aria-hidden="true" />
                    {page.action.label}
                </Link>
            )}
        </div>
    );
};

export default AdminPageHeader;
