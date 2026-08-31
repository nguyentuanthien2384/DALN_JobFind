import followCompanyService from "../services/followCompanyService";

let handleToggleFollowCompany = async (req, res) => {
    try {
        let data = await followCompanyService.handleToggleFollowCompany({
            ...req.body,
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

let checkFollowCompany = async (req, res) => {
    try {
        // Follower count stays public, while isFollow is always calculated for
        // the authenticated caller instead of an arbitrary query.userId.
        let data = await followCompanyService.checkFollowCompany({
            ...req.query,
            userId: req.user?.id || null
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

let getFollowedCompanyByUser = async (req, res) => {
    try {
        let data = await followCompanyService.getFollowedCompanyByUser({
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
    handleToggleFollowCompany: handleToggleFollowCompany,
    checkFollowCompany: checkFollowCompany,
    getFollowedCompanyByUser: getFollowedCompanyByUser
}
