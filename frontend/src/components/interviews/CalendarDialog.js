import React, { useEffect, useRef } from 'react';

// A keyboard-accessible dialog also restores focus to the calendar event on close.
export default function CalendarDialog({ title, children, onClose, busy = false }) {
    const container = useRef(null);
    const close = useRef(onClose);
    const locked = useRef(busy);
    close.current = onClose;
    locked.current = busy;
    useEffect(() => {
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        container.current?.querySelector('button, input, select, textarea, a[href]')?.focus();
        const keyboard = (event) => {
            if (event.key === 'Escape' && !locked.current) close.current();
            if (event.key !== 'Tab') return;
            const focusable = Array.from(container.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first) { event.preventDefault(); container.current?.focus(); }
            else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', keyboard);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', keyboard);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);
    return <div className="interview-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <section className="interview-dialog" role="dialog" aria-modal="true" aria-labelledby="interview-dialog-title" ref={container} tabIndex={-1}>
            <header><h2 id="interview-dialog-title">{title}</h2><button type="button" className="ic-icon-button" aria-label="Đóng hộp thoại" disabled={busy} onClick={onClose}>×</button></header>
            <div className="interview-dialog-body">{children}</div>
        </section>
    </div>;
}
