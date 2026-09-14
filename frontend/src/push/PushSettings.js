import React, { useEffect, useRef, useState } from "react";
import { supported, status, getConfig, enable, disable } from "./webPush";
export default function PushSettings({ userId }) {
  const [state, setState] = useState("loading"),
    [config, setConfig] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const changing = useRef(false);
  useEffect(() => {
    let active = true,
      version = 0;
    const refresh = async () => {
      const current = ++version;
      if (!supported()) {
        if (active) setState("unsupported");
        return;
      }
      try {
        const [settings, device] = await Promise.all([
          getConfig(),
          status(userId),
        ]);
        if (active && current === version) {
          setConfig(settings);
          setState(
            device === "enabled" && settings.subscribed === false
              ? "disabled"
              : device,
          );
          setError("");
        }
      } catch {
        if (active && current === version) {
          setState("error");
          setError("Chưa kiểm tra được thông báo. Bạn có thể thử lại.");
        }
      }
    };
    refresh();
    window.addEventListener("jobfind:push-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("jobfind:push-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [userId]);
  const toggle = async () => {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError("");
    try {
      if (state === "error") {
        setConfig(await getConfig());
        setState(await status(userId));
      } else {
        if (state === "enabled") await disable();
        else await enable(userId, config.publicKey);
        setState(await status(userId));
      }
    } catch (e) {
      setError(e.message || "Không cập nhật được thông báo.");
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Thông báo khi rời trang"
      style={{
        marginBottom: 16,
        padding: 14,
        border: "1px solid #eee",
        borderRadius: 10,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 240px" }}>
          <strong>Thông báo khi rời trang</strong>
          <p style={{ fontSize: 13, margin: "4px 0", color: "#666" }}>
            Nhận báo có tin nhắn mới trên thiết bị này. Nội dung cuộc trò chuyện
            được giữ riêng tư.
          </p>
        </div>
        {!["loading", "unsupported", "denied"].includes(state) &&
          (config?.enabled || state === "enabled" || state === "error") && (
            <button
              type="button"
              className="btn btn-light"
              disabled={busy}
              onClick={toggle}
            >
              {busy
                ? "Đang cập nhật…"
                : state === "error"
                  ? "Kiểm tra lại"
                  : state === "enabled"
                    ? "Tắt thông báo"
                    : "Bật thông báo"}
            </button>
          )}
      </div>
      <div role="status" style={{ fontSize: 13, color: "#666" }}>
        {state === "loading"
          ? "Đang kiểm tra…"
          : state === "unsupported"
            ? "Thiết bị chưa hỗ trợ. Trên iPhone/iPad, hãy thêm website vào Màn hình chính rồi mở lại."
            : state === "denied"
              ? "Thông báo đang bị chặn trong cài đặt trình duyệt."
              : state === "enabled"
                ? "Đã bật trên thiết bị này."
                : config && !config.enabled
                  ? "Hệ thống chưa bật dịch vụ thông báo đẩy."
                  : state === "disabled"
                    ? "Chưa bật. Bạn có thể thay đổi lựa chọn bất cứ lúc nào."
                    : ""}
      </div>
      {error && (
        <div role="alert" style={{ color: "#b42318", marginTop: 8 }}>
          {error}
        </div>
      )}
    </section>
  );
}
