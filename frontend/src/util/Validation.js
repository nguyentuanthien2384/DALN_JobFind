import { validatePassword } from '../auth/passwordPolicy';
// type
// isEmpty. check empty
// password. check password
// email.check email
// phone. check phonenumber

// return 
// true. ok 
// 2. type is wrong



// Same structural rules as backend/src/utils/accountValidation.js. Every repetition is
// anchored by a literal "." so matching stays linear (the old /^\w+([.-]?\w+)*@.../ pattern
// backtracked exponentially: 31 characters froze the tab for ~14s) and long TLDs or "+" tags pass.
const EMAIL_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i
const EMAIL_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
const isEmail = (value) => {
    const email = String(value).trim()
    const parts = email.split('@')
    if (email.length > 254 || parts.length !== 2) return false
    const [local, domain] = parts
    const labels = domain.split('.')
    return local.length <= 64 && EMAIL_LOCAL.test(local)
        && domain.length <= 253 && labels.length >= 2 && labels.every(label => EMAIL_LABEL.test(label))
}
const phoneRegex = /^\d{10}$/   // min 10 number
const handleValidate = (data, type) => {
    var kq = ''
    if (data === '' || data === null)
        return kq = 'Không được để trống'
    switch (type) {
        case "isEmpty":
            return true
        case "password":
        case "newpassword":
            return validatePassword(data) || true
        case "email":
            if (isEmail(data))
                return true
            kq = 'Email sai định dạng'
            return kq
        case "phone":
            if (phoneRegex.test(data))
                return true
            kq = 'Số điện thoại cần 10 số'
            return kq
        default:
            return 2
    }

}

export default handleValidate
