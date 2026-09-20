import { io } from "socket.io-client";
import { expireSession } from "./auth/sessionExpiry";
import { getAccessTokenSync } from "./auth/authClient";

/**
 * Ket noi Socket.IO dung chung cho ca ung dung.
 *
 * Socket chi la lop tang toc: neu ket noi that bai thi cac trang van chay binh
 * thuong bang API REST + poll nhu truoc, khong vo giao dien.
 *
 * Token duoc gui trong handshake de backend xac thuc; backend lay userId tu
 * token chu khong tin userId do client gui len.
 */
const URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:4000";

let socket = null;
let reconnectTimer;

export const getSocket = () => {
    const owner = localStorage.getItem("token_user");
    const token = getAccessTokenSync();
    if (!token) { disconnectSocket(); return null; }

    if (socket && socket.auth && socket.auth.token === token) {
        return socket;
    }
    // Doi tai khoan (token khac) thi bo ket noi cu di roi tao lai.
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    socket = io(URL, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5,
        tryAllTransports: true,
        autoConnect: true,
    });
    const current = socket;
    socket.on('disconnect', (reason) => {
        if (reason !== 'io server disconnect') return;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            if (socket === current && localStorage.getItem('token_user') === owner && !current.connected) current.connect();
        }, 3000 + Math.random() * 2000);
    });

    socket.on('auth:expired', ({ code } = {}) => {
        if (['AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_INACTIVE'].includes(code)) expireSession(owner, code === 'AUTH_INACTIVE' ? 'inactive' : 'expired');
    });
    socket.on("connect_error", (err) => {
        if (['AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_INACTIVE'].includes(err.data?.code)) expireSession(owner, err.data.code === 'AUTH_INACTIVE' ? 'inactive' : 'expired');
        if (['AUTH_UNAVAILABLE', 'RATE_LIMITED', 'CONNECTION_LIMITED'].includes(err.data?.code)) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                if (socket === current && localStorage.getItem('token_user') === owner && !current.connected) current.connect();
            }, 30000 + Math.random() * 5000);
        }
        // Khong hien toast de khong lam phien nguoi dung: da co co che poll du phong.
        console.warn("Socket khong ket noi duoc, dung che do poll:", err.message);
    });

    return socket;
};

export const disconnectSocket = () => {
    clearTimeout(reconnectTimer);
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

// Resume after an extended outage. Never reconnect with a superseded token.
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        if (socket && socket.auth?.token === getAccessTokenSync() && !socket.connected) socket.connect();
    });
    window.addEventListener('storage', (event) => {
        if (event.key === 'token_user' && socket?.auth?.token !== getAccessTokenSync()) disconnectSocket();
    });
}
export default getSocket;
