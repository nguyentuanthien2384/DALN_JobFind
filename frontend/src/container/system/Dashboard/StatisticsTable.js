import React from 'react';
import ReactPaginate from 'react-paginate';
import StableList from '../../../components/common/StableList';

/**
 * Bang thong ke co phan trang dung chung cho dashboard (doanh thu theo goi,
 * so CV theo tin). `table` la ket qua cua useStatisticsTable.
 */
const StatisticsTable = ({
    title, subtitle, toolbar, actions, table, page, resetKey, onPageChange, columns, alignRight = [], rows, total,
    emptyText = 'Chưa có dữ liệu trong khoảng thời gian này',
}) => (
    <section className="jf-panel jf-stat-table">
        <header className="jf-panel__head">
            <div>
                <h2 className="jf-panel__title">{title}</h2>
                {subtitle && <p className="jf-panel__subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="jf-panel__actions">{actions}</div>}
        </header>
        <div className="jf-panel__body">
            {toolbar && <div className="jf-stat-table__toolbar">{toolbar}</div>}
            {table.error && <p className="jf-inline-error" role="alert">{table.error}</p>}
            <StableList busy={table.loading} resetKey={resetKey}>
                <div className="table-responsive">
                    <table className="jf-table">
                        <thead>
                            <tr>
                                {columns.map((column, index) => (
                                    <th key={column} className={alignRight.includes(index) ? 'is-numeric' : undefined} scope="col">{column}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.key}>
                                    {row.cells.map((cell, index) => (
                                        <td key={index} className={alignRight.includes(index) ? 'is-numeric' : undefined}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {rows.length === 0 && <div className="jf-table__empty">{emptyText}</div>}
                </div>
            </StableList>
            {total && <div className="jf-stat-table__total">{total}</div>}
        </div>
        {Math.max(table.count, page + 1) > 1 && <ReactPaginate
            disableInitialCallback
            previousLabel="‹"
            nextLabel="›"
            breakLabel="…"
            pageCount={Math.max(1, table.count, page + 1)}
            marginPagesDisplayed={1}
            pageRangeDisplayed={3}
            containerClassName="pagination jf-pagination"
            pageClassName="page-item"
            pageLinkClassName="page-link"
            previousLinkClassName="page-link"
            previousClassName="page-item"
            nextClassName="page-item"
            nextLinkClassName="page-link"
            breakLinkClassName="page-link"
            breakClassName="page-item"
            activeClassName="active"
            forcePage={page}
            onPageChange={({ selected }) => onPageChange(selected)}
        />}
    </section>
);

export default StatisticsTable;
