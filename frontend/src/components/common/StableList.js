import React, { useLayoutEffect, useRef, useState } from 'react';
import './StableList.css';

/** Keep the list's space while another page loads, including a shorter last page. */
export default function StableList({ busy = false, resetKey = '', label = 'Đang tải trang mới…', children, className = '' }) {
    const content = useRef(null);
    const measurement = useRef({ key: resetKey, width: 0, height: 0 });
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        const node = content.current;
        if (!node) return;
        const measure = () => {
            if (busy) return;
            const rect = node.getBoundingClientRect();
            const previous = measurement.current;
            const reset = previous.key !== resetKey || Math.abs(previous.width - rect.width) > 1;
            const nextHeight = Math.ceil(reset ? rect.height : Math.max(previous.height, rect.height));
            measurement.current = { key: resetKey, width: rect.width, height: nextHeight };
            setHeight(value => value === nextHeight ? value : nextHeight);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [busy, resetKey, children]);
    const stopPendingAction = event => {
        if (busy) { event.preventDefault(); event.stopPropagation(); }
    };
    return <div className={`stable-list ${className}`} aria-busy={busy} style={height ? { minHeight: height } : undefined}>
        <div ref={content} className="stable-list__content" inert={busy ? '' : undefined} aria-hidden={busy || undefined}
            onClickCapture={stopPendingAction} onKeyDownCapture={stopPendingAction}>
            {children}
        </div>
        {busy && <div className="stable-list__overlay"><span className="stable-list__status" role="status" aria-live="polite">
            <span className="stable-list__spinner" aria-hidden="true" />{label}
        </span></div>}
    </div>;
}
