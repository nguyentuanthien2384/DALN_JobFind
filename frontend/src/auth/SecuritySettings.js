import React, { useEffect, useState } from 'react';
import api from '../axios';
import { forgetAccess, startGoogleLink } from './authClient';
import { disconnectSocket } from '../socket';
import { clearPushOnLogout } from '../push/webPush';

const eventLabels = {
  login_succeeded: 'Đăng nhập thành công', login_failed: 'Đăng nhập không thành công',
  identity_linked: 'Đã liên kết tài khoản Google', identity_unlinked: 'Đã hủy liên kết tài khoản Google',
  session_revoked: 'Đã đăng xuất một phiên', sessions_revoked_all: 'Đã đăng xuất tất cả thiết bị',
  refresh_reuse_detected: 'Đã thu hồi phiên do phát hiện mã phiên bị sử dụng lại',
  account_security_changed: 'Đã thay đổi mật khẩu hoặc trạng thái tài khoản', sso_rejected: 'Đăng nhập Google không thành công',
};

export default function SecuritySettings() {
  const [data, setData] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const result = await api.get('/api/auth/security');
    if (result?.errCode !== 0) throw new Error(result?.errMessage || 'Không tải được thông tin bảo mật.');
    setData(result);
  };
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const finishLogout = async () => {
    await clearPushOnLogout();
    localStorage.removeItem('token_user');
    localStorage.removeItem('userData');
    forgetAccess();
    disconnectSocket();
    window.location.assign('/login');
  };
  const perform = async (action, endSession = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await action();
      if (result && result.errCode !== 0) throw new Error(result.errMessage || 'Không thực hiện được thao tác.');
      if (endSession) await finishLogout();
      else await load();
    } catch (e) { setError(e?.response?.data?.errMessage || e.message || 'Vui lòng thử lại.'); }
    finally { setPassword(''); setBusy(false); }
  };
  const date = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa đăng nhập';
  const loadMore = async () => {
    setBusy(true); setError('');
    try {
      const next = await api.get('/api/auth/security/events', { params: { before: data.nextCursor } });
      if (next?.errCode !== 0) throw new Error('Không tải được lịch sử bảo mật.');
      setData(previous => ({ ...previous, events: [...previous.events, ...next.events], nextCursor: next.nextCursor }));
    } catch { setError('Không tải được lịch sử bảo mật. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  return <main className="container py-5" style={{ maxWidth: 900 }}>
    <h1>Bảo mật và đăng nhập</h1>
    <p>Quản lý tài khoản Google và các phiên đang đăng nhập vào JobFind.</p>
    {new URLSearchParams(window.location.search).get('sso') === 'linked' && <p role="status" className="alert alert-success">Đã liên kết tài khoản Google thành công.</p>}
    {error && <div role="alert" className="alert alert-danger">{error} <button className="btn btn-link" disabled={busy} onClick={() => perform(load)}>Thử lại</button></div>}
    {!data && !error && <p role="status">Đang tải...</p>}
    {data && <>
      <section className="card p-4 mb-4" aria-labelledby="google-title">
        <h2 id="google-title">Tài khoản Google</h2>
        <p>Đăng nhập bằng Google giữ nguyên vai trò và quyền của tài khoản JobFind hiện tại.</p>
        {data.identities.length === 0 && <p>Chưa có tài khoản Google nào được liên kết.</p>}
        {data.identities.map(identity => <div key={identity.id} className="border rounded p-3 mb-3">
          <strong>{identity.emailAtLink || 'Tài khoản Google đã liên kết'}</strong>
          <p className="mb-2">Đăng nhập gần nhất: {date(identity.lastLoginAt)}</p>
          <button className="btn btn-outline-danger" disabled={busy || !password} onClick={() => {
            if (window.confirm('Hủy liên kết Google và đăng xuất tất cả phiên? Bạn vẫn có thể đăng nhập bằng số điện thoại và mật khẩu.'))
              perform(() => api.post(`/api/auth/identities/${identity.id}/unlink`, { password }), true);
          }}>Hủy liên kết</button>
        </div>)}
        {(data.google || data.identities.length > 0) && <><label htmlFor="security-password">Mật khẩu JobFind hiện tại</label>
        <input id="security-password" className="form-control mb-3" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <small className="d-block mb-3">Nhập mật khẩu để xác nhận việc liên kết hoặc hủy liên kết Google.</small></>}
        {data.google ? <button className="btn btn-primary" disabled={busy || !password} onClick={() => perform(() => startGoogleLink(password))}>Liên kết tài khoản Google</button>
          : <p role="status">Đăng nhập Google chưa được quản trị viên cấu hình.</p>}
      </section>
      <section className="card p-4" aria-labelledby="sessions-title">
        <h2 id="sessions-title">Các phiên đăng nhập</h2>
        <p>Mỗi lần đăng nhập tạo một phiên. Thu hồi phiên sẽ chặn truy cập từ phiên đó.</p>
        <ul className="list-unstyled">
          {data.sessions.map(session => <li key={session.familyId} className="border rounded p-3 mb-3 d-flex flex-wrap justify-content-between align-items-center">
            <div><strong>{session.current ? 'Phiên hiện tại' : 'Phiên khác'} · {session.method === 'password' ? 'Mật khẩu' : 'Google'}</strong>
              <p className="mb-1">{session.deviceLabel || 'Chưa có thông tin thiết bị'}</p>
              <p className="mb-1">Đăng nhập: {date(session.startedAt || session.createdAt)}</p>
              {session.lastUsedAt && <p className="mb-1">Cập nhật phiên gần nhất: {date(session.lastUsedAt)}</p>}
              <p className="mb-1">Hết hạn: {date(session.expiresAt)}</p></div>
            <button className="btn btn-outline-danger" disabled={busy} onClick={() => {
              if (window.confirm('Đăng xuất phiên này?')) perform(() => api.delete(`/api/auth/sessions/${session.familyId}`), session.current);
            }}>Đăng xuất phiên</button>
          </li>)}
        </ul>
        <button className="btn btn-danger" disabled={busy} onClick={() => {
          if (window.confirm('Đăng xuất tất cả thiết bị, bao gồm phiên hiện tại?')) perform(() => api.post('/api/auth/logout-all', {}), true);
        }}>Đăng xuất tất cả thiết bị</button>
      </section>
      <section className="card p-4 mt-4" aria-labelledby="history-title">
        <h2 id="history-title">Lịch sử bảo mật</h2>
        <p>Thông tin trình duyệt và thiết bị chỉ mang tính tham khảo. Nếu thấy phiên lạ, hãy đăng xuất tất cả thiết bị và đổi mật khẩu.</p>
        {!(data.events || []).length && <p>Chưa có hoạt động bảo mật được ghi nhận.</p>}
        <ul className="list-unstyled">
          {(data.events || []).map(event => <li key={event.id} className="border rounded p-3 mb-2">
            <strong>{eventLabels[event.event] || 'Hoạt động bảo mật'}</strong>
            <p className="mb-0">{date(event.createdAt)}{event.deviceLabel ? ` · ${event.deviceLabel}` : ''}</p>
          </li>)}
        </ul>
        {data.nextCursor && <button className="btn btn-outline-secondary" disabled={busy} onClick={loadMore}>Xem hoạt động trước đó</button>}
      </section>
    </>}
  </main>;
}
