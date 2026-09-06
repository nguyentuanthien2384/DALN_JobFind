import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalFooter, ModalBody, Button, Spinner } from 'reactstrap';
import DatePicker from 'react-datepicker';
import './modal.css';

function ReupPostModal({ isOpen, handleFunc, onHide, blocked = false, feedback = '', initialTimeEnd }) {
    const [timeEnd, setTimeEnd] = useState(() => new Date(Date.now() + 86400000));
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const [uncertain, setUncertain] = useState(false);
    useEffect(() => {
        if (Number.isSafeInteger(initialTimeEnd) && initialTimeEnd > 0 && initialTimeEnd <= 8640000000000000) {
            setTimeEnd(new Date(initialTimeEnd));
        }
    }, [initialTimeEnd]);
    const handlePost = async () => {
        if (inFlight.current || blocked || uncertain) return;
        const deadline = timeEnd instanceof Date ? timeEnd.getTime() : NaN;
        if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) {
            setError('Ngày kết thúc phải sau thời điểm hiện tại'); return;
        }
        inFlight.current = true; setIsLoading(true); setError('');
        try {
            const success = await handleFunc(deadline);
            if (success === true) onHide();
            else if (success === false) setError('Chưa đăng lại thành công. Ngày đã chọn được giữ; hãy kiểm tra thông báo trước khi thử lại.');
            else {
                setUncertain(true);
                setError('Chưa xác định được kết quả. Hãy giữ ngày đã chọn và kiểm tra danh sách tin trước khi đăng lại.');
            }
        } catch {
            setUncertain(true);
            setError('Chưa xác định được kết quả. Hãy giữ ngày đã chọn và kiểm tra danh sách tin trước khi đăng lại.');
        } finally { inFlight.current = false; setIsLoading(false); }
    };
    return <Modal isOpen={isOpen} className="booking-modal-container" size="md" centered>
        <p className="text-center">Hãy chọn thời gian kết thúc tuyển dụng</p>
        <ModalBody>
            <p>Đăng lại dùng nội dung tin gốc đã lưu, không dùng phần đang sửa trên biểu mẫu.</p>
            <DatePicker selected={timeEnd} disabled={isLoading || blocked || uncertain}
                className="form-control" onChange={date => { setTimeEnd(date); setError(''); }} />
            {(feedback || error) && <p role="alert">{feedback || error}</p>}
            {isLoading && <span role="status"><Spinner size="sm" /> Đang đăng lại...</span>}
        </ModalBody>
        <ModalFooter style={{ justifyContent: 'space-between' }}>
            <Button className="me-5" disabled={isLoading || blocked || uncertain} onClick={handlePost}>Hoàn thành</Button>
            <Button disabled={isLoading} onClick={onHide}>Hủy</Button>
        </ModalFooter>
    </Modal>;
}
export default ReupPostModal;
