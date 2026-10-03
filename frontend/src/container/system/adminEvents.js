// Tin hieu trong trang: vua duyet tin, duyet cong ty hay xu ly yeu cau ho tro.
// Menu va dashboard nghe tin hieu nay de cap nhat so "can xu ly" ngay, khong
// cho chu ky tai lai. Tach rieng de cac trang nghiep vu khong phai nap kho so lieu.
export const ATTENTION_CHANGED_EVENT = 'jobfind:admin-attention-changed';

export const notifyAdminAttentionChanged = () => window.dispatchEvent(new Event(ATTENTION_CHANGED_EVENT));
