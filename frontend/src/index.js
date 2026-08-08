import React from "react";
import { createRoot } from "react-dom/client";
import "./css/App.css";
import App from "./App";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "react-datepicker/dist/react-datepicker.css";

const root = createRoot(document.getElementById("root"));

root.render(
    <React.StrictMode>
        <App />
        <ToastContainer
            position="top-right"
            autoClose={4000}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
        />
    </React.StrictMode>
);
