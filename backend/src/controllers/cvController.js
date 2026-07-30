import cvService from '../services/cvService';
import { emitDashboardChanged } from '../config/socket';

let handleCreateNewCV = async (req, res) => {
    try {
        let data = await cvService.handleCreateCv(req.body);
        // Ung vien vua nop CV -> bang "so luong CV" ben nha tuyen dung phai doi ngay.
        if (data.errCode === 0) emitDashboardChanged('cv');
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
        let data = await cvService.getDetailCvById(req.query);
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
        let data = await cvService.getAllCvByUserId(req.query);
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
        let data = await cvService.getStatisticalCv(req.query);
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
        let data = await cvService.checkSeeCandiate(req.query);
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