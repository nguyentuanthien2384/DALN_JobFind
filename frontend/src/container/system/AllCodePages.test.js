import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { Modal as AntModal } from "antd";
import { PAGINATION } from "../../util/constant";
import {
    createAllCodeService,
    createSkilleService,
    DeleteAllcodeService,
    DeleteSkillService,
    getDetailAllcodeByCode,
    getDetailSkillById,
    getListAllCodeService,
    getListSkill,
    UpdateAllcodeService,
    UpdateSkillService,
} from "../../service/userService";
import AddExpType from "./ExpType/AddExpType";
import ManageExpType from "./ExpType/ManageExpType";
import AddJobLevel from "./JobLevel/AddJobLevel";
import ManageJobLevel from "./JobLevel/ManageJobLevel";
import AddJobType from "./JobType/AddJobType";
import ManageJobType from "./JobType/ManageJobType";
import AddSalaryType from "./SalaryType/AddSalaryType";
import ManageSalaryType from "./SalaryType/ManageSalaryType";
import AddWorkType from "./WorkType/AddWorkType";
import ManageWorkType from "./WorkType/ManageWorkType";
import AddJobSkill from "./JobSkill/AddJobSkill";
import ManageJobSkill from "./JobSkill/ManageJobSkill";

let mockParams = {};
const mockNavigate = jest.fn();

jest.mock("xlsx/xlsx.mjs", () => ({
    utils: { book_new: jest.fn(), json_to_sheet: jest.fn(), book_append_sheet: jest.fn() },
    writeFile: jest.fn(),
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
        useNavigate: () => mockNavigate,
        useParams: () => mockParams,
    };
});
jest.mock("../../service/userService", () => ({
    createAllCodeService: jest.fn(),
    createSkilleService: jest.fn(),
    DeleteAllcodeService: jest.fn(),
    DeleteSkillService: jest.fn(),
    getDetailAllcodeByCode: jest.fn(),
    getDetailSkillById: jest.fn(),
    getListAllCodeService: jest.fn(),
    getListSkill: jest.fn(),
    UpdateAllcodeService: jest.fn(),
    UpdateSkillService: jest.fn(),
}));
jest.mock("../../util/fetch", () => ({
    useFetchAllcode: () => ({ data: [
        { code: "DEV", value: "Phát triển phần mềm" },
        { code: "OPS", value: "Vận hành" },
    ] }),
}));
jest.mock("react-toastify", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-paginate", () => (props) => (
    <button type="button" data-testid="next-page" onClick={() => props.onPageChange({ selected: 2 })}>page</button>
));
jest.mock("react-image-lightbox", () => (props) => (
    <button type="button" data-testid="lightbox" onClick={props.onCloseRequest}>{props.mainSrc}</button>
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
            <input aria-label={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
            <button type="button" onClick={() => onSearch(value)}>Tìm kiếm</button>
        </div>;
    };
    const Select = ({ options = [], onChange, value, defaultValue }) => (
        <select
            aria-label="select-filter"
            value={value && typeof value === "object" ? value.value : (value ?? (defaultValue && defaultValue.value) ?? defaultValue ?? "")}
            onChange={(e) => onChange(e.target.value)}
        >
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    );
    return {
        Input: { Search },
        Modal: { confirm: jest.fn((options) => options.onOk()) },
        Row: ({ children }) => <div>{children}</div>,
        Col: ({ children }) => <div>{children}</div>,
        Select,
    };
});
jest.mock("@ant-design/icons", () => ({ ExclamationCircleOutlined: () => null }));

const allCodeManagers = [
    ["JOBTYPE", ManageJobType],
    ["JOBLEVEL", ManageJobLevel],
    ["WORKTYPE", ManageWorkType],
    ["SALARYTYPE", ManageSalaryType],
    ["EXPTYPE", ManageExpType],
];

