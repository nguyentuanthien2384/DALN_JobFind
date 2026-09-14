import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PushSettings from "./PushSettings";
import * as push from "./webPush";
jest.mock("./webPush", () => ({
  supported: jest.fn(),
  status: jest.fn(),
  getConfig: jest.fn(),
  enable: jest.fn(),
  disable: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  push.supported.mockReturnValue(true);
  push.status.mockResolvedValue("disabled");
  push.getConfig.mockResolvedValue({ enabled: true, publicKey: "public-key" });
});
test("never asks permission automatically; explicit toggle enables and disables the current device", async () => {
  render(<PushSettings userId={7} />);
  const button = await screen.findByRole("button", { name: "Bật thông báo" });
  expect(push.enable).not.toHaveBeenCalled();
  push.status.mockResolvedValue("enabled");
  fireEvent.click(button);
  await screen.findByRole("button", { name: "Tắt thông báo" });
  expect(push.enable).toHaveBeenCalledWith(7, "public-key");
  push.status.mockResolvedValue("disabled");
  fireEvent.click(screen.getByRole("button", { name: "Tắt thông báo" }));
  await screen.findByRole("button", { name: "Bật thông báo" });
  expect(push.disable).toHaveBeenCalledTimes(1);
});
test.each(["unsupported", "denied"])(
  "explains %s without an unusable permission button",
  async (state) => {
    push.status.mockResolvedValue(state);
    if (state === "unsupported") push.supported.mockReturnValue(false);
    render(<PushSettings userId={7} />);
    await waitFor(() =>
      expect(screen.getByRole("status")).not.toHaveTextContent("Đang kiểm tra"),
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(push.enable).not.toHaveBeenCalled();
  },
);
test("provides retry after configuration failure and keeps a failed enable actionable", async () => {
  push.getConfig.mockRejectedValueOnce(new Error("offline"));
  render(<PushSettings userId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "Kiểm tra lại" }));
  const button = await screen.findByRole("button", { name: "Bật thông báo" });
  push.enable.mockRejectedValueOnce(new Error("Trình duyệt đã chặn thông báo"));
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Trình duyệt đã chặn thông báo",
  );
  expect(button).toBeEnabled();
});
test("shows deployment configuration status without claiming push is available", async () => {
  push.getConfig.mockResolvedValue({ enabled: false });
  render(<PushSettings userId={7} />);
  await screen.findByText("Hệ thống chưa bật dịch vụ thông báo đẩy.");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
test("offers renewal when backend removed a device still present in browser storage", async () => {
  push.status.mockResolvedValue("enabled");
  push.getConfig.mockResolvedValue({
    enabled: true,
    publicKey: "key",
    subscribed: false,
  });
  render(<PushSettings userId={7} />);
  await screen.findByRole("button", { name: "Bật thông báo" });
  expect(
    screen.queryByText("Đã bật trên thiết bị này."),
  ).not.toBeInTheDocument();
});
