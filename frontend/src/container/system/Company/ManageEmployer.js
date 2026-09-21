import useListLoading from '../useListLoading';
import StableList from '../../../components/common/StableList';
import React from 'react'
import { useEffect, useState } from 'react';
import { getAllUserByCompanyIdService, QuitCompanyService } from '../../../service/userService';
import moment from 'moment';
import { PAGINATION } from '../../../util/constant';
import ReactPaginate from 'react-paginate';

import { toast } from 'react-toastify';
import useListQuery, { clampListPage } from '../../../util/useListQuery';
const ManageEmployer = () => {
    const [user] = useState(() => JSON.parse(localStorage.getItem('userData')) || {})
    const [dataUser, setdataUser] = useState([]);
    const [count, setCount] = useState(0)
    const [{ page: numberPage }, setQuery] = useListQuery({ page: 0 })
    const [refresh, setRefresh] = useState(0)
    const [loading, setLoading] = useListLoading(JSON.stringify([user.companyId, numberPage, refresh]));
    useEffect(() => {
        let active = true;
        setLoading(true);
        if (user.companyId) {
            getAllUserByCompanyIdService({ limit: PAGINATION.pagerow,
                offset: numberPage * PAGINATION.pagerow, companyId: user.companyId }).then(res => {
                if (!active) return;
                if (res?.errCode !== 0) throw new Error();
                setCount(Math.ceil(res.count / PAGINATION.pagerow));
                const page = clampListPage(numberPage, res.count, PAGINATION.pagerow);
                if (page !== numberPage) { setQuery({ page }, { replace: true }); return; }
                setdataUser(res.data);
            }).catch(() => { if (active) { setdataUser([]); setCount(0); toast.error('Không tải được danh sách nhân viên'); } })
                .finally(() => { if (active) setLoading(false); });
        }
        else { setdataUser([]); setCount(0); setLoading(false); }
        return () => { active = false; };
    }, [user.companyId, numberPage, refresh, setQuery, setLoading]);
    const handleChangePage = number => setQuery({ page: number.selected });
    let handleQuitCompany = async (userId) => {
        let res = await QuitCompanyService({
            userId: userId
        })
        if (res && res.errCode === 0) {
            toast.success("Thôi việc thành công !")
            setRefresh(value => value + 1);
        } else {
            toast.error(res.errMessage)
        }
    }
    return (
        <div>
            <div className="col-12 grid-margin">
                <div className="card">
                    <div className="card-body">
                        <h4 className="card-title">Danh sách nhân viên</h4>

                        <StableList busy={loading} resetKey={user.companyId}><div className="table-responsive pt-2">
                            <table className="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>
                                            STT
                                        </th>
                                        <th>
                                            Họ và Tên
                                        </th>
                                        <th>
                                            Số điện thoại
                                        </th>
                                        <th>
                                            Giới tính
                                        </th>
                                        <th>
                                            Ngày sinh
                                        </th>
                                        <th>
                                            Quyền
                                        </th>
                                        <th>
                                            Trạng thái
                                        </th>
                                        <th>
                                            Thao tác
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataUser && dataUser.length > 0 &&
                                        dataUser.map((item, index) => {
                                            let date = moment.unix(item.dob / 1000).format('DD/MM/YYYY')
                                            return (
                                                <tr key={index}>
                                                    <td>{index + 1 + numberPage * PAGINATION.pagerow}</td>
                                                    <td>{`${item.firstName} ${item.lastName}`}</td>
                                                    <td>{item.userAccountData.phonenumber}</td>
                                                    <td>{item.genderData.value}</td>
                                                    <td>{date}</td>
                                                    <td>{item.userAccountData.roleData.value}</td>
                                                    <td><label className={item.userAccountData.statusCode === 'S1' ? 'badge badge-success' : 'badge badge-danger'}>{item.userAccountData.statusAccountData.value}</label></td>
                                                    <td>
                                                                    {String(user.id) !== String(item.id) &&  <button type="button" className="btn btn-link p-0" onClick={() => handleQuitCompany(item.id)} style={{ color: '#4B49AC' }} >Thôi việc</button>}
                                                        &nbsp; &nbsp;
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    }

                                </tbody>
                            </table>
                        </div></StableList>
                    </div>
                    {count > 0 && <ReactPaginate
                        forcePage={Math.min(numberPage, count - 1)}
                        previousLabel={'Quay lại'}
                        nextLabel={'Tiếp'}
                        breakLabel={'...'}
                        pageCount={count}
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

            </div>
        </div>
    )
}

export default ManageEmployer
