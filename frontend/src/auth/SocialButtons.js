import React, { useEffect, useState } from 'react';
import { getProviders } from './authClient';

export const providerLabels = { google: 'Google', github: 'GitHub', auth0: 'Auth0' };

export default function SocialButtons({ busy, starting, onStart, registration = false }) {
  const [providers, setProviders] = useState({});
  const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    getProviders().then(result => {
      if (typeof result?.google !== 'boolean' || result.errCode) throw new Error('Invalid provider response');
      if (active) { setProviders(result); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [retry]);
  const visible = Object.keys(providerLabels).filter(provider => providers[provider] === true || (!registration && provider === 'google'));
  if (registration && !visible.length && status !== 'error') return null;
  return <div className="jf-login__social">
    <div className="jf-login__social-buttons">{visible.map(provider => <button key={provider} className="jf-login__google" type="button"
      disabled={busy || providers[provider] !== true} onClick={() => onStart(provider)}
      aria-label={starting === provider ? `Đang chuyển đến ${providerLabels[provider]}...` : `${registration ? 'Đăng ký' : 'Đăng nhập'} bằng ${providerLabels[provider]}`}
      aria-describedby={!registration && provider === 'google' ? 'login-google-note' : undefined}>
      <span className={'jf-login__provider-icon jf-login__provider-icon--' + provider} aria-hidden="true">{provider === 'google' ? 'G' : provider === 'github' ? 'GH' : 'A'}</span>
      {starting === provider ? `Đang chuyển đến ${providerLabels[provider]}...` : visible.length > 1 ? providerLabels[provider] : `${registration ? 'Đăng ký' : 'Đăng nhập'} bằng ${providerLabels[provider]}`}
    </button>)}</div>
    {status === 'error' ? <p className="jf-login__provider-note jf-login__provider-note--error">Chưa kiểm tra được phương thức đăng nhập. <button type="button" disabled={busy} onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>Thử lại</button></p>
      : !registration && <p id="login-google-note" className={'jf-login__provider-note' + (status === 'ready' && !providers.google ? ' jf-login__provider-note--unavailable' : '')} aria-live="polite">
        {status === 'loading' ? 'Đang kiểm tra phương thức đăng nhập...'
          : providers.google ? 'Tiếp tục bằng tài khoản của bạn hoặc tạo tài khoản mới.'
            : 'Đăng nhập Google chưa được bật. Bạn vẫn có thể dùng email hoặc số điện thoại và mật khẩu.'}
      </p>}
    <div className="jf-login__divider"><span>{registration ? 'hoặc điền thông tin bên dưới' : 'hoặc dùng tài khoản JobFind'}</span></div>
  </div>;
}
