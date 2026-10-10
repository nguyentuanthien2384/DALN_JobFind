// Cloudinary: dich vu luu tru va phan phoi anh/tai lieu qua CDN (avatar, logo cong ty,
// giay phep kinh doanh). May chu chi upload bang API key/secret o bien moi truong; file
// khong nam tren o dia backend nen chay nhieu ban backend van thay cung mot anh.
const cloudinary = require("cloudinary").v2;
require('dotenv').config();
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
});

module.exports = cloudinary;