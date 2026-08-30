import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import {
    createPackageCv,
    createPackagePost,
    getAllPackage,
    getAllPackageCv,
    getAllToSelect,
    getPackageById,
    getPackageByIdCv,
    getPackageByType,
    getPaymentLink,
    getPaymentLinkCv,
    paymentOrderSuccessService,
    paymentOrderSuccessServiceCv,
    setActiveTypePackage,
    setActiveTypePackageCv,
    updatePackageCv,
    updatePackagePost,
} from "../../service/userService";
import ManagePackagePost from "./PackagePost/ManagePackagePost";
import ManagePackageCv from "./PackageCv/ManagePackageCv";
import AddPackagePost from "./PackagePost/AddPackagePost";
import AddPackageCv from "./PackageCv/AddPackageCv";
import BuyPost from "./Post/BuyPost";
import BuyCv from "./PackageCv/BuyCv";
import BuySuccess from "./Post/BuySucces";
import BuySuccessCv from "./PackageCv/BuySuccesCv";

let mockParams = {};
let mockSearch = "";
const mockNavigate = jest.fn();

jest.mock("xlsx/xlsx.mjs", () => ({
    utils: { book_new: jest.fn(), json_to_sheet: jest.fn(), book_append_sheet: jest.fn() },
    writeFile: jest.fn(),
}));
jest.mock("react-router-dom", () => ({
    Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
    useLocation: () => ({ search: mockSearch }),
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
}));
jest.mock("../../service/userService", () => ({
    createPackageCv: jest.fn(),
    createPackagePost: jest.fn(),
    getAllPackage: jest.fn(),
    getAllPackageCv: jest.fn(),
    getAllToSelect: jest.fn(),
    getPackageById: jest.fn(),
    getPackageByIdCv: jest.fn(),
    getPackageByType: jest.fn(),
    getPaymentLink: jest.fn(),
    getPaymentLinkCv: jest.fn(),
    paymentOrderSuccessService: jest.fn(),
    paymentOrderSuccessServiceCv: jest.fn(),
    setActiveTypePackage: jest.fn(),
    setActiveTypePackageCv: jest.fn(),
    updatePackageCv: jest.fn(),
    updatePackagePost: jest.fn(),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="next-page" onClick={() => props.onPageChange({ selected: 2 })}>page</button>
));
jest.mock("reactstrap", () => ({
    Modal: ({ children, isOpen }) => isOpen ? <div data-testid="loading">{children}</div> : null,
    Spinner: () => <span>loading</span>,
}));
jest.mock("antd", () => {
    const React = require("react");
    const Search = ({ onSearch, placeholder }) => {
        const [value, setValue] = React.useState("");
        return <div>
            <input aria-label={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
            <button type="button" onClick={() => onSearch(value)}>Tìm kiếm</button>
        </div>;
    };
    return { Input: { Search } };
});

const packageManagers = [
    {
        label: "post",
        Component: ManagePackagePost,
        getAll: getAllPackage,
        setActive: setActiveTypePackage,
        placeholder: "Nhập tên gói bài đăng",
        item: { id: 11, name: "Gói bài nổi bật", value: 3, price: 9, isHot: 1, isActive: 1 },
        editHref: "/admin/edit-package-post/11/",
    },
    {
        label: "CV",
        Component: ManagePackageCv,
        getAll: getAllPackageCv,
        setActive: setActiveTypePackageCv,
        placeholder: "Nhập tên gói",
        item: { id: 12, name: "Gói xem CV", value: 8, price: 12, isActive: 1 },
        editHref: "/admin/edit-package-cv/12/",
    },
];

describe("package management", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParams = {};
        mockSearch = "";
    });

    it.each(packageManagers)("manages the $label package list with normalized search, paging and activation", async (config) => {
        config.getAll.mockResolvedValue({ errCode: 0, count: 13, data: [config.item] });
        config.setActive.mockResolvedValue({ errCode: 0, errMessage: "Đã cập nhật" });

        render(<config.Component />);
        expect(await screen.findByText(config.item.name)).toBeInTheDocument();
        expect(screen.getByText("Sửa")).toHaveAttribute("href", config.editHref);

        fireEvent.change(screen.getByLabelText(config.placeholder), { target: { value: "  Gói   tốt  " } });
        fireEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));
        await waitFor(() => expect(config.getAll).toHaveBeenLastCalledWith({ limit: 5, offset: 0, search: "Gói tốt" }));

        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(config.getAll).toHaveBeenLastCalledWith({ limit: 5, offset: 10, search: "Gói tốt" }));

        fireEvent.click(screen.getByText("Dừng kinh doanh"));
        await waitFor(() => expect(config.setActive).toHaveBeenCalledWith({ id: config.item.id, isActive: 0 }));
        expect(toast.success).toHaveBeenCalledWith("Đã cập nhật");
    });
});

const packageEditors = [
    {
        label: "post",
        Component: AddPackagePost,
        create: createPackagePost,
        update: updatePackagePost,
        detail: getPackageById,
        createExpected: { value: "5", isHot: "1", name: "Starter", price: "7" },
        updateExpected: { value: 9, isHot: 0, name: "Updated", price: 15, id: "44" },
    },
    {
        label: "CV",
        Component: AddPackageCv,
        create: createPackageCv,
        update: updatePackageCv,
        detail: getPackageByIdCv,
        createExpected: { value: "5", name: "Starter", price: "7" },
        updateExpected: { value: 9, name: "Updated", price: 15, id: "44" },
    },
];

