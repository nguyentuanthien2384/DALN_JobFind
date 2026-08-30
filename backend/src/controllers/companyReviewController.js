import companyReviewService from "../services/companyReviewService";

let handleCreateReview = async (req, res) => {
    try {
        // The authenticated account is always the author. Trusting body.userId
        // allowed a caller to create or overwrite another user's review.
        let data = await companyReviewService.handleCreateReview({
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

let getReviewByCompany = async (req, res) => {
    try {
        let data = await companyReviewService.getReviewByCompany(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let handleDeleteReview = async (req, res) => {
    try {
        // The service still checks owner/admin permissions, but the identity it
        // checks must come from the verified token rather than the request body.
        let data = await companyReviewService.handleDeleteReview({
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

module.exports = {
    handleCreateReview: handleCreateReview,
    getReviewByCompany: getReviewByCompany,
    handleDeleteReview: handleDeleteReview
}
