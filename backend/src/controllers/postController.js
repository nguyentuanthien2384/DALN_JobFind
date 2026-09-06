import postService from '../services/postService';
import { emitJobCreated, emitJobUpdated } from '../utils/eventBus';
import { emitDashboardChanged } from '../config/socket';
import { canAccessPostApplicants } from '../utils/authorization';

const forbidden = (res, errMessage) => res.status(403).json({
    errCode: 3,
    errMessage: errMessage || 'Bạn không có quyền thao tác với tin tuyển dụng này'
});

let handleCreateNewPost = async (req, res) => {
    try {
        let data = await postService.handleCreateNewPost({
            ...req.body,
            userId: req.user.id
        });
        // Bao cho Search Service biet co tin moi. Neu thieu buoc nay, tin dang
        // qua man hinh nay se khong bao gio vao Elasticsearch - nguoi dung tim
        // khong ra. Da tung xay ra that.
        if (data.errCode === 0 && data.postId) emitJobCreated(data.postId);
        // Bai dang moi lam doi bieu do "top linh vuc" -> bao cho dashboard tu tai lai.
        if (data.errCode === 0) emitDashboardChanged('post');
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleReupPost = async (req, res) => {
    try {
        if (!await canAccessPostApplicants(req, req.body.postId)) {
            return forbidden(res, 'Bạn không có quyền đăng lại tin tuyển dụng này');
        }
        let data = await postService.handleReupPost({
            ...req.body,
            userId: req.user.id
        });
        // Dang lai sinh ra mot tin MOI chu khong sua tin cu, nen phai phat
        // "tin moi" voi id moi. Neu phat "cap nhat" kem id cu thi tin dang lai
        // se khong bao gio vao Elasticsearch.
        if (data.errCode === 0 && data.postId) emitJobCreated(data.postId);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleUpdatePost = async (req, res) => {
    try {
        const postId = req.body.id ?? req.body.postId;
        if (!await canAccessPostApplicants(req, postId)) {
            return forbidden(res, 'Bạn không có quyền cập nhật tin tuyển dụng này');
        }
        let data = await postService.handleUpdatePost({
            ...req.body,
            id: postId,
            userId: req.user.id
        }, {
            roleCode: req.user.userAccountData?.roleCode,
            companyId: req.user.companyId
        });
        // Doi trang thai/noi dung -> Elasticsearch phai cap nhat theo,
        // neu khong tin bi tu choi van con hien trong ket qua tim kiem.
        if (data.errCode === 0 && data.changed !== false) {
            const changedId = req.body.id ?? req.body.postId;
            if (changedId) emitJobUpdated(changedId);
        }
        return res.status(data.conflict === true ? 409 : 200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleBanPost = async (req, res) => {
    try {
        let data = await postService.handleBanPost({
            ...req.body,
            userId: req.user.id
        });
        // Doi trang thai/noi dung -> Elasticsearch phai cap nhat theo,
        // neu khong tin bi tu choi van con hien trong ket qua tim kiem.
        if (data.errCode === 0) {
            const changedId = req.body.id ?? req.body.postId;
            if (changedId) emitJobUpdated(changedId);
        }
        // Bieu do "top linh vuc" chi dem tin dang hoat dong (statusCode PS1), nen
        // khoa/duyet/mo lai tin deu lam so lieu doi theo.
        if (data.errCode === 0) emitDashboardChanged('post');
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let handleAcceptPost = async (req, res) => {
    try {
        let data = await postService.handleAcceptPost({
            ...req.body,
            userId: req.user.id
        });
        // Doi trang thai/noi dung -> Elasticsearch phai cap nhat theo,
        // neu khong tin bi tu choi van con hien trong ket qua tim kiem.
        if (data.errCode === 0) {
            const changedId = req.body.id ?? req.body.postId;
            if (changedId) emitJobUpdated(changedId);
        }
        if (data.errCode === 0) emitDashboardChanged('post');
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getListPostByAdmin = async (req, res) => {
    try {
        // Nha tuyen dung chi duoc liet ke tin cua chinh cong ty minh; neu nhan
        // companyId tu query thi ho doc duoc ca tin cua doi thu.
        const role = req.user?.userAccountData?.roleCode;
        const companyId = role === 'ADMIN' ? req.query.companyId : req.user?.companyId;
        let data = await postService.getListPostByAdmin({
            ...req.query,
            companyId: companyId
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

let getAllPostByAdmin = async (req, res) => {
    try {
        let data = await postService.getAllPostByAdmin(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getDetailPostById = async (req, res) => {
    try {
        const includeNonPublic = req.user
            ? await canAccessPostApplicants(req, req.query.id)
            : false;
        let data = await postService.getDetailPostById(req.query.id, { includeNonPublic });
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let handleActivePost = async (req, res) => {
    try {
        let data = await postService.handleActivePost({
            ...req.body,
            userId: req.user.id
        });
        // Doi trang thai/noi dung -> Elasticsearch phai cap nhat theo,
        // neu khong tin bi tu choi van con hien trong ket qua tim kiem.
        if (data.errCode === 0) {
            const changedId = req.body.id ?? req.body.postId;
            if (changedId) emitJobUpdated(changedId);
        }
        if (data.errCode === 0) emitDashboardChanged('post');
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getFilterPost = async (req, res) => {
    try {
        let data = await postService.getFilterPost(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getStatisticalTypePost = async (req, res) => {
    try {
        const isAdmin = req.user?.userAccountData?.roleCode === 'ADMIN';
        // Recruiters see only their tenant's jobs. Admin may request one
        // company explicitly or omit companyId for a platform-wide report.
        let data = await postService.getStatisticalTypePost({
            ...req.query,
            companyId: isAdmin ? req.query.companyId : req.user.companyId
        });
        return res.status(200).json(data)
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getListNoteByPost = async (req, res) => {
    try {
        if (!await canAccessPostApplicants(req, req.query.id)) {
            return forbidden(res, 'Bạn không có quyền xem ghi chú của tin tuyển dụng này');
        }
        let data = await postService.getListNoteByPost(req.query);
        return res.status(200).json(data)
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}
let getRelatedPost = async (req, res) => {
    try {
        let data = await postService.getRelatedPost(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getRecommendedPost = async (req, res) => {
    try {
        // Recommendation inputs may expose private skill/profile preferences.
        // Always calculate them for the authenticated user, never query.userId.
        let data = await postService.getRecommendedPost({
            ...req.query,
            userId: req.user.id
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
    handleCreateNewPost: handleCreateNewPost,
    handleUpdatePost: handleUpdatePost,
    handleBanPost: handleBanPost,
    getListPostByAdmin: getListPostByAdmin,
    getAllPostByAdmin: getAllPostByAdmin,
    getDetailPostById: getDetailPostById,
    handleActivePost: handleActivePost,
    handleAcceptPost: handleAcceptPost,
    getFilterPost: getFilterPost,
    getStatisticalTypePost: getStatisticalTypePost,
    getListNoteByPost: getListNoteByPost,
    handleReupPost : handleReupPost,
    getRelatedPost: getRelatedPost,
    getRecommendedPost: getRecommendedPost
}
