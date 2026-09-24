import React, { useLayoutEffect, useRef, useState } from 'react';
import './StableList.css';

/** Keep the list's space while loading, then let the new results set its height. */
export default function StableList({ busy = false, resetKey = '', label = 'Đang tải trang mới…', children, className = '' }) {
    const content = useRef(null);
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        const node = content.current;
        if (!node) return;
        const measure = () => {
            if (busy) return;
            const rect = node.getBoundingClientRect();
            const nextHeight = Math.ceil(rect.height);
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
    return <div className={`stable-list ${className}`} aria-busy={busy} style={busy && height ? { minHeight: height } : undefined}>
        <div ref={content} className="stable-list__content" inert={busy ? '' : undefined} aria-hidden={busy || undefined}
            onClickCapture={stopPendingAction} onKeyDownCapture={stopPendingAction}>
            {children}
        </div>
        {busy && <div className="stable-list__overlay"><span className="stable-list__status" role="status" aria-live="polite">
            <span className="stable-list__spinner" aria-hidden="true" />{label}
        </span></div>}
    </div>;
}
