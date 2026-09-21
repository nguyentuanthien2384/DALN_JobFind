import React from 'react'
import { getListCompany } from '../../service/userService';
import './ListCompany.scss';
import { useEffect, useState } from 'react';
import {Input} from 'antd'
import ReactPaginate from 'react-paginate';
import { Link } from 'react-router-dom';
import CommonUtils from '../../util/CommonUtils';
import useListQuery, { clampListPage } from '../../util/useListQuery';
const ListCompany = () => {
    const [dataCompany, setdataCompany] = useState([])
    const [count, setCount] = useState(0)
    const [countData,setCountData] = useState(0)
    const [{ page: numberPage, search }, setQuery] = useListQuery({ page: 0, search: '' });
    const [error, setError] = useState('');
    const handleSearch = value => setQuery({ search: value, page: 0 });
    useEffect(() => {
        let active = true;
        setError(''); setdataCompany([]);
        (async () => {
            try {
                const result = await getListCompany({ limit: 6, offset: numberPage * 6, search: CommonUtils.removeSpace(search) });
                if (!active) return;
                if (result?.errCode !== 0) throw Error();
                const validPage = clampListPage(numberPage, result.count, 6);
                if (validPage !== numberPage) { setQuery({ page: validPage }, { replace: true }); return; }
                setdataCompany(result.data); setCount(Math.ceil(result.count / 6)); setCountData(result.count);
            } catch { if (active) setError('Không tải được danh sách công ty. Vui lòng tải lại.'); }
        })();
        return () => { active = false; };
    }, [numberPage, search, setQuery]);
    const handleChangePage = number => setQuery({ page: number.selected });
    return (
        <div className='container-company'>
            <h3 className='title'>DANH SÁCH CÁC CÔNG TY</h3>
            <div className='row list-company'>

            <span>{countData} công ty được tìm thấy</span>
                                    <Input.Search key={search} defaultValue={search} onSearch={handleSearch} className='mt-5 mb-5' placeholder="Nhập tên công ty" allowClear enterButton="Tìm kiếm">
                                    
                                    </Input.Search>
                {error && <p role="alert">{error}</p>}
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
                                        <div className="company-description">
                                            <p dangerouslySetInnerHTML={{ __html: item.descriptionHTML }}></p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })
                }


            </div>
            <ReactPaginate
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
            />
        </div>

    )
}

export default ListCompany
