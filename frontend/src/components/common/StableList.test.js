import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import StableList from './StableList';

test('holds the measured space during loading and a shorter last page, then resets for a new filter', () => {
    let height = 600;
    const measure = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 800, height }));
    try {
        const view = render(<StableList resetKey="React"><p>Page 1</p></StableList>);
        const root = view.container.firstChild;
        expect(root).toHaveStyle({ minHeight: '600px' });
        height = 10;
        view.rerender(<StableList busy resetKey="React"><p>Pending</p></StableList>);
        expect(root).toHaveStyle({ minHeight: '600px' });
        height = 200;
        view.rerender(<StableList resetKey="React"><p>Last page</p></StableList>);
        expect(root).toHaveStyle({ minHeight: '600px' });
        view.rerender(<StableList resetKey="Vue"><p>New filter</p></StableList>);
        expect(root).toHaveStyle({ minHeight: '200px' });
    } finally { measure.mockRestore(); }
});

test('blocks pending row actions and hides stale content from assistive technology', () => {
    const click = jest.fn();
    const view = render(<StableList busy><button onClick={click}>Delete</button></StableList>);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(screen.getByText('Delete'));
    expect(click).not.toHaveBeenCalled();
    view.rerender(<StableList><button onClick={click}>Delete</button></StableList>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(click).toHaveBeenCalledTimes(1);
});
