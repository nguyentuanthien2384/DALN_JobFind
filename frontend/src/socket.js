import { io } from "socket.io-client";

/**
 * Ket noi Socket.IO dung chung cho ca ung dung.
 *
 * Socket chi la lop tang toc: neu ket noi that bai thi cac trang van chay binh
 * thuong bang API REST + poll nhu truoc, khong vo giao dien.
 *
 * Token duoc gui trong handshake de backend xac thuc; backend lay userId tu
 * token chu khong tin userId do client gui len.
 */
const URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

let socket = null;

export const getSocket = () => {
    const token = localStorage.getItem("token_user");
    if (!token) return null;

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
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        autoConnect: true,
    });

    socket.on("connect_error", (err) => {
        // Khong hien toast de khong lam phien nguoi dung: da co co che poll du phong.
        console.warn("Socket khong ket noi duoc, dung che do poll:", err.message);
    });

    return socket;
};

export const disconnectSocket = () => {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

export default getSocket;
