import React from 'react';
import { render, screen } from '@testing-library/react';
import ExternalJobDetail from './ExternalJobDetail';
import { getExternalJob, isExternalJobExpired } from '../../service/externalJobs';

jest.mock('../../service/externalJobs', () => ({ getExternalJob: jest.fn(), isExternalJobExpired: jest.fn() }));
jest.mock('react-router-dom', () => {
    const React = require('react');
    return { useParams: () => ({ id: 'external-source-123' }),
        Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) };
});

const job = {
    id: 'external-source-123', title: 'Kỹ thuật viên mạng', employer: 'Doanh nghiệp từ nguồn',
    provinceCodes: ['Lào Cai'], sourceLocation: 'Yên Bái', sourceName: 'Trang tuyển dụng doanh nghiệp',
    sourceUrl: 'https://careers.example.test/jobs/123', checkedAt: '2026-09-29', postedAt: null,
    deadline: '2026-10-30', salaryText: 'Theo thông tin tại nguồn', summary: 'Hỗ trợ triển khai mạng tại địa bàn.',
    responsibilities: ['Kiểm tra kết nối.'], requirements: ['Có chuyên môn kỹ thuật.'],
};

beforeEach(() => { jest.clearAllMocks(); getExternalJob.mockReturnValue(job); isExternalJobExpired.mockReturnValue(false); });

test('shows provenance and sends applications only to the HTTPS original source without local CV or account actions', () => {
    const { container } = render(<ExternalJobDetail />);
    expect(getExternalJob).toHaveBeenCalledWith(job.id);
    expect(screen.getByRole('heading', { name: job.title })).toBeInTheDocument();
    expect(screen.getByText('Tin từ nguồn bên ngoài')).toBeInTheDocument();
    expect(screen.getByText(/kiểm tra ngày 29\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Yên Bái')).toBeInTheDocument();
    expect(screen.getByText('Tỉnh/thành phố theo danh mục hiện tại: Lào Cai.')).toBeInTheDocument();
    const apply = screen.getByRole('link', { name: /Xem tin và ứng tuyển tại nguồn/ });
    expect(apply).toHaveAttribute('href', job.sourceUrl);
    expect(apply).toHaveAttribute('target', '_blank');
    expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /Xem bài tuyển dụng gốc/ })).toHaveAttribute('href', job.sourceUrl);
    expect(screen.queryByText('Ngày đăng tại nguồn')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('form, input[type="file"], a[href^="/chat"], a[href^="/login"], a[href^="/candidate"]')).toBeNull();
});

test('keeps unknown salary and deadline explicit and does not fabricate requirements', () => {
    getExternalJob.mockReturnValue({ ...job, deadline: null, salaryText: null, requirements: [], responsibilities: [] });
    render(<ExternalJobDetail />);
    expect(screen.getAllByText('Nguồn chưa công bố')).toHaveLength(2);
    expect(screen.getByText(/Nguồn chưa nêu hạn nộp/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Yêu cầu ứng viên' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Công việc chính' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Xem tin và ứng tuyển tại nguồn/ })).toBeInTheDocument();
});

test('disables expired applications while leaving the source available for inspection', () => {
    isExternalJobExpired.mockReturnValue(true);
    render(<ExternalJobDetail />);
    expect(screen.getByRole('button', { name: 'Tin đã hết hạn' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Tin đã qua hạn nộp hồ sơ công bố');
    expect(screen.queryByRole('link', { name: /Xem tin và ứng tuyển tại nguồn/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Xem bài tuyển dụng gốc/ })).toHaveAttribute('href', job.sourceUrl);
});

test.each(['javascript:alert(1)', 'http://careers.example.test/job', 'https://user:password@example.test/job', 'not-a-url'])(
    'does not render an unsafe source link: %s', sourceUrl => {
        getExternalJob.mockReturnValue({ ...job, sourceUrl });
        render(<ExternalJobDetail />);
        expect(screen.queryByRole('link', { name: /tại nguồn|tuyển dụng gốc/ })).not.toBeInTheDocument();
        expect(screen.getByText('Liên kết nguồn chưa khả dụng.')).toBeInTheDocument();
    }
);

test('renders untrusted source text as text instead of HTML', () => {
    getExternalJob.mockReturnValue({ ...job, summary: '<img src=x onerror=alert(1)>' });
    const { container } = render(<ExternalJobDetail />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
});

test('shows a missing item state with a working return link', () => {
    getExternalJob.mockReturnValue(undefined);
    render(<ExternalJobDetail />);
    expect(screen.getByRole('heading', { name: 'Không tìm thấy tin tuyển dụng' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quay lại tìm việc' })).toHaveAttribute('href', '/job');
    expect(isExternalJobExpired).not.toHaveBeenCalled();
});
