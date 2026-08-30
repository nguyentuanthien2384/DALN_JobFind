import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import { ToastContainer } from "react-toastify";
import SystemFooter from "./container/system/Footer";

const mockRootRender = jest.fn();

jest.mock("react-dom/client", () => ({ createRoot: jest.fn() }));
jest.mock("./App", () => ({
    __esModule: true,
    default: function MockApp() {
        return null;
    },
}));
jest.mock("react-toastify", () => ({
    ToastContainer: function MockToastContainer() {
        return null;
    },
}));

describe("frontend bootstrap", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '<div id="root"></div>';
        createRoot.mockReturnValue({ render: mockRootRender });
    });

    it("mounts the application and notification container into the root node", () => {
        require("./index");

        expect(createRoot).toHaveBeenCalledWith(document.getElementById("root"));
        expect(mockRootRender).toHaveBeenCalledTimes(1);
        const strictMode = mockRootRender.mock.calls[0][0];
        expect(strictMode.type).toBe(React.StrictMode);
        const children = React.Children.toArray(strictMode.props.children);
        expect(children[0].type).toBe(App);
        expect(children[1].type).toBe(ToastContainer);
        expect(children[1].props).toEqual(expect.objectContaining({
            position: "top-right",
            autoClose: 4000,
            hideProgressBar: false,
            newestOnTop: false,
            closeOnClick: true,
            pauseOnFocusLoss: true,
            draggable: true,
            pauseOnHover: true,
        }));
    });
});

describe("system footer", () => {
    it("renders ownership and social destinations", () => {
        document.body.innerHTML = renderToStaticMarkup(<SystemFooter />);

        expect(document.body.textContent).toContain("Bản quyền");
        expect(document.body.textContent).toContain("Thiền NT");
        expect(document.querySelector('a[href="https://www.facebook.com/ahitvzed/"]')).toBeTruthy();
        expect(document.querySelectorAll(".footer-social a")).toHaveLength(4);
    });
});
