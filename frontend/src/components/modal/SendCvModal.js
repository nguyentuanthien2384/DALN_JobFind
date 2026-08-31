import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Modal, ModalFooter, ModalBody, Button, Spinner } from 'reactstrap';
import { createNewCv } from '../../service/cvService';
import { getDetailUserById } from '../../service/userService';
import CommonUtils from '../../util/CommonUtils';
import { hasPermission, PERMISSIONS } from '../../auth/accessControl';
import { readJsonStorage } from '../../util/storage';
import './modal.css'

const dataURLtoFile = (dataurl, filename) => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const bytes = new Uint8Array(n);

    while (n--) {
        bytes[n] = bstr.charCodeAt(n);
    }

    return new File([bytes], filename, { type: mime });
};

function SendCvModal(props) {
    const currentUser = readJsonStorage('userData')
    const canApply = hasPermission(currentUser, PERMISSIONS.APPLY_TO_JOB)
    const [isLoading, setIsLoading] = useState(false)
    const [inputValue, setInputValue] = useState({
        userId: '', postId: '', file: '', description: '', linkFile: '', linkFileUser: '', fileUser: ''
    })
    const [typeCv,setTypeCv] = useState('pcCv')
    useEffect(() => {
        const userData = readJsonStorage('userData');
        if (!userData || !hasPermission(userData, PERMISSIONS.APPLY_TO_JOB)) return undefined;

        let isMounted = true;
        const getFileCv = async () => {
            const res = await getDetailUserById(userData.id);
            if (!isMounted) return;
            const savedFile = res?.data?.userAccountData?.userSettingData?.file || '';
            setInputValue((current) => ({
                ...current,
                userId: userData.id,
                postId: props.postId,
                linkFileUser: savedFile ? URL.createObjectURL(dataURLtoFile(savedFile, 'yourCV')) : '',
                fileUser: savedFile,
            }));
        };
        getFileCv();
        return () => {
            isMounted = false;
        };
    }, [props.postId])
    const handleChange = (event) => {
        const { name, value } = event.target
        setInputValue((current) => ({
            ...current,
            [name]: value
        }))
    }

    const radioOnChange = (e) => {
        const {value} = e.target
        if (value==='userCv' && !inputValue.linkFileUser) {
            toast.error('Hiện chưa đăng CV online cho chúng tôi')
        }
        else {
            setTypeCv(value)
        }
    }

    const handleOnChangeFile = async (event) => {
        let data = event.target.files;
        let file = data[0];
        if (file) {
            if (file.size > 2097152)
            {
                toast.error("File của bạn quá lớn. Chỉ gửi file dưới 2MB")
                return
            }
            let base64 = await CommonUtils.getBase64(file);
            setInputValue((current) => ({
                ...current,
                file: base64,
                linkFile: URL.createObjectURL(file)
            }))
        }
    }
    const handleSendCV = async () => {
        if (!canApply) {
            toast.error('Chỉ ứng viên mới có thể nộp CV')
            return
        }
        setIsLoading(true)
        let cvSend = ''
        if (typeCv === 'userCv') {
            cvSend = inputValue.fileUser
        }
        else {
            cvSend = inputValue.file
        }
        let kq = await createNewCv({
            userId: inputValue.userId,
            file: cvSend,
            postId: inputValue.postId,
            description: inputValue.description
        })
        setTimeout(function () {
            setIsLoading(false)
            if (kq.errCode === 0) {
                setInputValue((current) => ({
                    ...current,
                    file: '', description: '', linkFile: ''
                }))
                toast.success("Đã gửi thành công")
                props.onHide()
            }
            else
                toast.error("Gửi thất bại");
        }, 1000);
    }
    if (props.isOpen && !canApply) return null

    return (
        <div>
            <Modal isOpen={props.isOpen} className={'booking-modal-container'}
                size="md" centered
            >
                <p className='text-center'>NỘP CV CỦA BẠN CHO NHÀ TUYỂN DỤNG</p>
                <ModalBody>
                    Nhập lời giới thiệu gửi đến nhà tuyển dụng
                    <div>
                    <textarea placeholder='Giới thiệu sơ lược về bản thân để tăng sự yêu thích đối với nhà tuyển dụng' 
                    name='description' className='mt-2' style={{ width: "100%" }} rows='5' onChange={(event) => handleChange(event)}></textarea>
                    <div className='d-flex' style={{justifyContent:'space-between'}}>
                        <div>
                        <input id="cv-from-device" onChange={radioOnChange} type="radio" checked={typeCv === 'pcCv'} value="pcCv" name="typeCV"></input>
                        <label htmlFor="cv-from-device" className='ml-2'>Tự chọn CV</label>
                        </div>
                        <div>
                        <input id="cv-online" onChange={radioOnChange} type="radio" checked={typeCv === 'userCv'} value="userCv" name="typeCV"></input>
                        <label htmlFor="cv-online" className='ml-2'>CV online</label>
                        </div>
                    </div>
                    {
                        typeCv === 'pcCv' &&
                        <input type="file" aria-label="Chọn tệp CV" className='mt-2' accept='.pdf'
                        onChange={(event) => handleOnChangeFile(event)}></input>

                    }
                    {
                        typeCv === 'pcCv' && inputValue.linkFile && <div><a href={inputValue.linkFile} style={{ color: 'blue' }} target='_blank' rel='noreferrer'>Nhấn vào đây để xem lại CV của bạn </a></div>
                    }
                                        {
                        typeCv === 'userCv' && inputValue.linkFileUser && <div><a href={inputValue.linkFileUser} style={{ color: 'blue' }} target='_blank' rel='noreferrer'>Nhấn vào đây để xem lại CV của bạn </a></div>
                    }
                    </div>
                </ModalBody>
                <ModalFooter style={{ justifyContent: 'space-between' }}>
                    <Button className='me-5' onClick={() => handleSendCV()}>
                        Gửi hồ sơ
                    </Button>

                    <Button onClick={() => {
                        setInputValue((current) => ({
                            ...current,
                            file: '', description: '', linkFile: ''
                        }))
                        props.onHide()
                    }}>
                        Hủy
                    </Button>
                </ModalFooter>

                {isLoading &&
                    <Modal isOpen centered contentClassName='closeBorder' >

                        <div style={{
                            position: 'absolute', right: '50%',
                            justifyContent: 'center', alignItems: 'center'
                        }}>
                            <Spinner animation="border"  ></Spinner>
                        </div>

                    </Modal>
                }
            </Modal>
        </div>
    );
}

export default SendCvModal;
