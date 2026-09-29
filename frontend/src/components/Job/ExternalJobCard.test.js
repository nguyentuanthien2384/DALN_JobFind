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

test('keeps a multi-province vacancy compact without implying nationwide coverage', () => {
    render(<ExternalJobCard data={{ title: 'Kỹ thuật viên', employer: 'Doanh nghiệp',
        provinceCodes: ['Hà Nội', 'Hải Phòng', 'Hưng Yên', 'Ninh Bình'],
        salaryText: '10–15 triệu đồng', deadline: '2026-10-15', sourceName: 'Nguồn', checkedAt: '2026-09-29' }} />);
    expect(screen.getByText('Hà Nội, Hải Phòng, Hưng Yên và 1 tỉnh/thành khác')).toBeInTheDocument();
    expect(screen.getByText('10–15 triệu đồng')).toBeInTheDocument();
    expect(screen.getByText('Hạn nộp: 15/10/2026')).toBeInTheDocument();
});
