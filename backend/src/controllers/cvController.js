import cvService from '../services/cvService';
import db from '../models/index';
import { emitDashboardChanged } from '../config/socket';
import { emitApplicationSubmitted } from '../utils/eventBus';
import {
    isAdmin,
    isRecruiter,
    getRole,
    getCompanyId,
    canAccessCompany,
    canAccessPostApplicants,
    canAccessCandidateProfile
} from '../utils/authorization';

const forbidden = (res, errMessage) => res.status(403).json({
    errCode: 3,
    errMessage: errMessage || 'Bạn không có quyền truy cập dữ liệu này'
});

let handleCreateNewCV = async (req, res) => {
    try {
        // Nguoi nop CV luon la tai khoan dang dang nhap, khong lay userId tu body
        // (neu khong thi co the nop CV mao danh nguoi khac).
        let data = await cvService.handleCreateCv({
            ...req.body,
            userId: req.user.id
        });
        // Ung vien vua nop CV -> bang "so luong CV" ben nha tuyen dung phai doi ngay.
        if (data.errCode === 0) emitDashboardChanged('cv');
        // Bao cho Application Service de ho so vao bang Kanban. Thieu buoc nay thi
        // nha tuyen dung khong thay ho so moi cho toi khi service khoi dong lai.
        if (data.errCode === 0 && data.cvId) emitApplicationSubmitted(data.cvId);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getAllListCvByPost = async (req, res) => {
    try {
        // Danh sach ung vien cua mot tin chi thuoc ve cong ty dang tin do.
        const allowed = await canAccessPostApplicants(req, req.query.postId);
        if (!allowed) {
            return forbidden(res, 'Bạn không có quyền xem hồ sơ ứng tuyển của tin này');
        }
        let data = await cvService.getAllListCvByPost(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getDetailCvById = async (req, res) => {
    try {
        const cv = await db.Cv.findOne({
            where: { id: req.query.cvId },
            attributes: ['id', 'userId', 'postId'],
            raw: true
        });
        if (!cv) {
            return res.status(200).json({
                errCode: 2,
                errMessage: 'Không tìm thấy CV'
            });
        }

        // Ung vien xem CV cua chinh minh; nha tuyen dung xem CV nop vao tin cua
        // cong ty minh; admin xem tat ca.
        const isOwner = Number(cv.userId) === Number(req.user.id);
        const allowed = isOwner || await canAccessPostApplicants(req, cv.postId);
        if (!allowed) {
            return forbidden(res, 'Bạn không có quyền xem hồ sơ này');
        }

        // roleCode quyet dinh CV co bi danh dau "da xem" hay khong, nen phai lay
        // tu token chu khong phai tu query (truoc day ung vien tu gui EMPLOYER duoc).
        let data = await cvService.getDetailCvById({
            cvId: req.query.cvId,
            roleCode: isOwner ? 'CANDIDATE' : getRole(req)
        });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getAllCvByUserId = async (req, res) => {
    try {
        const targetUserId = req.query.userId || req.user.id;
        // Khong chi dua vao role: nha tuyen dung phai co ban ghi mo khoa cho dung
        // cong ty + ung vien. CandidateView duoc tao boi endpoint tru luot atomic.
        const allowed = await canAccessCandidateProfile(req, targetUserId);
        if (!allowed) {
            return forbidden(res, 'Bạn chưa mở quyền xem hồ sơ ứng viên này');
        }
        let data = await cvService.getAllCvByUserId({
            ...req.query,
            userId: targetUserId
        });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getStatisticalCv= async (req, res) => {
    try {
        const companyId = isAdmin(req) ? req.query.companyId : getCompanyId(req);
        if (!canAccessCompany(req, companyId)) {
            return forbidden(res, 'Bạn không có quyền xem thống kê của công ty này');
        }
        let data = await cvService.getStatisticalCv({
            ...req.query,
            companyId
        });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let fillterCVBySelection= async (req, res) => {
    try {
        // Kho ho so ung vien la tinh nang tra phi cua nha tuyen dung, khong the
        // de mo cho moi nguoi (truoc day khong can dang nhap cung goi duoc).
        if (!isRecruiter(req) && !isAdmin(req)) {
            return forbidden(res, 'Chỉ nhà tuyển dụng mới được tìm kiếm ứng viên');
        }
        let data = await cvService.fillterCVBySelection(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let checkSeeCandiate= async (req, res) => {
    try {
        // Admin kiem tra du lieu he thong ma khong tieu hao goi cua bat ky cong ty.
        if (isAdmin(req)) {
            return res.status(200).json({
                errCode: 0,
                errMessage: 'Ok',
                alreadyGranted: true,
                chargedAllowance: null
            });
        }
        if (!isRecruiter(req) && !isAdmin(req)) {
            return forbidden(res, 'Chỉ nhà tuyển dụng mới được xem hồ sơ ứng viên');
        }
        const companyId = getCompanyId(req);
        if (companyId === null) {
            return res.status(200).json({
                errCode: 2,
                errMessage: 'Không tìm thấy công ty người dùng sở hữu'
            });
        }
        let data = await cvService.checkSeeCandiate({
            companyId: companyId,
            candidateId: req.query.candidateId
        });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
module.exports = {
    handleCreateNewCV: handleCreateNewCV,
    getAllListCvByPost: getAllListCvByPost,
    getDetailCvById: getDetailCvById,
    getAllCvByUserId: getAllCvByUserId,
    getStatisticalCv: getStatisticalCv,
    fillterCVBySelection: fillterCVBySelection,
    checkSeeCandiate:checkSeeCandiate
}
