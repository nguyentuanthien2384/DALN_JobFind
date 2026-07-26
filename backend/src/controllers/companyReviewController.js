import companyReviewService from "../services/companyReviewService";

let handleCreateReview = async (req, res) => {
    try {
        let data = await companyReviewService.handleCreateReview(req.body);
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
        let data = await companyReviewService.handleDeleteReview(req.body);
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
