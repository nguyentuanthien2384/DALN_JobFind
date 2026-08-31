import React from 'react'
import { getDetailCompanyById } from '../../service/userService';
import './DetailCompany.scss';
import { useEffect, useState } from 'react';
import { Link, useParams } from "react-router-dom";
import CommonUtils from '../../util/CommonUtils';
import moment from 'moment';
import CompanyReview from './CompanyReview';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { toggleFollowCompanyService, checkFollowCompanyService } from '../../service/userService';
import { readJsonStorage } from '../../util/storage';
import { hasPermission, PERMISSIONS } from '../../auth/accessControl';
const DetailCompany = () => {
    const [dataCompany, setdataCompany] = useState({})
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState('')
    const [isFollow, setIsFollow] = useState(false)
    const [countFollower, setCountFollower] = useState(0)
    const { id } = useParams();
    const navigate = useNavigate()
    const currentUser = readJsonStorage('userData')
    const canSocialInteract = !currentUser || hasPermission(currentUser, PERMISSIONS.SOCIAL_INTERACT)
    useEffect(() => {
        if (id) {

            let fetchCompany = async () => {
                try {
                    const res = await getDetailCompanyById(id)
                    if (res && res.errCode === 0 && res.data) {
                        setdataCompany(res.data)
                    } else {
                        setLoadError(res?.errMessage || 'Không thể tải thông tin công ty')
                    }
                } catch (error) {
                    setLoadError('Không thể tải thông tin công ty. Vui lòng thử lại')
                } finally {
                    setIsLoading(false)
                }
            }
            fetchCompany()
        } else {
            setLoadError('Đường dẫn công ty không hợp lệ')
            setIsLoading(false)
        }
    }, [id])

    useEffect(() => {
        const userData = readJsonStorage('userData')
        if (!id) return
        let fetchFollowStatus = async () => {
            try {
                const res = await checkFollowCompanyService({
                    companyId: id,
                    userId: userData ? userData.id : ''
                })
                if (res && res.errCode === 0) {
                    setIsFollow(res.isFollow)
                    setCountFollower(res.countFollower || 0)
                }
            } catch (error) {
                // Trang chi tiet van su dung duoc neu tam thoi khong tai duoc trang thai theo doi.
            }
        }
        fetchFollowStatus()
    }, [id])

    const handleToggleFollow = async () => {
        const userData = readJsonStorage('userData')
        if (!userData) {
            toast.info('Vui lòng đăng nhập để theo dõi công ty')
            navigate('/login')
            return
        }
        if (!hasPermission(userData, PERMISSIONS.SOCIAL_INTERACT)) {
            toast.error('Chỉ ứng viên mới có thể theo dõi công ty')
            return
        }
        try {
            const res = await toggleFollowCompanyService({ userId: userData.id, companyId: id })
            if (res && res.errCode === 0) {
                setIsFollow(res.isFollow)
                setCountFollower(current => Math.max(0, current + (res.isFollow ? 1 : -1)))
                toast.success(res.errMessage)
            } else {
                toast.error(res?.errMessage || 'Không thể cập nhật theo dõi công ty')
            }
        } catch (error) {
            toast.error('Không thể cập nhật theo dõi công ty')
        }
    }

    const copyLink = async () => {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(window.location.href)
            toast.success('Đã sao chép đường dẫn')
        } catch (error) {
            toast.error('Không thể sao chép đường dẫn trên trình duyệt này')
        }
    }

    const getSafeWebsite = (website) => {
        try {
            const parsedUrl = new URL(website)
            return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : ''
        } catch (error) {
            return ''
        }
    }

    if (isLoading) {
        return <main className='container-detail-company' role='status'>Đang tải thông tin công ty...</main>
    }

    if (loadError) {
        return <main className='container-detail-company' role='alert'>{loadError}</main>
    }

    const websiteUrl = getSafeWebsite(dataCompany.website)
    const currentUrl = encodeURIComponent(window.location.href)
    const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(dataCompany.address || '')}&output=embed`
    return (
        <div className='container-detail-company'>
            <div className="company-cover">
                <div className="container">
                    <div className="cover-wrapper">
                        <img src={dataCompany.coverimage} alt="" className="img-responsive cover-img" width="100%" height="236px" />
                    </div>
                    <div className="company-detail-overview">
                        <div id="company-logo">
                            <div className="company-image-logo">
                                <img style={{width: '100%', height: '100%'}} src={dataCompany.thumbnail} alt={dataCompany.name || 'Logo công ty'} className="img-responsive" />
                            </div>
                        </div>
                        <div className="company-info">
                            <h1 className="company-detail-name text-highlight">{dataCompany.name}</h1>
                            <div className="d-flex">
                                <p className="website">
                                    <i className="fas fa-globe-americas"></i>
                            {websiteUrl ? (
                                <a href={websiteUrl} target="_blank" rel="noreferrer">{dataCompany.website}</a>
                            ) : (
                                <span>Chưa cập nhật website</span>
                            )}
                                </p>
                                <p className="company-size">
                                    <i className="far fa-building"></i>
                                    {dataCompany.amountEmployer}+ nhân viên
                                </p>
                            </div>
                        </div>
                        <div className="box-follow">
                            {canSocialInteract && <button type="button" className="btn btn-follow btn-primary-hover" style={{ marginRight: '8px', background: isFollow ? '#fff' : '#fb246a', color: isFollow ? '#fb246a' : '#fff', border: '1px solid #fb246a', cursor: 'pointer' }} onClick={() => handleToggleFollow()}>
                                <i className={isFollow ? "fas fa-bell" : "far fa-bell"} style={{ marginRight: '5px' }}></i>
                                {isFollow ? 'Đang theo dõi' : 'Theo dõi'} ({countFollower})
                            </button>}
                            
                                
                                <span style={{background: dataCompany.censorData && (dataCompany.censorData.code === 'CS2' ? 'yellow' : dataCompany.censorData.code!=='CS1' ? 'red' : '' ), color: 'black'}} className="btn btn-follow btn-primary-hover">{dataCompany.censorData && dataCompany.censorData.value}</span>
                            
                        </div>
                    </div>
                </div>
            </div>
            <div className="detail">
                <div className="container">
                    <div className="row">
                        <div className="col-md-8">
                            <div className="company-info box-white">
                                <h4 className="title">Giới thiệu công ty</h4>
                                <div className="box-body">
                                    <div dangerouslySetInnerHTML={{ __html: dataCompany.descriptionHTML }}></div>
                                </div>
                            </div>
                            <div className="job-listing box-white">
                                <h4 className="title">Tuyển dụng</h4>
                                <div className="box-body">
                                    {dataCompany && dataCompany.postData && dataCompany.postData.length > 0 &&
                                        dataCompany.postData.map((item, index) => {
                                            return (
                                                <Link key={item.id || index} to={`/detail-job/${item.id}`} className="company-logo">
                                                <div className="job-item  job-ta result-job-hover">
                                                    <div className="avatar">
                                                            <img src={dataCompany.thumbnail} className="w-100" alt={dataCompany.name || 'Logo công ty'} title={item.postDetailData.name} />
                                                    </div>
                                                    <div className="body">
                                                        <div className="content">
                                                            <div className="ml-auto">
                                                                <h4 className="title-job">
                                                                    <span className="underline-box-job">
                                                                        <span className="bold transform-job-title" data-toggle="tooltip" title={item.postDetailData.name} data-placement="top" data-container="body">{item.postDetailData.name}</span>
                                                                        <i className="fa-solid fa-circle-check" data-toggle="tooltip" title="Tin từ nhà tuyển dụng đã xác thực" data-placement="top" data-container="body" data-original-title="Tin từ nhà tuyển dụng đã xác thực" />
                                                                    </span>
                                                                </h4>
                                                            </div>
                                                            <div style={{minWidth:'100px'}} className="mr-auto text-right">
                                                                <p className="deadline">

                                                                    {CommonUtils.formatDate(item.timeEnd) <= 0 ?
                                                                        <span>Hết hạn ứng tuyển</span> : <span>Còn <strong>{CommonUtils.formatDate(item.timeEnd)}</strong> ngày</span>
                                                                    }
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div style={{margin:"10px 0"}} className="d-flex">
                                                            <div className="label-content ml-auto">
                                                                <label className="salary">{item.postDetailData.salaryTypePostData.value}</label>
                                                                <label style={{margin:"0px 10px"}} className="address" data-toggle="tooltip" title={item.postDetailData.provincePostData.value} data-placement="top" data-container="body">{item.postDetailData.provincePostData.value}</label>
                                                                <label className="time">{moment(item.createdAt).fromNow()}</label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                </Link>
                                            )
                                        })
                                    }
                                    {
                                        dataCompany && dataCompany.postData && dataCompany.postData.length === 0 && 
                                        <div style={{textAlign:'center'}}>Không có bài đăng nào</div>
                                    }

                                    <div className="text-center">
                                    </div>
                                </div>
                            </div>
                            <CompanyReview companyId={id} />
                        </div>
                        <div className="col-md-4">
                            <div className="box-address box-white">
                                <h4 className="title">Địa chỉ công ty</h4>
                                <div className="box-body">
                                    <p className="text-dark-gray">
                                        <i className="fas fa-map-marker-alt" />{dataCompany.address}
                                    </p>
                                    <div className="company-map">
                                        <p className="map">Bản đồ trụ sở chính :</p>
                                        <iframe title="Bản đồ địa chỉ công ty" width="100%" height={270} frameBorder={0} style={{ border: 0 }} src={mapUrl} allowFullScreen>
                                        </iframe>
                                    </div>
                                </div>
                            </div>
                            <div className="box-sharing box-white">
                                <h4 className="title">Chia sẻ công ty tới bạn bè</h4>
                                <div className="box-body">
                                    <p>Sao chép đường dẫn</p>
                                    <div className="box-copy">
                                        <input id='mylink' type="text" defaultValue={window.location.href} className="url-copy" readOnly />
                                        <div className="btn-copy">
                                            <button aria-label="Sao chép đường dẫn" onClick={copyLink} className="btn-copy-url"><i className="fa-regular fa-copy" /></button>
                                        </div>
                                    </div>
                                    <p>Chia sẻ qua mạng xã hội</p>
                                    <div className="box-share">
                                        <a href={`https://www.facebook.com/sharer/sharer.php?u=${currentUrl}`} target="_blank" rel="noreferrer" aria-label="Chia sẻ qua Facebook"><i className="fab fa-facebook-f" /></a>
                                        <a href={`https://twitter.com/intent/tweet?url=${currentUrl}`} target="_blank" rel="noreferrer" aria-label="Chia sẻ qua Twitter"><i className="fab fa-twitter" /></a>
                                        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${currentUrl}`} target="_blank" rel="noreferrer" aria-label="Chia sẻ qua LinkedIn"><i className="fab fa-linkedin-in" /></a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )


}

export default DetailCompany
