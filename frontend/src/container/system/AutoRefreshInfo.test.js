import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AutoRefreshInfo from "./AutoRefreshInfo";

describe("AutoRefreshInfo", () => {
    it("shows the last refresh time and invokes manual refresh", () => {
        const onRefresh = jest.fn();
        render(<AutoRefreshInfo capNhatLuc={new Date(2026, 7, 29, 14, 5, 6)} dangTai={false} onLamMoi={onRefresh} />);
        expect(screen.getByText(/14:05:06/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Làm mới" }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("disables the button and animates while loading", () => {
        render(<AutoRefreshInfo capNhatLuc={null} dangTai onLamMoi={jest.fn()} />);
        expect(screen.getByRole("button", { name: "Đang tải..." })).toBeDisabled();
        expect(screen.getByTitle("Đang tải")).toHaveClass("dang-quay");
        expect(screen.queryByText(/lúc/)).not.toBeInTheDocument();
    });
});
