import axios from 'axios';
const url = process.env.REACT_APP_BACKEND_URL || "http://localhost:4000"


const instance = axios.create({
    baseURL: url,
    //  withCredentials: true
});
instance.interceptors.request.use(
    config =>{
        const token = localStorage.getItem("token_user")
        if(token){
            config.headers.authorization = "Bearer " + token
        }
        return config
    },
    error =>{
        return Promise.reject(error)
    }
);
// instance.interceptors.response.use(
//     (res) => {
//       return res;
//     },
//     async (err) => {
//       const originalConfig = err.config;
//       if (originalConfig.url !== "/login" && err.response) {
      
//         // Access Token was expired
//         if (err.response.status === 500 &&err.response.data.message.includes("expired") && !originalConfig._retry) {
//           originalConfig._retry = true;
//           try {
//             let refreshtoken = localStorage.getItem("refreshtoken")
//             localStorage.setItem("token",refreshtoken)
//             return instance(originalConfig);
//           } catch (_error) {
//             return Promise.reject(_error);
//           }
//         }
//       }
//       return Promise.reject(err);
//     }
//   );





instance.interceptors.response.use(
    (response) => {
        // Thrown error for request with OK status code
        return response.data
    },
    (error) => {
        // Khong co nhanh xu ly loi thi moi response 4xx/5xx deu tra ve promise bi reject,
        // trong khi cac component chi lam `let res = await getX(); if (res.errCode === 0)`
        // -> component vang ra loi va man hinh trang. Chuan hoa loi ve dung dang
        // { errCode, errMessage } de nhanh else cua component hien thong bao binh thuong.
        const res = error.response

        if (!res) {
            return {
                errCode: -1,
                errMessage: 'Không kết nối được máy chủ. Vui lòng kiểm tra lại backend.'
            }
        }

        const data = res.data || {}

        // Backend gui kem refresh: true khi token het han / khong hop le.
        // Xoa phien dang nhap va dua ve trang login, tru khi dang o san trang login.
        if (data.refresh === true && window.location.pathname !== '/login') {
            localStorage.removeItem('userData')
            localStorage.removeItem('token_user')
            localStorage.setItem('lastUrl', window.location.href)
            window.location.href = '/login'
        }

        return {
            errCode: data.errCode !== undefined ? data.errCode : -1,
            errMessage: data.errMessage || data.message || `Lỗi máy chủ (${res.status})`
        }
    }
);

export default instance;
