import favoritePostService from "../services/favoritePostService";

let handleToggleFavoritePost = async (req, res) => {
    try {
        let data = await favoritePostService.handleToggleFavoritePost({
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

let checkFavoriteByUser = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(200).json({ errCode: 0, isFavorite: false });
        }
        // Anonymous callers can learn only the neutral state. Signed-in users
        // can check their own state; query.userId is intentionally ignored.
        let data = await favoritePostService.checkFavoriteByUser({
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

let getFavoritePostByUser = async (req, res) => {
    try {
        let data = await favoritePostService.getFavoritePostByUser({
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
    handleToggleFavoritePost: handleToggleFavoritePost,
    checkFavoriteByUser: checkFavoriteByUser,
    getFavoritePostByUser: getFavoritePostByUser
}
