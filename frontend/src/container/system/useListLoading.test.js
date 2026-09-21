import { act, renderHook } from '@testing-library/react';
import useListLoading from './useListLoading';

test('a new URL query is busy before its fetch effect starts', () => {
    const { result, rerender } = renderHook(({ query }) => useListLoading(query), {
        initialProps: { query: 'page=1' },
    });
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    const finishPrevious = result.current[1];
    rerender({ query: 'page=2' });
    expect(result.current[0]).toBe(true);
    // A completed request that corrects an out-of-range page cannot unlock
    // retained rows before the corrected query has finished loading.
    act(() => finishPrevious(false));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
});
