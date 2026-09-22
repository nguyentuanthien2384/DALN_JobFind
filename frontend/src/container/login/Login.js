import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { handleLoginService } from '../../service/userService';
import { safeReturnPath } from '../../auth/sessionExpiry';
import { establishSession, refreshSession, startSocialLogin } from '../../auth/authClient';
import SocialButtons from '../../auth/SocialButtons';
import './Login.css';

const Icon = ({ name, size = 20 }) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {name === 'shield' ? <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>
        : name === 'phone' ? <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></>
            : name === 'lock' ? <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>
                : name === 'arrow' ? <path d="M4 12h16m-6-6 6 6-6 6"/>
                    : <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{name === 'eye-off' && <path d="m3 3 18 18"/>}</>}
</svg>;


const sessionMessages = {
    expired: 'Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.',
    inactive: 'Tài khoản đã bị khóa hoặc chưa kích hoạt. Vui lòng liên hệ quản trị viên.',
    'password-changed': 'Đã đổi mật khẩu và đăng xuất các phiên cũ. Vui lòng đăng nhập bằng mật khẩu mới.'
};
const ssoMessages = {
    cancelled: 'Bạn đã hủy đăng nhập bằng tài khoản liên kết. Có thể thử lại hoặc đăng nhập bằng mật khẩu.',
    'email-unverified': 'Email của tài khoản liên kết chưa được xác minh. Hãy xác minh email tại nhà cung cấp rồi thử lại.',
    'account-exists': 'Email này đã có tài khoản JobFind. Hãy đăng nhập bằng mật khẩu, rồi mở “Bảo mật và đăng nhập” để liên kết tài khoản. Không tự động liên kết chỉ dựa trên email.',
    'not-linked': 'Tài khoản Google này chưa liên kết với JobFind. Hãy đăng nhập bằng số điện thoại, mở “Bảo mật và đăng nhập” từ menu tài khoản để liên kết Google.',
    failed: 'Không thể xác thực tài khoản liên kết. Yêu cầu có thể đã hết hạn hoặc bị hủy. Vui lòng thử lại.'
};

