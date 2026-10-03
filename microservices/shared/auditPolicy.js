// Thao tac nao KHONG dang ghi vao nhat ky hoat dong.
//
// Lam moi phien dang nhap (POST /api/auth/refresh) do trinh duyet tu goi ngam
// vai phut mot lan, khong phai hanh dong cua nguoi dung, nhung tung chiem phan
// lon nhat ky va day cac thao tac that xuong duoi. Chi bo qua lan THANH CONG:
// lan lam moi that bai (token bi dung lai, het han, bi thu hoi) van duoc ghi vi
// co gia tri khi dieu tra bao mat.
//
// Gateway dung danh sach nay de khong gui; Admin Service dung lai de tu choi ghi
// neu mot ban Gateway cu van gui len.
const ROUTINE_ACTIONS = [
    { method: 'POST', route: /^\/api\/auth\/refresh\/?$/i },
];

export const isRoutineAction = ({ method, route, status } = {}) => {
    const code = Number(status);
    if (!Number.isFinite(code) || code >= 400) return false;
    const verb = String(method || '').toUpperCase();
    const path = String(route || '').split('?')[0];
    return ROUTINE_ACTIONS.some((rule) => rule.method === verb && rule.route.test(path));
};
