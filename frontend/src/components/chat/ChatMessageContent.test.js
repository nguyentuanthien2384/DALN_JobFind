import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatMessageContent, { ChatFileCard, ChatJobCard } from './ChatMessageContent';

jest.mock('antd', () => {
    const React = require('react');
    return { Modal: ({ open, title, onCancel, children }) => open ?
        <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onCancel}>Đóng</button></div> : null };
});

const job = overrides => ({
    id: 42, name: 'Frontend Engineer', companyName: 'Example Co',
    descriptionText: 'React & Node.js', location: 'Hà Nội', salary: 'Thỏa thuận',
    experience: '2 năm', workType: 'Hybrid', sharedAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
});

test('renders message text verbatim including line breaks and without interpreting markup', () => {
    const content = 'Dòng 1\n<img src=x onerror=alert(1)>\nDòng 3';
    const { container } = render(<ChatMessageContent message={{ content }} onPreview={jest.fn()} />);
    expect(container.querySelector('.chat-message-text').textContent).toBe(content);
    expect(container.querySelector('.chat-message-text')).toHaveClass('chat-message-text');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xem PDF' })).not.toBeInTheDocument();
});

test('passes the complete attachment to preview without leaking bytes into the card', () => {
    const onPreview = jest.fn();
    const attachment = { id: 'file-1', name: 'Hồ sơ.pdf', size: 1536, pageCount: 3, bytes: 'private-bytes' };
    const { container } = render(<ChatMessageContent message={{ content: '', attachment }} onPreview={onPreview} />);
    expect(screen.getByText('Hồ sơ.pdf')).toBeVisible();
    expect(screen.getByText(/2 KB · 3 trang/)).toBeVisible();
    expect(container).not.toHaveTextContent('private-bytes');
    fireEvent.click(screen.getByRole('button', { name: 'Xem PDF' }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(attachment);
});

test('uses a safe fallback label for a file with no name or optional metadata', () => {
    render(<ChatFileCard attachment={{ id: 'file-2' }} onPreview={jest.fn()} />);
    expect(screen.getByText('Tài liệu PDF')).toBeVisible();
    expect(screen.getAllByText('PDF')).toHaveLength(2);
    expect(screen.queryByText(/trang/)).not.toBeInTheDocument();
});

test('shows the saved job snapshot and offers a separate current-job link', () => {
    render(<ChatJobCard job={job()} />);
    expect(screen.getByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
    expect(screen.getByText('Example Co')).toBeVisible();
    for (const value of ['Hà Nội', 'Thỏa thuận', '2 năm', 'Hybrid']) expect(screen.getByText(value)).toBeVisible();
    expect(screen.getByRole('link', { name: /Xem tin mới nhất/ })).toHaveAttribute('href', '/detail-job/42');
    expect(screen.getByRole('link', { name: /Xem tin mới nhất/ })).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết bản đã gửi' }));
    expect(screen.getByRole('dialog', { name: 'Frontend Engineer' })).toHaveTextContent('Đây là nội dung được lưu khi chia sẻ');
    expect(screen.getByRole('dialog')).toHaveTextContent('React & Node.js');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('keeps a long description short in the card but complete in the detail dialog', () => {
    const descriptionText = 'Vị trí cần kinh nghiệm React. '.repeat(20);
    const { container } = render(<ChatJobCard job={job({ descriptionText })} draft />);
    const excerpt = container.querySelector('.chat-job-excerpt');
    expect(excerpt.textContent).toHaveLength(191);
    expect(excerpt).toHaveTextContent(/…$/);
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết trước khi gửi' }));
    expect(container.querySelector('.chat-job-description').textContent).toBe(descriptionText);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Đây là nội dung được lưu khi chia sẻ');
});

test.each(['not-a-number', -1, 0, Number.MAX_SAFE_INTEGER + 1])('does not form a current-job link from invalid ID %s', id => {
    render(<ChatJobCard job={job({ id, sharedAt: 'invalid-date', descriptionText: '' })} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xem chi tiết/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nội dung tại thời điểm gửi/)).not.toBeInTheDocument();
});

test('renders plain text, attachment and saved job together for a rich message', () => {
    const { container } = render(<ChatMessageContent message={{
        content: 'Xem tài liệu và tin tuyển dụng',
        attachment: { id: 'file-3', name: 'Hồ sơ.pdf' }, jobSnapshot: job(),
    }} onPreview={jest.fn()} />);
    expect(container.querySelector('.chat-message-text')).toHaveTextContent('Xem tài liệu và tin tuyển dụng');
    expect(screen.getByRole('button', { name: 'Xem PDF' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Frontend Engineer' })).toBeVisible();
});
