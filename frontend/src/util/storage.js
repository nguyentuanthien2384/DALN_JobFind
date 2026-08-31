export const readJsonStorage = (key, fallback = null) => {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        // Du lieu dang nhap/don hang cu co the bi hong sau khi nang cap ung dung.
        // Xoa rieng khoa loi de lan tai trang sau khong tiep tuc bi trang man hinh.
        try {
            localStorage.removeItem(key);
        } catch (storageError) {
            // Trinh duyet co the chan storage; fallback van giup giao dien hoat dong.
        }
        return fallback;
    }
};

