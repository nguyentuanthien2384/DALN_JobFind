const webPush = require("web-push");
const { createHash, ECDH } = require("crypto");

// ===== WEB PUSH (chuan W3C Push API, thu vien web-push, xac thuc VAPID) =====
// Bao "co tin nhan moi" ca khi tab JobFind da dong. Cach hoat dong:
// 1. Trinh duyet dang ky service worker (frontend/public/push-sw.js) va xin quyen thong
//    bao; trinh duyet tao "subscription" gom endpoint cua push service (FCM cua Chrome,
//    Mozilla, Apple) va khoa ma hoa p256dh/auth rieng cho thiet bi do.
// 2. Backend luu subscription (webPushService.subscribe) theo tai khoan.
// 3. Khi co tin moi, backend goi web-push: payload duoc MA HOA dau-cuoi bang khoa cua
//    thiet bi (push service khong doc duoc), ky JWT VAPID bang khoa rieng cua JobFind de
//    push service biet ai gui; service worker nhan va hien thong bao.
// - hosts: chi chap nhan endpoint cua cac push service that, chong SSRF (ke xau dang ky
//   endpoint tro vao mang noi bo de may chu tu goi).
// - Payload chi la "Ban co tin nhan moi" (khong noi dung, khong ten nguoi gui).
// Khoa VAPID tao bang: npm --prefix backend run push:keys.
const hosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "updates-autopush.stage.mozaws.net",
  "web.push.apple.com",
]);
const settings = () => {
  if (process.env.WEB_PUSH_ENABLED !== "true") return null;
  const vapidDetails = {
    subject: process.env.WEB_PUSH_SUBJECT,
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY,
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY,
  };
  // Validate once per call without exposing keys in error messages.
  try {
    webPush.generateRequestDetails(
      { endpoint: "https://fcm.googleapis.com/test" },
      null,
      { vapidDetails },
    );
  } catch {
    throw new Error("Invalid Web Push configuration");
  }
  return { vapidDetails, TTL: 3600, timeout: 5000, urgency: "normal" };
};
const endpointId = (endpoint) =>
  createHash("sha256").update(endpoint).digest("hex");
const validEndpoint = (value) => {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      (hosts.has(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)) &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
};
const validSubscription = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !["endpoint", "keys", "expirationTime"].includes(k),
    ) ||
    !validEndpoint(value.endpoint)
  )
    return false;
  if (
    !value.keys ||
    Object.keys(value.keys).some((k) => !["auth", "p256dh"].includes(k))
  )
    return false;
  const validKey = (key, length) =>
    typeof key === "string" &&
    key.length === Math.ceil((length * 4) / 3) &&
    /^[A-Za-z0-9_-]+$/.test(key) &&
    Buffer.from(key, "base64url").length === length;
  if (!validKey(value.keys.auth, 16) || !validKey(value.keys.p256dh, 65))
    return false;
  try {
    ECDH.convertKey(Buffer.from(value.keys.p256dh, "base64url"), "prime256v1");
    return (
      value.expirationTime == null ||
      (Number.isFinite(value.expirationTime) &&
        value.expirationTime > Date.now())
    );
  } catch {
    return false;
  }
};
module.exports = { settings, endpointId, validEndpoint, validSubscription };
