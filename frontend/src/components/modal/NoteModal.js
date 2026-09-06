import React, { useState, useRef } from 'react';
import { Modal, ModalFooter, ModalBody, Button, Spinner } from 'reactstrap';
import './modal.css'
function NoteModal(props) {
    const [isLoading, setIsLoading] = useState(false)
    const busy = useRef(false)
    const [inputValue, setInputValue] = useState({
        note: '',
    })
    const handleChange = (event) => {
        const { name, value } = event.target
        setInputValue({
            ...inputValue,
            [name]: value
        })
    }
    const handlePost = async () => {
        if (busy.current) return;
        busy.current = true;
        setIsLoading(true)
        try {
            const result = props.handleFunc(props.id,inputValue.note)
            if (!props.awaitResult || await result === true) props.onHide()
        } catch { /* Parent supplies feedback; retain the note for review. */ }
        finally { busy.current = false; setIsLoading(false) }
    }
    return (
        <div>
            <Modal isOpen={props.isOpen} className={'booking-modal-container'}
                size="md" centered
            >
                <p className='text-center'>Hãy gửi lời nhắn để nhà tuyển dụng</p>
                <ModalBody>
                    {props.feedback && <p role="alert">{props.feedback} Sao chép ghi chú cần giữ, đóng hộp thoại rồi chọn Tải lại danh sách.</p>}
                    Nhập lời giới thiệu gửi đến nhà tuyển dụng
                    <div>
                    <textarea placeholder='Giải thích lý do cho nhà tuyển dụng' 
                    name='note' value={inputValue.note} disabled={props.awaitResult && isLoading}
                    maxLength={props.awaitResult ? 255 : undefined} className='mt-2' style={{ width: "100%" }} rows='5' onChange={(event) => handleChange(event)}></textarea>
                    </div>
                </ModalBody>
                <ModalFooter style={{ justifyContent: 'space-between' }}>
                    <Button className='me-5' disabled={props.awaitResult && (isLoading || !!props.feedback)} onClick={() => handlePost()}>
                        Hoàn thành
                    </Button>

                    <Button disabled={props.awaitResult && isLoading} onClick={() => {
                        props.onHide()
                    }}>
                        Hủy
                    </Button>
                </ModalFooter>

                {isLoading &&
                    <Modal isOpen='true' centered contentClassName='closeBorder' >

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

export default NoteModal;