describe("package editors", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockParams = {};
        packageEditors.forEach(({ create, update }) => {
            create.mockResolvedValue({ errCode: 0, errMessage: "Đã tạo" });
            update.mockResolvedValue({ errCode: 0, errMessage: "Đã sửa" });
        });
    });

    afterEach(() => {
        act(() => jest.runOnlyPendingTimers());
        jest.useRealTimers();
    });

    it.each(packageEditors)("creates a $label package from the form", async (config) => {
        const { container } = render(<config.Component />);
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Starter" } });
        fireEvent.change(container.querySelector('input[name="value"]'), { target: { name: "value", value: "5" } });
        fireEvent.change(container.querySelector('input[name="price"]'), { target: { name: "price", value: "7" } });
        const hot = container.querySelector('select[name="isHot"]');
        if (hot) fireEvent.change(hot, { target: { name: "isHot", value: "1" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

        await act(async () => Promise.resolve());
        expect(config.create).toHaveBeenCalledWith(config.createExpected);
        act(() => jest.advanceTimersByTime(1000));
        expect(toast.success).toHaveBeenCalledWith("Đã tạo");
        expect(container.querySelector('input[name="name"]')).toHaveValue("");
    });

    it.each(packageEditors)("loads and updates a $label package", async (config) => {
        mockParams = { id: "44" };
        config.detail.mockResolvedValue({ errCode: 0, data: { id: 44, name: "Old", value: 9, price: 15 } });
        const { container } = render(<config.Component />);
        await act(async () => Promise.resolve());
        expect(config.detail).toHaveBeenCalledWith("44");
        expect(container.querySelector('input[name="name"]')).toHaveValue("Old");
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Updated" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await act(async () => Promise.resolve());
        expect(config.update).toHaveBeenCalledWith(config.updateExpected);
        act(() => jest.advanceTimersByTime(500));
        expect(toast.success).toHaveBeenCalledWith("Đã sửa");
    });
});

const buyers = [
    { label: "post", Component: BuyPost, list: getPackageByType, payment: getPaymentLink, heading: "Mua lượt đăng bài viết" },
    { label: "CV", Component: BuyCv, list: getAllToSelect, payment: getPaymentLinkCv, heading: "Mua lượt tìm ứng viên" },
];

describe("package purchases", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        localStorage.setItem("userData", JSON.stringify({ id: 77 }));
    });

    it.each(buyers)("calculates a $label order and exposes a payment failure", async (config) => {
        config.list.mockResolvedValue({ errCode: 0, data: [
            { id: 1, name: "Basic", price: 4 },
            { id: 2, name: "Plus", price: 7 },
        ] });
        config.payment.mockResolvedValue({ errCode: 1, errMessage: "Thanh toán lỗi" });
        const { container } = render(<config.Component />);
        expect(await screen.findByText(config.heading)).toBeInTheDocument();
        await screen.findByText("Basic");
        fireEvent.change(container.querySelector('select[name="addressCode"]'), { target: { value: "2" } });
        fireEvent.change(container.querySelector('input[type="number"]'), { target: { value: "3" } });
        expect(screen.getByText("21 USD")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Mua" }));
        await waitFor(() => expect(config.payment).toHaveBeenCalledWith(2, "3"));
        expect(toast.error).toHaveBeenCalledWith("Thanh toán lỗi");
        await waitFor(() => expect(screen.queryByTestId("loading")).not.toBeInTheDocument());
    });

    it.each(buyers)("shows a safe empty state when no active $label package exists", async (config) => {
        config.list.mockResolvedValue({ errCode: 0, data: [] });
        const { container } = render(<config.Component />);

        expect(await screen.findByRole("status")).toHaveTextContent("Hiện chưa có gói");
        expect(container.querySelector('select[name="addressCode"]')).toBeDisabled();
        expect(screen.getByRole("button", { name: "Mua" })).toBeDisabled();
        expect(config.payment).not.toHaveBeenCalled();
    });
});

const successPages = [
    {
        label: "post",
        Component: BuySuccess,
        storageKey: "orderData",
        service: paymentOrderSuccessService,
        message: "Chúc mừng bạn đã mua lượt đăng bài thành công",
        action: "Đăng bài ngay",
        destination: "/admin/add-post",
    },
    {
        label: "CV",
        Component: BuySuccessCv,
        storageKey: "orderCvData",
        service: paymentOrderSuccessServiceCv,
        message: "Chúc mừng bạn đã mua lượt tìm ứng viên thành công",
        action: "Tìm ứng viên ngay",
        destination: "/admin/list-candiate",
    },
];

describe("payment callbacks", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockSearch = "?paymentId=PAY-1&token=TOKEN-2&PayerID=PAYER-3";
    });

    it.each(successPages)("finalizes a $label order, clears it and navigates to the next action", async (config) => {
        localStorage.setItem(config.storageKey, JSON.stringify({ amount: 2, userId: 77 }));
        config.service.mockResolvedValue({ errCode: 0, errMessage: "Thành công" });
        render(<config.Component />);
        await waitFor(() => expect(config.service).toHaveBeenCalledWith({
            amount: 2,
            userId: 77,
            paymentId: "PAY-1",
            token: "TOKEN-2",
            PayerID: "PAYER-3",
        }));
        expect(await screen.findByText(config.message)).toBeInTheDocument();
        expect(localStorage.getItem(config.storageKey)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: config.action }));
        expect(mockNavigate).toHaveBeenCalledWith(config.destination);
    });

    it.each(successPages)("rejects a $label callback without a stored order", async (config) => {
        render(<config.Component />);
        expect(await screen.findByText("Thông tin đơn hàng không hợp lệ")).toBeInTheDocument();
        expect(config.service).not.toHaveBeenCalled();
    });
});
