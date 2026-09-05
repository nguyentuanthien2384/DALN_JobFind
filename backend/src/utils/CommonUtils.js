import JWT from 'jsonwebtoken'
import { getJwtSecret, getJwtSignOptions } from './securityConfig';
require('dotenv').config();
const PDFExtract = require('pdf.js-extract').PDFExtract;
const pdfExtract = new PDFExtract();
const keywordExtractor = require("keyword-extractor");
// Role/company claims are hints only; authorization rereads the current account.
let encodeToken = (userId, roleCode = null, companyId = null) =>{
    return JWT.sign({
        sub: userId,
        roleCode: roleCode,
        companyId: companyId
    }, getJwtSecret(), getJwtSignOptions())
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
