import React from 'react';
import { render, screen } from '@testing-library/react';
import SupportMarkdown from './SupportMarkdown';

test('renders formatting and internal links without executing HTML or remote content', () => {
    const { container } = render(<SupportMarkdown text={'**Việc làm** [Xem tin](/detail-job/42) <script>alert(1)</script> ![track](https://evil.test/x) [bad](javascript:alert(1)) [external](https://evil.test)'}/>);
    expect(container.querySelector('strong')).toHaveTextContent('Việc làm');
    expect(screen.getByRole('link', { name: 'Xem tin' })).toHaveAttribute('href', '/detail-job/42');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('script, img')).toBeNull();
});

test('repairs a bold route that lost one asterisk without changing valid emphasis', () => {
    // Shapes returned by the live gateway on 2026-10-01.
    const { container } = render(<SupportMarkdown text={'Truy cập */forget-password**\n- Hỗ trợ tại */contact**.\n\nMở **/job** hoặc *ghi chú* và */a/*'}/>);
    expect([...container.querySelectorAll('strong')].map(node => node.textContent)).toEqual(['/forget-password', '/contact', '/job']);
    expect([...container.querySelectorAll('em')].map(node => node.textContent)).toEqual(['ghi chú', '/a/']);
    expect(container.textContent).not.toMatch(/\/contact\*|password\*/);
});
