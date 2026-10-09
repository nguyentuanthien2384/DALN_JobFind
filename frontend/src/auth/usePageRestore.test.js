import { act, renderHook } from '@testing-library/react';
import usePageRestore from './usePageRestore';

const pageshow = persisted => {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: persisted });
    window.dispatchEvent(event);
};

test('restores a page returned from the browser back-forward cache without resetting a normal navigation', () => {
    const onRestore = jest.fn();
    renderHook(() => usePageRestore(onRestore));
    act(() => pageshow(false));
    expect(onRestore).not.toHaveBeenCalled();
    act(() => pageshow(true));
    expect(onRestore).toHaveBeenCalledTimes(1);
});

test('uses the latest restore handler after an auth flow changes and stops handling closed pages', () => {
    const first = jest.fn(), latest = jest.fn();
    const view = renderHook(({ onRestore }) => usePageRestore(onRestore), { initialProps: { onRestore: first } });
    view.rerender({ onRestore: latest });
    act(() => pageshow(true));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    view.unmount();
    act(() => pageshow(true));
    expect(latest).toHaveBeenCalledTimes(1);
});
