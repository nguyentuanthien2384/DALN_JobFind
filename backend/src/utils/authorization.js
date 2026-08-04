import db from "../models/index";

// Cac ham dung chung de tra loi cau hoi "nguoi dang dang nhap co duoc dong vao
// du lieu nay khong". Truoc day moi controller deu nhan userId / companyId thang
// tu query nen ai cung doc duoc CV va thong ke cua cong ty khac.

const ROLE_ADMIN = 'ADMIN';
const RECRUITER_ROLES = ['EMPLOYER', 'COMPANY'];

const getRole = (req) => req.user?.userAccountData?.roleCode || null;

const isAdmin = (req) => getRole(req) === ROLE_ADMIN;

const isRecruiter = (req) => RECRUITER_ROLES.includes(getRole(req));

// Cong ty ma nguoi dang dang nhap thuoc ve. Tra ve null neu chua vao cong ty nao.
const getCompanyId = (req) => {
    const companyId = req.user?.companyId;
    return companyId === null || companyId === undefined ? null : Number(companyId);
};

// Nguoi dung co duoc xem du lieu cua cong ty nay khong.
const canAccessCompany = (req, companyId) => {
    if (isAdmin(req)) return true;
    if (companyId === null || companyId === undefined || companyId === 'null') return false;
    const mine = getCompanyId(req);
    return mine !== null && mine === Number(companyId);
};

// Tim cong ty so huu mot tin tuyen dung (post -> nguoi dang -> cong ty).
const getCompanyIdOfPost = async (postId) => {
    if (!postId) return null;
    const post = await db.Post.findOne({
        where: { id: postId },
        attributes: ['id', 'userId'],
        include: [
            { model: db.User, as: 'userPostData', attributes: ['id', 'companyId'] }
        ],
        raw: true,
        nest: true
    });
    if (!post || !post.userPostData) return null;
    const companyId = post.userPostData.companyId;
    return companyId === null || companyId === undefined ? null : Number(companyId);
};

// Nha tuyen dung chi duoc xem ho so ung tuyen vao tin cua chinh cong ty minh.
const canAccessPostApplicants = async (req, postId) => {
    if (isAdmin(req)) return true;
    if (!isRecruiter(req)) return false;
    const companyIdOfPost = await getCompanyIdOfPost(postId);
    if (companyIdOfPost === null) return false;
    return getCompanyId(req) === companyIdOfPost;
};

module.exports = {
    ROLE_ADMIN,
    RECRUITER_ROLES,
    getRole,
    isAdmin,
    isRecruiter,
    getCompanyId,
    canAccessCompany,
    getCompanyIdOfPost,
    canAccessPostApplicants
};