const allCodeEditors = [
    ["JOBLEVEL", AddJobLevel],
    ["WORKTYPE", AddWorkType],
    ["SALARYTYPE", AddSalaryType],
    ["EXPTYPE", AddExpType],
];

describe("reusable all-code management pages", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        AntModal.confirm.mockImplementation((options) => options.onOk());
        mockParams = {};
        getListAllCodeService.mockImplementation(async ({ type }) => ({
            errCode: 0,
            count: 21,
            data: [{ code: `${type}_1`, value: `${type} item`, image: "/type.png" }],
        }));
        DeleteAllcodeService.mockResolvedValue({ errCode: 0, errMessage: "Đã xóa" });
    });

    it.each(allCodeManagers)("%s list searches, paginates and deletes using the current filters", async (type, Component) => {
        render(<Component />);
        expect(await screen.findByText(`${type} item`)).toBeInTheDocument();
        expect(getListAllCodeService).toHaveBeenCalledWith({
            type,
            limit: PAGINATION.pagerow,
            offset: 0,
            search: "",
        });

        const search = screen.getByRole("textbox");
        fireEvent.change(search, { target: { value: "  senior   engineer  " } });
        fireEvent.click(screen.getByRole("button", { name: "Tìm kiếm" }));
        await waitFor(() => expect(getListAllCodeService).toHaveBeenLastCalledWith(expect.objectContaining({
            type,
            search: "senior engineer",
            offset: 0,
        })));

        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getListAllCodeService).toHaveBeenLastCalledWith(expect.objectContaining({
            type,
            offset: 2 * PAGINATION.pagerow,
            search: "senior engineer",
        })));

        fireEvent.click(screen.getByText("Xóa"));
        await waitFor(() => expect(DeleteAllcodeService).toHaveBeenCalledWith(`${type}_1`));
        expect(toast.success).toHaveBeenCalledWith("Đã xóa");
    });

    it("opens and closes the job-type image preview", async () => {
        const { container } = render(<ManageJobType />);
        await screen.findByText("JOBTYPE item");
        fireEvent.click(container.querySelector(".box-img-preview"));
        expect(screen.getByTestId("lightbox")).toHaveTextContent("/type.png");
        fireEvent.click(screen.getByTestId("lightbox"));
        expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument();
    });
});

