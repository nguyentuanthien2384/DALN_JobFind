import express from "express";
import http from "http";
import bodyParser from "body-parser";
import viewEngine from "./config/viewEngine";
import initwebRoutes from "./routes/web";
import connectDB from "./config/connectDB";
import {sendJobMail,updateFreeViewCv} from "./utils/schedule"
import { initSocket } from "./config/socket";
require('dotenv').config();

let app = express();

app.use(function (req, res, next) {
    // URL_REACT co the chua nhieu origin, cach nhau boi dau phay. Dieu nay cho
    // phep frontend chay o cong 3001 khi cong 3000 dang duoc API Gateway su dung.
    const allowedOrigins = (process.env.URL_REACT || 'http://localhost:3000,http://localhost:3001')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const requestOrigin = req.headers.origin;

    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
    }

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Tra loi preflight ngay tai day de cac request POST/PUT co JSON khong bi
    // chan boi trinh duyet.
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

app.use(bodyParser.json({ limit: '50mb' }))
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))
sendJobMail();
updateFreeViewCv()
viewEngine(app);
initwebRoutes(app);

connectDB();

let port = process.env.PORT || 5000;

// Boc app Express vao http server de Socket.IO dung chung cong 5000 voi API REST.
let server = http.createServer(app);
initSocket(server);

server.listen(port, () => {
    console.log("Backend Nodejs is running on the port : " + port)
});
