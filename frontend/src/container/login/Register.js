import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { createNewUser, handleLoginService } from '../../service/userService';
import { establishSession, getSocialSignup, completeSocialSignup, startSocialLogin } from '../../auth/authClient';
import SocialButtons, { providerLabels } from '../../auth/SocialButtons';
import { validatePassword, PASSWORD_HINT } from '../../auth/passwordPolicy';
import { safeReturnPath } from '../../auth/sessionExpiry';
import './Login.css';
import './Register.css';

const publicRoles = [
    { code: 'CANDIDATE', title: 'Ứng viên', description: 'Tìm việc phù hợp' },
    { code: 'EMPLOYER', title: 'Nhà tuyển dụng', description: 'Kết nối ứng viên' }
];
const profileFields = ['roleCode', 'firstName', 'lastName', 'email'];
const accountFields = ['phonenumber', 'password', 'againPass'];
const validate = (name, values) => {
    const value = values[name];
    if (name === 'roleCode') return publicRoles.some(role => role.code === value) ? '' : 'Vui lòng chọn loại tài khoản.';
    if (!value || !value.trim()) return 'Không được để trống.';
    if (['firstName', 'lastName'].includes(name) && value.trim().length > 100) return 'Vui lòng nhập tối đa 100 ký tự.';
    if (name === 'email' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || value.trim().length > 254)) return 'Email chưa đúng định dạng.';
    if (name === 'phonenumber' && !/^\d{10}$/.test(value.trim())) return 'Số điện thoại cần đủ 10 chữ số.';
    if (name === 'password') return validatePassword(value);
    if (name === 'againPass' && value !== values.password) return 'Mật khẩu nhập lại chưa trùng khớp.';
    return '';
};
const Eye = ({ visible }) => <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible && <path d="m3 3 18 18"/>}</svg>;

