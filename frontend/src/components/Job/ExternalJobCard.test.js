import React from 'react';
import { render, screen } from '@testing-library/react';
import ExternalJobCard from './ExternalJobCard';

test('shows source-check date separately from posting time and keeps missing facts explicit', () => {
    render(<ExternalJobCard data={{ title: 'Nhân viên tuyển dụng', employer: 'Doanh nghiệp',
        provinceCodes: ['Hà Nội'], sourceName: 'Nguồn tuyển dụng', checkedAt: '2026-09-29', postedAt: null }} />);
    expect(screen.getByRole('heading', { name: 'Nhân viên tuyển dụng' })).toBeInTheDocument();
    expect(screen.getByText('Nguồn: Nguồn tuyển dụng · Kiểm tra 29/09/2026')).toBeInTheDocument();
    expect(screen.getByText('Lương: nguồn chưa công bố')).toBeInTheDocument();
    expect(screen.getByText('Hạn nộp: nguồn chưa công bố')).toBeInTheDocument();
    expect(screen.queryByText(/hôm nay|ngày trước/)).not.toBeInTheDocument();
});

test('shows the employer logo copied from the source, with initials when the source has none', () => {
    const { rerender, container } = render(<ExternalJobCard data={{ title: 'Nhân viên cửa hàng', employer: 'Jollibee Vietnam',
        provinceCodes: ['Đà Nẵng'], sourceName: 'Jollibee', checkedAt: '2026-09-30', logo: '/external-jobs/logos/jollibee.png',
        workTypeText: 'Bán thời gian', quantity: '13 người' }} />);
    expect(screen.getByRole('img', { name: 'Logo Jollibee Vietnam' })).toHaveAttribute('src', '/external-jobs/logos/jollibee.png');
    expect(screen.getByText('Bán thời gian')).toBeInTheDocument();
    expect(screen.getByText('Số lượng: 13 người')).toBeInTheDocument();
    rerender(<ExternalJobCard data={{ title: 'Kế toán', employer: 'Tổng Công ty Xây dựng Trường Sơn',
        provinceCodes: ['Cà Mau'], sourceName: 'Trung tâm', checkedAt: '2026-09-30', logo: null }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('TS')).toBeInTheDocument();
});

test('keeps a multi-province vacancy compact without implying nationwide coverage', () => {
    render(<ExternalJobCard data={{ title: 'Kỹ thuật viên', employer: 'Doanh nghiệp',
        provinceCodes: ['Hà Nội', 'Hải Phòng', 'Hưng Yên', 'Ninh Bình'],
        salaryText: '10–15 triệu đồng', deadline: '2026-10-15', sourceName: 'Nguồn', checkedAt: '2026-09-29' }} />);
    expect(screen.getByText('Hà Nội, Hải Phòng, Hưng Yên và 1 tỉnh/thành khác')).toBeInTheDocument();
    expect(screen.getByText('10–15 triệu đồng')).toBeInTheDocument();
    expect(screen.getByText('Hạn nộp: 15/10/2026')).toBeInTheDocument();
});
