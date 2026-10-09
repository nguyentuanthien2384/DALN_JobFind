import { useEffect, useState } from 'react';
import { getAllCompany, getAllPostByRoleAdminService } from '../../service/userService';
import { supportRequest } from '../../service/supportChatService';
import { ATTENTION_CHANGED_EVENT } from './adminEvents';

/**
 * Viec dang cho quan tri vien xu ly: tin cho duyet, cong ty cho duyet, yeu cau
 * ho tro chua ai tiep nhan.
 *
 * Menu (badge) va dashboard (the "Can xu ly") doc chung mot ban so lieu nen chi
 * co MOT vong tai lai du ca hai cung dang mo. Gia tri null nghia la chua biet
 * (lan tai dau that bai) - giao dien khong duoc hien thanh 0.
 */
const POLL_MS = 60000;

let snapshot = { pendingPosts: null, pendingCompanies: null, waitingSupport: null, loadedAt: null };
const listeners = new Set();
let inFlight = null;
let timer = null;

const countOf = async (request) => {
    try {
        const response = await request();
        const raw = response?.count;
        const count = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
        return response?.errCode === 0 && Number.isSafeInteger(count) && count >= 0 ? count : null;
    } catch {
        return null;
    }
};

const waitingTickets = async () => {
    try {
        const tickets = await supportRequest('/handoffs');
        return Array.isArray(tickets) ? tickets.filter(ticket => ticket.status === 'waiting').length : null;
    } catch {
        return null;
    }
};

export const getAdminAttention = () => snapshot;

/** Tai lai ngay; cac lan goi chong nhau dung chung mot request. */
export const refreshAdminAttention = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        const [pendingPosts, pendingCompanies, waitingSupport] = await Promise.all([
            countOf(() => getAllPostByRoleAdminService({ limit: 1, offset: 0, search: '', censorCode: 'PS3' })),
            countOf(() => getAllCompany({ limit: 1, offset: 0, search: '', censorCode: 'CS3' })),
            waitingTickets(),
        ]);
        // Mot nguon loi thi giu so lieu cu cua nguon do thay vi xoa trang.
        snapshot = {
            pendingPosts: pendingPosts ?? snapshot.pendingPosts,
            pendingCompanies: pendingCompanies ?? snapshot.pendingCompanies,
            waitingSupport: waitingSupport ?? snapshot.waitingSupport,
            loadedAt: new Date(),
        };
        listeners.forEach(listener => listener(snapshot));
        return snapshot;
    })().finally(() => { inFlight = null; });
    return inFlight;
};

const refreshWhenVisible = () => {
    if (document.visibilityState !== 'hidden' && navigator.onLine !== false) refreshAdminAttention();
};

const start = () => {
    refreshWhenVisible();
    timer = window.setInterval(refreshWhenVisible, POLL_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    window.addEventListener(ATTENTION_CHANGED_EVENT, refreshWhenVisible);
};

const stop = () => {
    window.clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', refreshWhenVisible);
    window.removeEventListener('online', refreshWhenVisible);
    window.removeEventListener(ATTENTION_CHANGED_EVENT, refreshWhenVisible);
};

export const useAdminAttention = (enabled = true) => {
    const [state, setState] = useState(snapshot);
    useEffect(() => {
        if (!enabled) return undefined;
        listeners.add(setState);
        setState(snapshot);
        if (listeners.size === 1) start();
        return () => {
            listeners.delete(setState);
            if (listeners.size === 0) stop();
        };
    }, [enabled]);
    return state;
};

// Chi dung trong kiem thu: dua kho ve trang thai ban dau.
export const resetAdminAttentionForTests = () => {
    snapshot = { pendingPosts: null, pendingCompanies: null, waitingSupport: null, loadedAt: null };
    inFlight = null;
    listeners.clear();
    stop();
};
