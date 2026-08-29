import React from "react";
import moment from "moment";

/**
 * Dai bang nho hien tren cac trang thong ke: cho biet trang dang tu cap nhat,
 * lan cap nhat gan nhat la luc nao, va cho bam de tai lai ngay.
 *
 * Co cai nut "Lam moi" vi khong phai thay doi nao cung sinh ra tin hieu socket
 * (vd: quan tri sua du lieu thang trong CSDL), luc do van co duong tai lai
 * ma khong phai F5 mat het bo loc dang chon.
 */
const AutoRefreshInfo = ({ capNhatLuc, dangTai, onLamMoi }) => {
    return (
        <div className="tu-dong-cap-nhat">
            <span className="tu-dong-cap-nhat__cham" />
            <span className="tu-dong-cap-nhat__chu">
                Tự động cập nhật
                {capNhatLuc && (
                    <> &middot; lúc {moment(capNhatLuc).format("HH:mm:ss")}</>
                )}
            </span>
            <button
                type="button"
                className="tu-dong-cap-nhat__nut"
                onClick={onLamMoi}
                disabled={dangTai}
            >
                <i
                    title={dangTai ? "Đang tải" : "Sẵn sàng"}
                    className={
                        "fas fa-sync-alt" + (dangTai ? " dang-quay" : "")
                    }
                />
                {dangTai ? "Đang tải..." : "Làm mới"}
            </button>
        </div>
    );
};

export default AutoRefreshInfo;
