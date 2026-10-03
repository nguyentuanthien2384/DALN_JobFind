import React from 'react';
import ReactPaginate from 'react-paginate';

// Khoi dung chung cho moi trang danh sach quan tri: tieu de co tong so ban
// ghi, thanh loc, chan trang (khoang dang xem, so dong moi trang, phan trang).
//
// 50 la tran cua API Job Core (ManagedJobsQuery) nen khong cho chon lon hon.
export const PAGE_SIZES = [10, 20, 50];
export const DEFAULT_PAGE_SIZE = 20;

export const normalizePageSize = (value) => (PAGE_SIZES.includes(Number(value)) ? Number(value) : DEFAULT_PAGE_SIZE);

/** Doi so dong moi trang ma van giu dong dau tien dang xem trong tam mat. */
export const pageForSize = (page, oldSize, newSize) => Math.floor((page * oldSize) / newSize);

const numberFormat = new Intl.NumberFormat('vi-VN');

export const ListTitle = ({ title, total, description }) => (
    <div className="jf-list-head">
        <h4 className="card-title jf-list-title">
            {title}
            {total !== null && total !== undefined && <span className="jf-count" title="Tổng số bản ghi khớp bộ lọc">{numberFormat.format(total)}</span>}
        </h4>
        {description && <p className="jf-list-head__description">{description}</p>}
    </div>
);

/** O chon loc (the select goc de ban phim va trinh doc man hinh dung duoc ngay). */
export const FilterSelect = ({ label, value, options, onChange, disabled, name }) => (
    <label className="jf-filter">
        <span className="jf-filter__label">{label}</span>
        <select className="jf-filter__control" name={name} value={value} disabled={disabled}
            onChange={(event) => onChange(event.target.value)}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    </label>
);

export const ListToolbar = ({ children, canReset, onReset, disabled }) => (
    <div className="jf-list-toolbar">
        {children}
        {canReset && (
            <button type="button" className="jf-btn jf-btn--ghost jf-list-toolbar__reset" onClick={onReset} disabled={disabled}>
                <i className="fas fa-times" aria-hidden="true" /> Xóa bộ lọc
            </button>
        )}
    </div>
);

export const ListFooter = ({ page, pageSize, total, onPageChange, onPageSizeChange, disabled }) => {
    const pageCount = Math.max(1, Math.ceil((Number(total) || 0) / pageSize));
    const from = total ? page * pageSize + 1 : 0;
    const to = Math.min(Number(total) || 0, (page + 1) * pageSize);
    return (
        <div className="jf-list-footer">
            <span className="jf-list-footer__range">
                {total ? <>Hiển thị <strong>{numberFormat.format(from)}–{numberFormat.format(to)}</strong> trên <strong>{numberFormat.format(total)}</strong></> : 'Không có bản ghi'}
            </span>
            <label className="jf-list-footer__size">
                Số dòng
                <select value={pageSize} disabled={disabled} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                    {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                </select>
            </label>
            {pageCount > 1 && (
                <ReactPaginate
                    forcePage={Math.min(page, pageCount - 1)}
                    disableInitialCallback
                    previousLabel="‹"
                    nextLabel="›"
                    breakLabel="…"
                    pageCount={pageCount}
                    marginPagesDisplayed={1}
                    pageRangeDisplayed={3}
                    containerClassName="pagination jf-pagination jf-list-footer__pages"
                    pageClassName="page-item"
                    pageLinkClassName="page-link"
                    previousLinkClassName="page-link"
                    previousClassName="page-item"
                    nextClassName="page-item"
                    nextLinkClassName="page-link"
                    breakLinkClassName="page-link"
                    breakClassName="page-item"
                    activeClassName="active"
                    onPageChange={({ selected }) => { if (!disabled) onPageChange(selected); }}
                />
            )}
        </div>
    );
};