export default function Register() {
    const [values, setValues] = useState({ firstName: '', lastName: '', email: '', phonenumber: '', password: '', againPass: '', roleCode: 'CANDIDATE' });
    const [step, setStep] = useState(1), [errors, setErrors] = useState({});
    const [visible, setVisible] = useState({ password: false, againPass: false });
    const [submittingRequest, setBusy] = useState(false), [created, setCreated] = useState(false), [error, setError] = useState('');
    const submitting = useRef(false), mounted = useRef(true), formRef = useRef(null), headingRef = useRef(null);
    const socialMode = new URLSearchParams(window.location.search).get('sso') === 'complete';
    const [socialProfile, setSocialProfile] = useState(null), [socialLoading, setSocialLoading] = useState(socialMode);
    const [socialRetry, setSocialRetry] = useState(0), [socialStarting, setSocialStarting] = useState('');
    const busy = submittingRequest || socialLoading || !!socialStarting;
    useEffect(() => {
        if (!socialMode) return;
        let active = true;
        setSocialLoading(true); setError('');
        getSocialSignup().then(result => {
            if (result?.errCode !== 0 || !result.profile?.email || !providerLabels[result.profile.provider]) throw new Error('Invalid signup');
            if (active) {
                setSocialProfile(result.profile);
                setValues(current => ({ ...current, firstName: result.profile.firstName || '', lastName: result.profile.lastName || '', email: result.profile.email }));
            }
        }).catch(() => { if (active) setError('Chưa tải được thông tin đăng ký liên kết. Phiên có thể đã hết hạn; hãy thử lại hoặc bắt đầu đăng ký mới.'); })
            .finally(() => { if (active) setSocialLoading(false); });
        return () => { active = false; };
    }, [socialMode, socialRetry]);
    const socialLogin = provider => {
        if (busy) return;
        setSocialStarting(provider); setError('');
        try { startSocialLogin(provider, { rememberMe: false }); }
        catch { setSocialStarting(''); setError('Chưa mở được đăng ký liên kết. Vui lòng thử lại.'); }
    };
    const finishSession = result => {
        establishSession(result);
        const returnPath = safeReturnPath(localStorage.getItem('lastUrl'), window.location.origin);
        localStorage.removeItem('lastUrl');
        window.location.href = ['ADMIN', 'EMPLOYER', 'COMPANY'].includes(result.user.roleCode) ? '/admin/' : returnPath || '/';
    };
    const showFieldErrors = result => {
        if (result?.fieldErrors && typeof result.fieldErrors === 'object') {
            const fields = Object.fromEntries(Object.entries(result.fieldErrors).filter(([name, message]) => [...profileFields, ...accountFields].includes(name) && typeof message === 'string'));
            setErrors(fields);
            if (profileFields.some(name => fields[name])) setStep(1);
        } else if (result?.errCode === 1) setErrors({ phonenumber: result.errMessage });
        else if (result?.errCode === 4) { setStep(1); setErrors({ email: result.errMessage }); }
    };

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const change = event => {
        const { name, value } = event.target;
        if (socialMode && name === 'email') return;
        const next = { ...values, [name]: value };
        setValues(next); setError('');
        setErrors(current => ({
            ...current, [name]: current[name] ? validate(name, next) : '',
            ...(name === 'password' && next.againPass ? { againPass: validate('againPass', next) } : {})
        }));
    };
    const validateFields = fields => {
        const invalid = Object.fromEntries(fields.map(name => [name, validate(name, values)]));
        setErrors(invalid);
        const first = fields.find(name => invalid[name]);
        if (first) formRef.current?.elements.namedItem(first)?.focus?.();
        return !first;
    };
    const goTo = next => {
        setStep(next); setError(''); setErrors({});
        setVisible({ password: false, againPass: false });
        headingRef.current?.focus({ preventScroll: true });
    };
    const login = async () => {
        const result = await handleLoginService({ identifier: values.phonenumber.trim(), password: values.password, rememberMe: false });
        if (!mounted.current) return;
        if (result?.errCode !== 0) throw new Error('Tài khoản đã được tạo. Chưa đăng nhập tự động được, vui lòng đăng nhập bằng số điện thoại và mật khẩu vừa đăng ký.');
        finishSession(result);
    };
    const submit = async event => {
        event.preventDefault();
        if (submitting.current || created || busy || (socialMode && !socialProfile)) return;
        if (step === 1) { if (validateFields(profileFields)) goTo(2); return; }
        if (!validateFields(accountFields)) return;
        submitting.current = true; setBusy(true); setError('');
        let accountCreated = false;
        try {
            const payload = {
                firstName: values.firstName.trim(), lastName: values.lastName.trim(),
                email: values.email.trim().toLowerCase(), phonenumber: values.phonenumber.trim(),
                roleCode: values.roleCode, password: values.password
            };
            const { email, ...socialPayload } = payload;
            const result = await (socialMode ? completeSocialSignup(socialPayload) : createNewUser(payload));
            if (!mounted.current) return;
            if (result?.accountCreated) { accountCreated = true; setCreated(true); }
            if (result?.errCode !== 0) {
                const message = result?.errMessage || 'Chưa tạo được tài khoản. Vui lòng thử lại.';
                showFieldErrors(result);
                setError(message); return;
            }
            accountCreated = true; setCreated(true);
            toast.success('Tạo tài khoản thành công');
            if (socialMode) finishSession(result);
            else await login();
        } catch (failure) {
            if (mounted.current && failure?.response?.data?.accountCreated) { accountCreated = true; setCreated(true); }
            if (mounted.current && !accountCreated && failure?.response?.data?.fieldErrors) { showFieldErrors(failure.response.data); setError(failure.response.data.errMessage || 'Vui lòng kiểm tra lại thông tin.'); }
            else if (mounted.current) setError(accountCreated
                ? 'Tài khoản đã được tạo. Chưa đăng nhập tự động được, vui lòng đăng nhập bằng số điện thoại và mật khẩu vừa đăng ký.'
                : 'Chưa xác nhận được kết quả tạo tài khoản. Vui lòng kiểm tra kết nối; nếu đã đăng ký, hãy chuyển sang đăng nhập.');
        } finally {
            submitting.current = false;
            if (mounted.current) { setBusy(false); if (accountCreated) setValues(current => ({ ...current, password: '', againPass: '' })); }
        }
    };
    const input = (name, label, { type = 'text', autoComplete, hint, maxLength } = {}) => {
        const secret = name === 'password' || name === 'againPass';
        const toggleLabel = name === 'password' ? 'mật khẩu' : 'mật khẩu nhập lại';
        return <div className="jf-login__field">
            <label htmlFor={'register-' + name}>{label}</label>
            <div className={'jf-login__input' + (errors[name] ? ' jf-login__input--invalid' : '')}>
                <input id={'register-' + name} name={name} type={secret ? visible[name] ? 'text' : 'password' : type}
                    inputMode={type === 'tel' ? 'tel' : undefined} autoComplete={autoComplete} value={values[name]}
                    onChange={change} onBlur={() => setErrors(current => ({ ...current, [name]: validate(name, values) }))}
                    placeholder={label} maxLength={maxLength} required disabled={busy} readOnly={name === 'email' && socialMode}
                    aria-invalid={!!errors[name]} aria-describedby={errors[name] ? 'register-error-' + name : hint ? 'register-hint-' + name : undefined}/>
                {secret && <button className="jf-login__password-toggle" type="button" disabled={busy}
                    onClick={() => setVisible(current => ({ ...current, [name]: !current[name] }))}
                    aria-label={(visible[name] ? 'Ẩn ' : 'Hiện ') + toggleLabel} aria-pressed={visible[name]}><Eye visible={visible[name]}/></button>}
            </div>
            {errors[name] ? <span id={'register-error-' + name} className="jf-login__field-error" role="alert">{errors[name]}</span>
                : hint && <small id={'register-hint-' + name} className="jf-register__hint">{hint}</small>}
        </div>;
    };

    return <main className="jf-login jf-register">
        <div className="jf-login__shell">
            <section className="jf-login__form-panel" aria-labelledby="register-title">
                <div className="jf-login__heading"><h1 id="register-title" ref={headingRef} tabIndex={-1}>{created ? 'Tài khoản đã sẵn sàng' : 'Tạo tài khoản'}</h1><p>{created ? 'Chào mừng bạn đến với JobFind.' : socialProfile ? `Hoàn tất tài khoản qua ${providerLabels[socialProfile.provider]}.` : 'Bắt đầu chỉ với hai bước đơn giản.'}</p></div>
                {!created && !socialMode && step === 1 && <SocialButtons registration busy={busy} starting={socialStarting} onStart={socialLogin}/>}
                {socialLoading && <p role="status" className="jf-login__provider-note">Đang tải thông tin đăng ký...</p>}
                {socialMode && !socialProfile && !socialLoading && <div className="jf-register__recover"><button type="button" className="jf-register__back" onClick={() => setSocialRetry(value => value + 1)}>Thử lại</button><Link to="/register" reloadDocument>Bắt đầu đăng ký mới</Link></div>}
                {!created && (!socialMode || socialProfile) && <ol className="jf-register__steps" aria-label="Tiến trình đăng ký"><li aria-current={step === 1 ? 'step' : undefined} className={step === 1 ? 'is-current' : 'is-complete'}><span>{step === 1 ? '1' : '✓'}</span>Thông tin của bạn</li><li aria-current={step === 2 ? 'step' : undefined} className={step === 2 ? 'is-current' : ''}><span>2</span>Bảo mật tài khoản</li></ol>}
                {error && <p role="alert" className="jf-login__notice jf-login__notice--error">{error}</p>}
                {created ? <div className="jf-register__success">
                    <span className="jf-register__success-icon" aria-hidden="true">✓</span>
                    <p role="status">{busy ? 'Đang đăng nhập vào tài khoản của bạn...' : 'Tạo tài khoản thành công. Bạn có thể đăng nhập ngay.'}</p>
                    {!busy && <Link className="jf-login__submit" to="/login">Đến trang đăng nhập →</Link>}
                </div> : (!socialMode || socialProfile) && <form ref={formRef} aria-label="Đăng ký JobFind" onSubmit={submit} noValidate aria-busy={busy}>
                    {step === 1 ? <>
                        <fieldset className="jf-register__roles" disabled={busy}><legend>Bạn muốn sử dụng JobFind để</legend><div>{publicRoles.map(role => <label key={role.code} className={values.roleCode === role.code ? 'is-selected' : ''}><input type="radio" name="roleCode" value={role.code} checked={values.roleCode === role.code} onChange={change}/><span><strong>{role.title}</strong><small>{role.description}</small></span></label>)}</div></fieldset>
                        <div className="jf-register__names">{input('firstName', 'Họ', { autoComplete: 'family-name', maxLength: 100 })}{input('lastName', 'Tên', { autoComplete: 'given-name', maxLength: 100 })}</div>
                        {input('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 254, hint: socialMode ? 'Email đã được xác minh bởi nhà cung cấp và không thể sửa ở bước này.' : undefined })}
                    </> : <>
                        {input('phonenumber', 'Số điện thoại', { type: 'tel', autoComplete: 'username', maxLength: 10 })}
                        {input('password', 'Mật khẩu', { autoComplete: 'new-password', maxLength: 72, hint: PASSWORD_HINT })}
                        {input('againPass', 'Nhập lại mật khẩu', { autoComplete: 'new-password', maxLength: 72 })}
                    </>}
                    <div className="jf-register__actions">
                        {step === 2 && <button type="button" className="jf-register__back" disabled={busy} onClick={() => goTo(1)}>← Quay lại</button>}
                        <button type="submit" className="jf-login__submit" disabled={busy}>{busy ? 'Đang tạo tài khoản...' : step === 1 ? 'Tiếp tục' : 'Tạo tài khoản'}{busy ? <span className="jf-login__spinner" aria-hidden="true"/> : <span aria-hidden="true">→</span>}</button>
                    </div>
                </form>}
                {!created && <p className="jf-login__register">Đã có tài khoản? <Link to="/login">Đăng nhập ngay</Link></p>}
            </section>
        </div>
    </main>;
}
