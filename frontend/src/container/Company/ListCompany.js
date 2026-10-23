import React from 'react'
import { getListCompany } from '../../service/userService';
import './ListCompany.scss';
import { useEffect, useState } from 'react';
import {Input} from 'antd'
import ReactPaginate from 'react-paginate';
import { Link } from 'react-router-dom';
import CommonUtils from '../../util/CommonUtils';
import useListQuery, { clampListPage } from '../../util/useListQuery';
import StableList from '../../components/common/StableList';
import createListCache from '../../util/listCache';

const PAGE_SIZE = 6;
// Coming Back from a company (or opening the page again) paints the remembered list at
// once, so the page keeps its height and scroll position, then refreshes it quietly.
const companyCache = createListCache();
const REUSE_FOR = 15 * 1000;
const loadCompanies = (page, search) => companyCache.load(JSON.stringify([page, search]), async () => {
    const result = await getListCompany({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, search: CommonUtils.removeSpace(search) });
    if (result?.errCode !== 0) throw Error();
    return { rows: result.data, count: result.count };
}, { reuseFor: REUSE_FOR });

// Card-sized blocks for the first load: the list keeps its height instead of collapsing,
// which also stopped the scrollbar (and the whole page) from jumping sideways.
const CompanyPlaceholders = () => Array.from({ length: PAGE_SIZE }, (_, index) =>
    <div key={index} className='col-md-4 col-sm-6 stable-list__placeholder' aria-hidden='true'>
        <div className='box-item-company is-placeholder'>
            <div className='company-banner'><div className='cover-wrapper' /><div className='company-logo' /></div>
            <div className='company-info'><span /><span /><span /><span /></div>
        </div>
    </div>);

const ListCompany = () => {
    const [{ page: numberPage, search }, setQuery] = useListQuery({ page: 0, search: '' });
    const [result, setResult] = useState(null);
    const listKey = JSON.stringify([numberPage, search]);
    const fresh = result?.listKey === listKey;
    const cached = fresh ? null : companyCache.read(listKey)?.value;
    const view = fresh ? result : cached || result || { rows: [], count: 0, error: '' };
    const { rows: dataCompany, count: countData, error = '' } = view;
    const count = Math.ceil(countData / PAGE_SIZE);
    const busy = !fresh && !cached;
    const handleSearch = value => setQuery({ search: value, page: 0 });
    useEffect(() => {
        let active = true;
        loadCompanies(numberPage, search).then(response => {
            if (!active) return;
            const validPage = clampListPage(numberPage, response.count, PAGE_SIZE);
            if (validPage !== numberPage) { companyCache.forget(listKey); setQuery({ page: validPage }, { replace: true }); return; }
            setResult({ listKey, rows: response.rows, count: response.count, error: '' });
        }, () => {
            if (!active) return;
            const stale = companyCache.read(listKey)?.value;
            setResult(stale ? { listKey, ...stale, error: '' }
                : { listKey, rows: [], count: 0, error: 'Không tải được danh sách công ty. Vui lòng tải lại.' });
        });
        return () => { active = false; };
    }, [numberPage, search, listKey, setQuery]);
    const handleChangePage = number => setQuery({ page: number.selected });
    return (
        <div className='container-company'>
            <h3 className='title'>DANH SÁCH CÁC CÔNG TY</h3>
            <div className='list-company'>

            <span>{busy ? 'Đang tìm công ty…' : error ? 'Chưa tải được danh sách công ty' : `${countData} công ty được tìm thấy`}</span>
                                    <Input.Search key={search} defaultValue={search} onSearch={handleSearch} className='company-search' placeholder="Nhập tên công ty" allowClear enterButton="Tìm kiếm">
                                    
                                    </Input.Search>
            </div>
            <StableList busy={busy} resetKey={search} label="Đang tải danh sách công ty…">
            <div className='row list-company'>
                {error && <p role="alert">{error}</p>}
                {busy && !dataCompany.length && !error && <CompanyPlaceholders />}
                {dataCompany && dataCompany.length > 0 &&
                    dataCompany.map((item, index) => {
                        return (
                            <div key={index} className='col-md-4 col-sm-6 '>
                                <div className='box-item-company'>
                                    <div className='company-banner'>
                                        <Link to={`/detail-company/${item.id}`}>
                                            <div className='cover-wrapper'>
                                                <img src={item.coverimage} alt={item.name || "Ảnh bìa công ty"}></img>
                                            </div>
                                        </Link>
                                        <div className='company-logo'>
                                            <Link to={`/detail-company/${item.id}`}>
                                                <img className="img-fluid" src={item.thumbnail} alt="Công ty Cổ phần Tập đoàn Hoa Sen" />
                                            </Link>
                                        </div>
                                    </div>
                                    <div className="company-info">
                                        <h3>
                                            <Link to={`/detail-company/${item.id}`} className="company-name" >{item.name}</Link>
                                        </h3>
                                        <div className="company-description" dangerouslySetInnerHTML={{ __html: item.descriptionHTML }} />
                                    </div>
                                </div>
                            </div>
                        )
                    })
                }


            </div>
            </StableList>
            {(count > 0 || numberPage > 0) && <ReactPaginate
                forcePage={numberPage}
                previousLabel={'Quay lại'}
                nextLabel={'Tiếp'}
                breakLabel={'...'}
                pageCount={Math.max(numberPage + 1, count)}
                marginPagesDisplayed={3}
                containerClassName={"pagination justify-content-center pb-3"}
                pageClassName={"page-item"}
                pageLinkClassName={"page-link"}
                previousLinkClassName={"page-link"}
                previousClassName={"page-item"}
                nextClassName={"page-item"}
                nextLinkClassName={"page-link"}
                breakLinkClassName={"page-link"}
                breakClassName={"page-item"}
                activeClassName={"active"}
                onPageChange={handleChangePage}
            />}
        </div>

    )
}

export default ListCompany
