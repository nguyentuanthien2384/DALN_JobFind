import favoritePostService from "../services/favoritePostService";

let handleToggleFavoritePost = async (req, res) => {
    try {
        let data = await favoritePostService.handleToggleFavoritePost(req.body);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let checkFavoriteByUser = async (req, res) => {
    try {
        let data = await favoritePostService.checkFavoriteByUser(req.query);
        return res.status(200).json(data);
    } catch (error) {
        console.log(error)
        return res.status(200).json({
            errCode: -1,
            errMessage: 'Error from server'
        })
    }
}

let getFavoritePostByUser = async (req, res) => {
    try {
        let data = await favoritePostService.getFavoritePostByUser(req.query);
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
    handleToggleFavoritePost: handleToggleFavoritePost,
    checkFavoriteByUser: checkFavoriteByUser,
    getFavoritePostByUser: getFavoritePostByUser
}
