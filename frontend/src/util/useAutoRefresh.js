import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "../socket";

/**
 * Tu dong tai lai du lieu cho cac trang thong ke (dashboard).
 *
 * Truoc day cac trang dashboard chi goi API dung MOT lan luc mo trang
 * (useEffect voi mang phu thuoc rong), nen so lieu dung yen cho toi khi nguoi
 * dung bam F5. Hook nay bo sung 3 co che chay song song:
 *
 *   1. Socket: backend ban tin hieu 'dashboard:changed' moi khi co bai dang moi,
 *      CV moi hay don hang moi -> so lieu doi gan nhu tuc thi. Day la co che chinh.
 *   2. Poll dinh ky: luoi an toan cho truong hop socket khong ket noi duoc
 *      (mang chan websocket, backend vua khoi dong lai...). Khong phai co che chinh
 *      nen de thua khoang cach ra, tranh dap vao backend nhung truy van thong ke nang.
 *   3. Quay lai tab: roi tab mot luc lau roi quay lai thi tai lai ngay, khong
 *      phai ngoi cho het chu ky poll moi thay so lieu moi.
 *
 * Khi tab bi an, poll duoc TAM DUNG. Nho vay mo san vai tab dashboard roi de do
 * ca ngay cung khong lam backend chay truy van thong ke lien tuc.
 *
 * @param {Function} taiLaiDuLieu Ham tai lai du lieu (co the async).
 * @param {{khoangPoll?: number, bat?: boolean}} tuyChon
 * @returns {{capNhatLuc: Date|null, dangTai: boolean, lamMoi: Function}}
 */
const useAutoRefresh = (taiLaiDuLieu, tuyChon = {}) => {
    const { khoangPoll = 30000, bat = true } = tuyChon;

    const [capNhatLuc, setCapNhatLuc] = useState(null);
    const [dangTai, setDangTai] = useState(false);

    // Component goi hook tao lai ham taiLaiDuLieu o MOI lan render. Giu no trong
    // ref thay vi cho vao mang phu thuoc cua effect: neu cho vao, interval se bi
    // huy roi tao lai sau moi lan render nen khong bao gio chay den luc kich hoat.
    // Ref duoc gan lai sau moi lan render nen luon la ban moi nhat, khong bi doc
    // phai state cu.
    const refHam = useRef(taiLaiDuLieu);
    useEffect(() => {
        refHam.current = taiLaiDuLieu;
    });

    const conSong = useRef(true);
    const dangChay = useRef(false);
    useEffect(() => {
        conSong.current = true;
        return () => {
            conSong.current = false;
        };
    }, []);

    const lamMoi = useCallback(async () => {
        // API thong ke co the cham hon chu ky poll. Neu khong chan thi cac lan
        // goi se chong len nhau va lan tra ve sau cung chua chac la lan moi nhat.
        if (dangChay.current) return;
        dangChay.current = true;
        setDangTai(true);
        try {
            await refHam.current();
            if (conSong.current) setCapNhatLuc(new Date());
        } catch (error) {
            // Mat mang tam thoi thi giu nguyen so lieu dang hien, lan sau tai lai.
            console.warn("Khong tai lai duoc du lieu dashboard:", error);
        } finally {
            dangChay.current = false;
            if (conSong.current) setDangTai(false);
        }
    }, []);

    useEffect(() => {
        if (!bat) return undefined;

        let hen = null;
        // Nhieu tin hieu do ve sat nhau (vd: duyet mot luc 5 bai dang) thi gop
        // lai thanh mot lan goi API.
        const lamMoiHoanLai = () => {
            window.clearTimeout(hen);
            hen = window.setTimeout(lamMoi, 500);
        };

        const dinhKy = window.setInterval(() => {
            if (document.visibilityState === "visible") lamMoi();
        }, khoangPoll);

        const khiDoiTab = () => {
            if (document.visibilityState === "visible") lamMoiHoanLai();
        };
        document.addEventListener("visibilitychange", khiDoiTab);

        // Khong co socket (chua dang nhap / khong ket noi duoc) thi van con poll.
        const socket = getSocket();
        if (socket) socket.on("dashboard:changed", lamMoiHoanLai);

        return () => {
            window.clearTimeout(hen);
            window.clearInterval(dinhKy);
            document.removeEventListener("visibilitychange", khiDoiTab);
            if (socket) socket.off("dashboard:changed", lamMoiHoanLai);
        };
    }, [bat, khoangPoll, lamMoi]);

    return { capNhatLuc, dangTai, lamMoi };
};

export default useAutoRefresh;
