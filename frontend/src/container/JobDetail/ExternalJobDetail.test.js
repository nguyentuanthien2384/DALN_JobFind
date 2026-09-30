import React from 'react';
import { render, screen } from '@testing-library/react';
import ExternalJobDetail from './ExternalJobDetail';
import { getExternalJob, isExternalJobExpired, loadExternalJobDetails } from '../../service/externalJobs';

jest.mock('../../service/externalJobs', () => ({ ...jest.requireActual('../../service/externalJobs'),
    getExternalJob: jest.fn(), isExternalJobExpired: jest.fn(), loadExternalJobDetails: jest.fn() }));
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
    sections: [{ title: 'Mô tả công việc', items: ['Kiểm tra kết nối.'], truncated: false },
        { title: 'Yêu cầu công việc', items: ['Có chuyên môn kỹ thuật.'], truncated: false }],
};

beforeEach(() => { jest.clearAllMocks(); getExternalJob.mockReturnValue(job); isExternalJobExpired.mockReturnValue(false); loadExternalJobDetails.mockResolvedValue({}); });

test('loads the source excerpt separately from the search index', async () => {
    const { sections, ...listing } = job;
    getExternalJob.mockReturnValue(listing);
    loadExternalJobDetails.mockResolvedValue({ sections: [{ title: 'Quyền lợi', items: ['Bảo hiểm đầy đủ'], truncated: false }] });
    render(<ExternalJobDetail />);
    expect(screen.getByText('Đang tải nội dung tin gốc…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Quyền lợi' })).toBeInTheDocument();
    expect(loadExternalJobDetails).toHaveBeenCalledWith(job.id);
    expect(screen.queryByText('Đang tải nội dung tin gốc…')).not.toBeInTheDocument();
});

test('falls back to the summary when the excerpt file cannot be loaded', async () => {
    const { sections, ...listing } = job;
    getExternalJob.mockReturnValue(listing);
    loadExternalJobDetails.mockRejectedValue(new Error('offline'));
    render(<ExternalJobDetail />);
    expect(await screen.findByText(/Chưa tải được phần trích dẫn/)).toBeInTheDocument();
    expect(screen.getByText(job.summary)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Xem tin và ứng tuyển tại nguồn/ })).toBeInTheDocument();
});

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

test('shows the source sections with their own headings, sub-labels and a link for the rest', () => {
    getExternalJob.mockReturnValue({ ...job, quantity: '4', workTypeText: 'Toàn thời gian',
        facts: [{ label: 'Kinh nghiệm', value: 'Không yêu cầu kinh nghiệm' }], companyIntro: 'Doanh nghiệp viễn thông.',
        sections: [{ title: 'Quyền lợi', items: ['Thu nhập:', 'Lương cứng và thưởng'], truncated: true }] });
    render(<ExternalJobDetail />);
    expect(screen.getByRole('heading', { name: 'Quyền lợi' })).toBeInTheDocument();
    expect(screen.getByText('Thu nhập:')).toHaveClass('external-job-detail__label');
    expect(screen.getByRole('link', { name: /Xem đầy đủ mục này tại tin gốc/ })).toHaveAttribute('href', job.sourceUrl);
    expect(screen.getByRole('heading', { name: `Về ${job.employer}` })).toBeInTheDocument();
    expect(screen.getAllByText('Số lượng: 4')).toHaveLength(1);
    expect(screen.getByText('Không yêu cầu kinh nghiệm')).toBeInTheDocument();
    expect(screen.getAllByText('Toàn thời gian').length).toBeGreaterThan(0);
});

test('keeps unknown salary and deadline explicit and does not fabricate content', () => {
    getExternalJob.mockReturnValue({ ...job, deadline: null, salaryText: null, sections: [], summary: null });
    render(<ExternalJobDetail />);
    expect(screen.getAllByText('Nguồn chưa công bố')).toHaveLength(2);
    expect(screen.getByText(/Nguồn chưa nêu hạn nộp/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Yêu cầu công việc' })).not.toBeInTheDocument();
    expect(screen.getByText('Xem nội dung chi tiết trên trang tuyển dụng gốc.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Xem tin và ứng tuyển tại nguồn/ })).toBeInTheDocument();
});

test('shows the source logo, banner and job image only from the local source-image folder', () => {
    getExternalJob.mockReturnValue({ ...job, logo: '/external-jobs/logos/test.png', coverImage: '/external-jobs/covers/test.jpg',
        jobImage: { src: '/external-jobs/jobs/test.jpg', alt: 'Ảnh tin tuyển dụng' } });
    render(<ExternalJobDetail />);
    expect(screen.getByRole('img', { name: `Logo ${job.employer}` })).toHaveAttribute('src', '/external-jobs/logos/test.png');
    expect(screen.getByRole('img', { name: `Ảnh từ trang tuyển dụng ${job.sourceName}` })).toHaveAttribute('src', '/external-jobs/covers/test.jpg');
    expect(screen.getByRole('img', { name: 'Ảnh tin tuyển dụng' })).toHaveAttribute('src', '/external-jobs/jobs/test.jpg');
});

test.each(['https://tracker.example.test/logo.png', 'javascript:alert(1)', '/external-jobs/../secret.png'])(
    'ignores image paths outside the source-image folder: %s', logo => {
        getExternalJob.mockReturnValue({ ...job, logo, coverImage: logo });
        const { container } = render(<ExternalJobDetail />);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('TN')).toBeInTheDocument();
    }
);

test('explains a vacancy removed from its source and blocks the application link', () => {
    getExternalJob.mockReturnValue({ ...job, sourceStatus: 'removed', sections: [] });
    render(<ExternalJobDetail />);
    expect(screen.getByRole('button', { name: 'Tin đã bị gỡ khỏi nguồn' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('không còn hiển thị tin này');
    expect(screen.queryByRole('link', { name: /tại nguồn|tuyển dụng gốc|tại tin gốc/ })).not.toBeInTheDocument();
});

test('does not repeat a source fact that only restates the employer', () => {
    getExternalJob.mockReturnValue({ ...job, facts: [{ label: 'Đơn vị', value: job.employer }, { label: 'Ngành nghề', value: 'Kỹ thuật' }] });
    render(<ExternalJobDetail />);
    expect(screen.queryByText('Đơn vị')).not.toBeInTheDocument();
    expect(screen.getByText('Kỹ thuật')).toBeInTheDocument();
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
    getExternalJob.mockReturnValue({ ...job, sections: [{ title: 'Mô tả công việc', items: ['<img src=x onerror=alert(1)>'], truncated: false }] });
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