describe("reusable all-code editor pages", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParams = {};
        createAllCodeService.mockResolvedValue({ errCode: 0 });
        UpdateAllcodeService.mockResolvedValue({ errCode: 0 });
        getDetailAllcodeByCode.mockResolvedValue({
            errCode: 0,
            data: { value: "Giá trị cũ", code: "OLD" },
        });
    });

    it.each(allCodeEditors)("creates %s with a normalized generated code and clears the form", async (type, Component) => {
        const { container } = render(<Component />);
        const valueInput = container.querySelector('input[name="value"]');
        const codeInput = container.querySelector('input[name="code"]');
        fireEvent.change(valueInput, { target: { name: "value", value: "  Kỹ   Sư  " } });
        await waitFor(() => expect(valueInput).toHaveValue("Kỹ Sư"));
        expect(codeInput).toHaveValue("ky-su");
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

        await waitFor(() => expect(createAllCodeService).toHaveBeenCalledWith({
            value: "Kỹ Sư",
            code: "ky-su",
            type,
        }));
        await waitFor(() => expect(valueInput).toHaveValue(""));
        expect(toast.success).toHaveBeenCalled();
    });

    it.each(allCodeEditors)("updates %s without regenerating its stable code", async (type, Component) => {
        mockParams = { id: "OLD" };
        const { container } = render(<Component />);
        expect(await screen.findByText(/Cập nhật/)).toBeInTheDocument();
        const valueInput = container.querySelector('input[name="value"]');
        await waitFor(() => expect(valueInput).toHaveValue("Giá trị cũ"));
        fireEvent.change(valueInput, { target: { name: "value", value: "Giá trị mới" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(UpdateAllcodeService).toHaveBeenCalledWith({ value: "Giá trị mới", code: "OLD" }));
        expect(createAllCodeService).not.toHaveBeenCalled();
    });

    it("creates and updates a job type including its image field", async () => {
        const { container, unmount } = render(<AddJobType />);
        fireEvent.change(container.querySelector('input[name="value"]'), {
            target: { name: "value", value: "Công nghệ" },
        });
        await waitFor(() => expect(container.querySelector('input[name="code"]')).toHaveValue("cong-nghe"));
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(createAllCodeService).toHaveBeenCalledWith({
            value: "Công nghệ", code: "cong-nghe", type: "JOBTYPE", image: "",
        }));
        unmount();

        mockParams = { code: "TECH" };
        getDetailAllcodeByCode.mockResolvedValue({
            errCode: 0,
            data: { value: "Công nghệ cũ", code: "TECH", image: "/old.png" },
        });
        const edited = render(<AddJobType />);
        await screen.findByText("Cập nhật loại công việc");
        const editedValue = edited.container.querySelector('input[name="value"]');
        await waitFor(() => expect(editedValue).toHaveValue("Công nghệ cũ"));
        fireEvent.change(editedValue, {
            target: { name: "value", value: "Công nghệ mới" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(UpdateAllcodeService).toHaveBeenCalledWith({
            value: "Công nghệ mới", code: "TECH", image: "/old.png",
        }));
    });
});

describe("job-skill management", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        AntModal.confirm.mockImplementation((options) => options.onOk());
        mockParams = {};
        getListSkill.mockResolvedValue({
            errCode: 0,
            count: 12,
            data: [{ id: 4, name: "React", categoryJobCode: "DEV", jobTypeSkillData: { value: "Phát triển phần mềm" } }],
        });
        DeleteSkillService.mockResolvedValue({ errCode: 0, errMessage: "Đã xóa kỹ năng" });
        createSkilleService.mockResolvedValue({ errCode: 0 });
        UpdateSkillService.mockResolvedValue({ errCode: 0 });
        getDetailSkillById.mockResolvedValue({
            errCode: 0,
            data: { id: 4, name: "React", categoryJobCode: "DEV" },
        });
    });

    it("filters skills by category, pages and refreshes after deletion", async () => {
        render(<ManageJobSkill />);
        expect(await screen.findByText("React")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("select-filter"), { target: { value: "DEV" } });
        await waitFor(() => expect(getListSkill).toHaveBeenLastCalledWith(expect.objectContaining({ categoryJobCode: "DEV" })));
        fireEvent.click(screen.getByTestId("next-page"));
        await waitFor(() => expect(getListSkill).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2 * PAGINATION.pagerow })));
        fireEvent.click(screen.getByText("Xóa"));
        await waitFor(() => expect(DeleteSkillService).toHaveBeenCalledWith(4));
        expect(toast.success).toHaveBeenCalledWith("Đã xóa kỹ năng");
    });

    it("creates a skill with the selected job category", async () => {
        const { container } = render(<AddJobSkill />);
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "Node.js" } });
        fireEvent.change(screen.getByLabelText("select-filter"), { target: { value: "OPS" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(createSkilleService).toHaveBeenCalledWith({ name: "Node.js", categoryJobCode: "OPS" }));
    });

    it("loads and updates an existing skill", async () => {
        mockParams = { code: "4" };
        const { container } = render(<AddJobSkill />);
        await waitFor(() => expect(container.querySelector('input[name="name"]')).toHaveValue("React"));
        fireEvent.change(container.querySelector('input[name="name"]'), { target: { name: "name", value: "React nâng cao" } });
        fireEvent.change(screen.getByLabelText("select-filter"), { target: { value: "OPS" } });
        fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
        await waitFor(() => expect(UpdateSkillService).toHaveBeenCalledWith({
            name: "React nâng cao", id: "4", categoryJobCode: "OPS",
        }));
    });
});
