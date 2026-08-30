import JWT from 'jsonwebtoken'
require('dotenv').config();
const PDFExtract = require('pdf.js-extract').PDFExtract;
const pdfExtract = new PDFExtract();
const keywordExtractor = require("keyword-extractor");
// roleCode va companyId duoc nhung vao token de API Gateway cua he thong
// microservice phan quyen ngay tai cua ngo, khong phai truy CSDL moi request.
// Backend nay chi doc `sub` nen them truong moi khong anh huong gi; token cu
// van dung binh thuong cho toi khi het han.
let encodeToken = (userId, roleCode = null, companyId = null) =>{
    return JWT.sign({
        iss: 'Tai Nguyen',
        sub: userId,
        roleCode: roleCode,
        companyId: companyId,
        iat: new Date().getTime(),
        exp: new Date().setDate(new Date().getDate() +3)
    },process.env.JWT_SECRET
)
}

let pdfToString = async(file) => {
    file = Buffer.from(file, 'base64').toString('binary');
    let buffer = Buffer.from(file.split(",")[1], 'base64');
    const options = {}
    let pdfData = null
    await pdfExtract.extractBuffer(buffer, options)
    .then(data => pdfData = data)
    .catch(err=> console.log(err));
    return pdfData
}
let getAllKeyWords = (text) => {
    let options = {
        language: "english",
        remove_digits: true,
        return_changed_case: true,
        remove_duplicates: true
    }
    let listKeyWord = keywordExtractor.extract(text,options)
    let mapListKeyWord = new Map()
    for(let i =0;i<listKeyWord.length;i++) {
        mapListKeyWord.set(i,listKeyWord[i])
    }
    return mapListKeyWord
}

let flatAllString= (string) => {
    let output = string.toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
      output = output.replace(/[đĐ]/g, (m) =>
      m === "đ" ? "d" : "D"
    );
    output= output.replace(/[^a-zA-Z]/g, "")
    return output;
}

module.exports = {
    encodeToken:encodeToken,
    pdfToString:pdfToString,
    getAllKeyWords: getAllKeyWords,
    flatAllString: flatAllString,
}