export default function Login() {
    const location = useLocation();
    const guardedReturnPath = safeReturnPath(location.state?.from, window.location.origin);
    const [values, setValues] = useState({ identifier: '', password: '' });
    const [showPassword, setShowPassword] = useState(false), [capsLock, setCapsLock] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({}), [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false), [socialStarting, setSocialStarting] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const params = new URLSearchParams(window.location.search), sso = params.get('sso');
    const [completingSso, setCompletingSso] = useState(sso === 'success');
    const submittingRef = useRef(false), phoneRef = useRef(null), passwordRef = useRef(null);
    const busy = submitting || completingSso || !!socialStarting;

    useEffect(() => {
        if (sso !== 'success') return;
        let active = true;
        refreshSession().then(result => {
            if (!active) return;
            establishSession(result);
            const returnPath = safeReturnPath(localStorage.getItem('lastUrl'), window.location.origin);
            localStorage.removeItem('lastUrl');
            window.location.replace(returnPath || (['ADMIN', 'COMPANY', 'EMPLOYER'].includes(result.user.roleCode) ? '/admin/' : '/'));
        }).catch(() => {
            if (active) { setError('Không thể hoàn tất đăng nhập liên kết. Vui lòng đăng nhập lại.'); setCompletingSso(false); }
        });
        return () => { active = false; };
    }, [sso]);

    const handleChange = event => {
        const { name, value } = event.target;
        setValues(current => ({ ...current, [name]: value }));
        setFieldErrors(current => ({ ...current, [name]: '' })); setError('');
    };
    const handleSubmit = async event => {
        event.preventDefault();
        if (submittingRef.current || busy) return;
        const invalid = {};
        if (!values.identifier.trim()) invalid.identifier = 'Vui lòng nhập email hoặc số điện thoại.';
        if (!values.password) invalid.password = 'Vui lòng nhập mật khẩu.';
        setFieldErrors(invalid); setError('');
        if (Object.keys(invalid).length) { (invalid.identifier ? phoneRef : passwordRef).current?.focus(); return; }
        submittingRef.current = true; setSubmitting(true);
        try {
            const result = await handleLoginService({ identifier: values.identifier.trim(), password: values.password, rememberMe });
            if (result?.errCode === 0) {
                establishSession(result);
                const lastUrl = guardedReturnPath || safeReturnPath(localStorage.getItem('lastUrl'), window.location.origin);
                localStorage.removeItem('lastUrl');
                window.location.href = ['ADMIN', 'EMPLOYER', 'COMPANY'].includes(result.user.roleCode) ? '/admin/' : lastUrl || '/';
            } else {
                const message = result?.errMessage || 'Đăng nhập thất bại. Vui lòng thử lại.';
                setError(message); toast.error(message);
            }
        } catch {
            const message = 'Không gửi được yêu cầu đăng nhập. Vui lòng thử lại.';
            setError(message); toast.error(message);
        } finally { submittingRef.current = false; setSubmitting(false); }
    };
    const socialLogin = provider => {
        if (busy) return;
        setSocialStarting(provider); setError('');
        try {
            if (guardedReturnPath) localStorage.setItem('lastUrl', guardedReturnPath);
            startSocialLogin(provider, { rememberMe });
        } catch { setSocialStarting(''); setError('Chưa mở được đăng nhập liên kết. Vui lòng thử lại.'); }
    };

    return <main className="jf-login">
        <div className="jf-login__shell">
            <section className="jf-login__form-panel" aria-labelledby="login-title">
                <div className="jf-login__heading"><span className="jf-login__eyebrow">CHÀO MỪNG BẠN TRỞ LẠI</span><h1 id="login-title">Đăng nhập</h1><p>Tiếp tục hành trình của bạn cùng JobFind.</p></div>
                {sessionMessages[params.get('reason')] && <p className="jf-login__notice" role="status">{sessionMessages[params.get('reason')]}</p>}
                {ssoMessages[sso] && <p className={'jf-login__notice' + (sso !== 'cancelled' ? ' jf-login__notice--error' : '')} role={sso === 'cancelled' ? 'status' : 'alert'}>{ssoMessages[sso]}</p>}
                {completingSso && <p className="jf-login__notice" role="status">Đang hoàn tất đăng nhập liên kết...</p>}
                {error && <p className="jf-login__notice jf-login__notice--error" role="alert">{error}</p>}
                <SocialButtons busy={busy} starting={socialStarting} onStart={socialLogin}/>
                <form onSubmit={handleSubmit} noValidate aria-label="Đăng nhập JobFind" aria-busy={submitting}>
                    <div className="jf-login__field"><label htmlFor="login-phone">Email hoặc số điện thoại</label><div className={'jf-login__input' + (fieldErrors.identifier ? ' jf-login__input--invalid' : '')}><Icon name="phone"/><input ref={phoneRef} id="login-phone" type="text" autoCapitalize="none" spellCheck={false} autoComplete="username" name="identifier" value={values.identifier} onChange={handleChange} placeholder="Email hoặc số điện thoại" required disabled={busy} aria-invalid={!!fieldErrors.identifier} aria-describedby={fieldErrors.identifier ? 'login-phone-error' : undefined}/></div>{fieldErrors.identifier && <span id="login-phone-error" className="jf-login__field-error" role="alert">{fieldErrors.identifier}</span>}</div>
                    <div className="jf-login__field"><div className="jf-login__label-row"><label htmlFor="login-password">Mật khẩu</label><Link to="/forget-password">Quên mật khẩu?</Link></div><div className={'jf-login__input' + (fieldErrors.password ? ' jf-login__input--invalid' : '')}><Icon name="lock"/><input ref={passwordRef} id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" name="password" value={values.password} onChange={handleChange} onKeyUp={event => setCapsLock(event.getModifierState?.('CapsLock') || false)} onBlur={() => setCapsLock(false)} placeholder="Mật khẩu" required disabled={busy} aria-invalid={!!fieldErrors.password} aria-describedby={[fieldErrors.password && 'login-password-error', capsLock && 'login-caps-lock'].filter(Boolean).join(' ') || undefined}/><button className="jf-login__password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} disabled={busy}><Icon name={showPassword ? 'eye-off' : 'eye'}/></button></div>{fieldErrors.password && <span id="login-password-error" className="jf-login__field-error" role="alert">{fieldErrors.password}</span>}{capsLock && <small id="login-caps-lock" className="jf-login__caps" role="status">Caps Lock đang bật.</small>}</div>
                    <label className="jf-login__remember"><input type="checkbox" checked={rememberMe} disabled={busy} onChange={event => setRememberMe(event.target.checked)}/>Ghi nhớ đăng nhập trong 14 ngày</label>
                    <button className="jf-login__submit" type="submit" disabled={busy}>{submitting ? 'Đang đăng nhập...' : completingSso ? 'Đang xác thực...' : 'Đăng nhập'}{submitting || completingSso ? <span className="jf-login__spinner" aria-hidden="true"/> : <Icon name="arrow" size={19}/>}</button>
                </form>
                <p className="jf-login__register">Chưa có tài khoản? <Link to="/register">Tạo tài khoản ngay <span aria-hidden="true">↗</span></Link></p>
                <div className="jf-login__safety"><Icon name="shield" size={17}/><span>Không chia sẻ mật khẩu hoặc mã xác thực cho người khác.</span></div>
            </section>
        </div>
    </main>;
}
