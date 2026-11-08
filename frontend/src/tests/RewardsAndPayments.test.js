import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import PointTopupModal from '../components/payment/PointTopupModal';
import OrderConfirmModal from '../components/payment/OrderConfirmModal';
import JobCompetitionSection from '../components/rewards/JobCompetitionSection';
import CandidateWalletCard from '../components/rewards/CandidateWalletCard';
import EmployerRewardsSection from '../container/system/Rewards/EmployerRewardsSection';
import RewardsWorkspace from '../container/system/Rewards/RewardsWorkspace';
import PaymentResultPage from '../container/Payment/PaymentResultPage';
import * as rewardPaymentService from '../service/rewardPaymentService';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});

jest.mock('react-toastify', () => ({
    toast: {
        success: jest.fn(),
        error: jest.fn(),
        warning: jest.fn(),
        info: jest.fn(),
    },
}));

jest.mock('../service/rewardPaymentService', () => {
    const actual = jest.requireActual('../service/rewardPaymentService');
    return {
        ...actual,
        getCandidateRewardOverviewService: jest.fn(),
        claimCandidateDailyCheckinService: jest.fn(),
        claimCandidateProfileCompletionService: jest.fn(),
        getJobCompetitionReportService: jest.fn(),
        unlockJobCompetitionReportService: jest.fn(),
        getEmployerRewardOverviewService: jest.fn(),
        getAdminRewardsOverviewService: jest.fn(),
        redeemEmployerPointsService: jest.fn(),
        createPaymentCheckoutService: jest.fn(),
        verifyPaymentReturnService: jest.fn(),
    };
});

describe('Rewards & Multi-Gateway Payments UI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.setItem(
            'userData',
            JSON.stringify({ id: 77, roleCode: 'CANDIDATE', firstName: 'An', lastName: 'Nguyen' })
        );
    });

    afterEach(() => {
        localStorage.clear();
    });

    test('renders PointTopupModal with 4 payment methods (VNPAY, MoMo, ZaloPay, PayPal), promo codes, history tab, and creates checkout', async () => {
        rewardPaymentService.getCandidateRewardOverviewService.mockResolvedValue({
            errCode: 0,
            data: {
                wallet: {
                    balancePoints: 45,
                    balanceXu: 45000,
                    tierLabel: 'Hạng Bạc (Silver Member)',
                },
                topupPackages: rewardPaymentService.DEFAULT_CANDIDATE_TOPUP_PACKAGES,
                transactions: [
                    {
                        id: 1,
                        description: 'Nộp CV nhận +5 Điểm',
                        pointsDelta: 5,
                        balanceAfter: 45,
                        createdAt: new Date().toISOString(),
                    },
                ],
            },
        });
        rewardPaymentService.createPaymentCheckoutService.mockResolvedValue({
            errCode: 0,
            data: {
                orderCode: 'JF261106TEST',
                provider: 'MOMO',
                paymentUrl: 'http://localhost:3000/payment/result?simulate=1&provider=MOMO&order=JF261106TEST',
            },
        });

        render(<PointTopupModal isOpen onClose={jest.fn()} postId={123} />);

        expect(await screen.findByText('Nạp điểm tài khoản')).toBeInTheDocument();
        expect(screen.getByText('Cổng thanh toán VNPAY')).toBeInTheDocument();
        expect(screen.getByText('Ví điện tử MoMo')).toBeInTheDocument();
        expect(screen.getByText('Ví điện tử ZaloPay')).toBeInTheDocument();
        expect(screen.getByText('PayPal / Thẻ Quốc Tế')).toBeInTheDocument();

        // Promo code starts empty (not pre-filled)
        const promoInput = screen.getByPlaceholderText(/Nhập mã giảm giá/i);
        expect(promoInput).toHaveValue('');

        // Switch packages and apply promo code
        fireEvent.click(screen.getByText(/Gói Nâng Cao/i));
        fireEvent.change(promoInput, { target: { value: 'JOBFIND10K' } });
        fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

        // Switch to history tab and back
        fireEvent.click(screen.getByRole('button', { name: 'Lịch sử dùng điểm' }));
        expect(await screen.findByText('Nộp CV nhận +5 Điểm')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Chuyển sang Nạp điểm/i }));

        // Step 1 -> Step 2 order confirmation before initiating checkout
        fireEvent.click(screen.getByText('Ví điện tử MoMo'));
        fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
        expect(rewardPaymentService.createPaymentCheckoutService).not.toHaveBeenCalled();
        expect(screen.getByText('Phương thức thanh toán:')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thanh toán' }));

        await waitFor(() => {
            expect(rewardPaymentService.createPaymentCheckoutService).toHaveBeenCalledWith(
                expect.objectContaining({
                    purpose: 'POINT_TOPUP',
                    itemCode: 'PRO',
                    provider: 'MOMO',
                    promoCode: 'JOBFIND10K',
                    postId: 123,
                })
            );
        });
    });

    test('renders CandidateWalletCard and claims daily check-in and profile completion bonus', async () => {
        rewardPaymentService.getCandidateRewardOverviewService.mockResolvedValue({
            errCode: 0,
            data: {
                wallet: {
                    balancePoints: 50,
                    balanceXu: 50000,
                    tierShortLabel: 'Hạng Bạc',
                },
                missions: {
                    checkedInToday: false,
                    profileCompletionClaimed: false,
                },
            },
        });
        rewardPaymentService.claimCandidateDailyCheckinService.mockResolvedValue({
            errCode: 0,
            errMessage: 'Điểm danh thành công (+1 điểm).',
        });
        rewardPaymentService.claimCandidateProfileCompletionService.mockResolvedValue({
            errCode: 0,
            errMessage: 'Đã nhận +20 điểm hoàn thiện hồ sơ.',
        });

        const onOpenTopup = jest.fn();
        render(<CandidateWalletCard onOpenTopup={onOpenTopup} />);

        expect(await screen.findByText('50.000 VNĐ')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Điểm danh' }));
        fireEvent.click(screen.getByRole('button', { name: 'Nhận +20' }));

        await waitFor(() => {
            expect(rewardPaymentService.claimCandidateDailyCheckinService).toHaveBeenCalled();
            expect(rewardPaymentService.claimCandidateProfileCompletionService).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Nạp điểm' }));
        expect(onOpenTopup).toHaveBeenCalledWith('topup');
        fireEvent.click(screen.getByRole('button', { name: 'Lịch sử điểm' }));
        expect(onOpenTopup).toHaveBeenCalledWith('history');
    });

    test('renders JobCompetitionSection locked without fake numbers and unlocks real DB metrics', async () => {
        rewardPaymentService.getJobCompetitionReportService.mockResolvedValue({
            errCode: 0,
            data: {
                unlocked: false,
                unlockCostPoints: 10,
                unlockTtlDays: 30,
                walletBalancePoints: 45,
                totalApplicants: 34,
                todayApplicants: 5,
                hiringTarget: 2,
                competitionRatio: '1 : 17',
                expectedSalaryAvgMillion: null,
                expectedSalaryRangeLabel: null,
                profileMatchPercent: null,
                profileRankLabel: null,
                experienceBreakdown: null,
                applicantTopSkills: null,
                aiCorrelation: null,
            },
        });

        rewardPaymentService.unlockJobCompetitionReportService.mockResolvedValue({
            errCode: 0,
            errMessage: 'Đã mở khóa thống kê chi tiết.',
            data: {
                report: {
                    unlocked: true,
                    unlockCostPoints: 10,
                    unlockTtlDays: 30,
                    walletBalancePoints: 35,
                    totalApplicants: 34,
                    todayApplicants: 5,
                    hiringTarget: 2,
                    competitionRatio: '1 : 17',
                    expectedSalaryAvgMillion: 24.5,
                    expectedSalaryRangeLabel: 'Từ 34 hồ sơ: 15 - 30 triệu',
                    profileMatchPercent: 91,
                    profileRankLabel: 'Xếp hạng #2/34 hồ sơ đã nộp',
                    experienceBreakdown: [
                        { key: 'under3', label: 'Dưới 3 năm kinh nghiệm', percent: 21, count: 7 },
                        { key: 'threeToFive', label: '3 - 5 năm kinh nghiệm', percent: 56, count: 19, isUserGroup: true, highlight: true },
                        { key: 'over5', label: 'Trên 5 năm kinh nghiệm', percent: 24, count: 8 },
                    ],
                    applicantTopSkills: [
                        { skillId: 1, name: 'React', count: 22 },
                        { skillId: 2, name: 'TypeScript', count: 15 },
                    ],
                    aiCorrelation: [
                        { label: 'Kỹ năng theo tin đăng (React, TypeScript)', status: 'Khớp 2/2 (100%)', tone: 'emerald' },
                        { label: 'Kinh nghiệm yêu cầu (3 năm)', status: 'Đạt (3 năm)', tone: 'emerald' },
                    ],
                    tacticalTip: 'Thống kê trực tiếp từ 34 hồ sơ đã nộp trên hệ thống.',
                },
            },
        });

        const onOpenTopup = jest.fn();
        render(
            <JobCompetitionSection
                postId={88}
                applicationCount={34}
                hiringTarget={2}
                onOpenTopup={onOpenTopup}
            />
        );

        expect(await screen.findByText('1 : 17')).toBeInTheDocument();
        expect(screen.getAllByText('Đang khóa')).toHaveLength(2);
        expect(screen.queryByText('Phân bổ kinh nghiệm ứng viên')).not.toBeInTheDocument();

        const unlockBtn = await screen.findByRole('button', { name: /Mở khóa ngay \(-10 điểm\)/i });
        fireEvent.click(unlockBtn);

        await waitFor(() => {
            expect(rewardPaymentService.unlockJobCompetitionReportService).toHaveBeenCalledWith(88);
        });
        expect(await screen.findByText('91%')).toBeInTheDocument();
        expect(screen.getByText('24.5 triệu')).toBeInTheDocument();
        expect(screen.getByText('React (22)')).toBeInTheDocument();
        expect(screen.getByText('Khớp 2/2 (100%)')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Xem lịch sử điểm' }));
        expect(onOpenTopup).toHaveBeenCalledWith('history');
    });

    test('handles insufficient balance when unlocking and renders empty-applicant unlocked state', async () => {
        rewardPaymentService.getJobCompetitionReportService
            .mockResolvedValueOnce({
                errCode: 0,
                data: {
                    unlocked: false,
                    unlockCostPoints: 10,
                    walletBalancePoints: 2,
                    totalApplicants: 0,
                    todayApplicants: 0,
                    hiringTarget: 1,
                    competitionRatio: '1 : 0',
                },
            })
            .mockResolvedValueOnce({
                errCode: 0,
                data: {
                    unlocked: true,
                    unlockCostPoints: 10,
                    walletBalancePoints: 10,
                    totalApplicants: 0,
                    todayApplicants: 0,
                    hiringTarget: 1,
                    competitionRatio: '1 : 0',
                    expectedSalaryAvgMillion: null,
                    expectedSalaryRangeLabel: 'Thỏa thuận (chưa có ứng viên kê khai lương)',
                    profileMatchPercent: 0,
                    profileRankLabel: 'Chưa có hồ sơ đối thủ',
                    experienceBreakdown: [],
                    applicantTopSkills: [],
                    aiCorrelation: [],
                },
            });

        rewardPaymentService.unlockJobCompetitionReportService.mockResolvedValueOnce({
            errCode: 2,
            errMessage: 'Số dư điểm không đủ',
        });

        const onOpenTopup = jest.fn();
        const { unmount } = render(
            <JobCompetitionSection postId={90} applicationCount={0} hiringTarget={1} onOpenTopup={onOpenTopup} />
        );

        const unlockBtn = await screen.findByRole('button', { name: /Mở khóa ngay \(-10 điểm\)/i });
        fireEvent.click(unlockBtn);
        await waitFor(() => {
            expect(onOpenTopup).toHaveBeenCalledWith('topup');
        });
        unmount();

        render(<JobCompetitionSection postId={91} applicationCount={0} hiringTarget={1} />);
        expect(
            await screen.findByText('Hiện chưa có ứng viên nào nộp hồ sơ vào vị trí này.')
        ).toBeInTheDocument();
        expect(screen.getByText('Thỏa thuận')).toBeInTheDocument();
    });

    test('renders EmployerRewardsSection and redeems Top Points for recruitment allowances', async () => {
        rewardPaymentService.getEmployerRewardOverviewService.mockResolvedValue({
            errCode: 0,
            data: {
                wallet: {
                    balancePoints: 65,
                    lifetimeEarned: 120,
                    tierLabel: 'Hạng Vàng (Gold Partner)',
                    multiplier: 1.25,
                },
                allowances: {
                    allowPost: 4,
                    allowHotPost: 1,
                    allowCv: 12,
                },
                redemptionCatalog: [
                    {
                        code: 'POST_1',
                        name: 'Đổi 01 lượt đăng tin tiêu chuẩn',
                        costPoints: 20,
                        rewardField: 'allowPost',
                        rewardAmount: 1,
                        description: 'Cộng ngay +1 lượt đăng bài tuyển dụng tiêu chuẩn cho công ty.',
                    },
                ],
                transactions: [
                    {
                        id: 5,
                        description: 'Tích Top Point khi mua gói đăng bài',
                        pointsDelta: 10,
                        balanceAfter: 65,
                        createdAt: new Date().toISOString(),
                    },
                ],
            },
        });
        rewardPaymentService.redeemEmployerPointsService.mockResolvedValue({
            errCode: 0,
            errMessage: 'Đổi quà Top Point thành công!',
        });

        render(<EmployerRewardsSection />);

        expect(await screen.findByText(/Hạng Vàng \(Gold Partner\)/i)).toBeInTheDocument();
        const redeemBtn = await screen.findByRole('button', { name: 'Đổi ngay' });
        fireEvent.click(redeemBtn);

        await waitFor(() => {
            expect(rewardPaymentService.redeemEmployerPointsService).toHaveBeenCalledWith('POST_1');
        });
    });

    test('renders PaymentResultPage in Sandbox Simulator mode and confirms payment', async () => {
        rewardPaymentService.verifyPaymentReturnService
            .mockResolvedValueOnce({
                errCode: 0,
                data: {
                    requireSimulationAction: true,
                    paid: false,
                    order: {
                        orderCode: 'JF999',
                        provider: 'VNPAY',
                        purpose: 'POINT_TOPUP',
                        itemName: 'Gói Tiêu Chuẩn (Standard)',
                        discountVnd: 5000,
                        promoCode: 'VNPAY5K',
                        finalAmountVnd: 45000,
                        pointsGranted: 50,
                        status: 'PENDING',
                        metadata: { postId: 42 },
                    },
                },
            })
            .mockResolvedValueOnce({
                errCode: 0,
                data: {
                    requireSimulationAction: false,
                    paid: true,
                    order: {
                        orderCode: 'JF999',
                        provider: 'VNPAY',
                        purpose: 'POINT_TOPUP',
                        itemName: 'Gói Tiêu Chuẩn (Standard)',
                        finalAmountVnd: 45000,
                        pointsGranted: 50,
                        status: 'PAID',
                        metadata: { postId: 42 },
                    },
                },
            });

        render(
            <MemoryRouter initialEntries={['/payment/result?provider=VNPAY&order=JF999&simulate=1']}>
                <PaymentResultPage />
            </MemoryRouter>
        );

        const nextBtn = await screen.findByRole('button', { name: 'Tiếp tục' });
        const bankSelect = screen.getByLabelText('Ngân hàng / Loại thẻ');
        const cardInput = screen.getByLabelText('Số thẻ');
        const holderInput = screen.getByLabelText('Tên chủ thẻ (không dấu)');
        const dateInput = screen.getByLabelText('Ngày phát hành / hết hạn (MM/YY)');

        // Card fields must start empty (never pre-filled)
        expect(bankSelect).toHaveValue('');
        expect(cardInput).toHaveValue('');
        expect(holderInput).toHaveValue('');
        expect(dateInput).toHaveValue('');

        // Submitting empty card step is blocked by validation
        fireEvent.click(nextBtn);
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(rewardPaymentService.verifyPaymentReturnService).toHaveBeenCalledTimes(1);

        // Step 1: Enter card details manually
        fireEvent.change(bankSelect, { target: { value: 'NCB (Ngân hàng Quốc Dân)' } });
        fireEvent.change(cardInput, { target: { value: '9704198526191432198' } });
        fireEvent.change(holderInput, { target: { value: 'nguyen van a' } });
        fireEvent.change(dateInput, { target: { value: '07/28' } });
        fireEvent.click(nextBtn);

        // Step 2: Review masked card & enter OTP manually
        expect(await screen.findByText('9704 **** **** 2198')).toBeInTheDocument();
        const otpInput = screen.getByLabelText('Mã xác thực OTP');
        expect(otpInput).toHaveValue('');
        fireEvent.change(otpInput, { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thanh toán' }));

        await waitFor(() => {
            expect(rewardPaymentService.verifyPaymentReturnService).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    simulateAction: 'confirm',
                    simulateCardNumber: '9704198526191432198',
                    simulateCardHolder: 'NGUYEN VAN A',
                    simulateOtp: '123456',
                })
            );
        });
        expect(await screen.findByText('Thanh toán thành công!')).toBeInTheDocument();
        expect(screen.getByText(/Quay lại Tin tuyển dụng & Xem Báo cáo/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
    });

    test('validates card/OTP branches, cancel action, and modal keyboard/promo interactions', async () => {
        // OrderConfirmModal Escape & backdrop cancel
        const onCancelConfirm = jest.fn();
        const { unmount: unmountConfirm } = render(
            <OrderConfirmModal
                isOpen
                title="Xác nhận đơn"
                rows={[{ label: 'Gói:', value: 'Basic' }]}
                totalValue="10 USD"
                subTotalNote="Quy đổi: 250.000 VNĐ"
                onCancel={onCancelConfirm}
                onConfirm={jest.fn()}
            />
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.click(screen.getByRole('dialog', { name: 'Xác nhận đơn' }));
        expect(onCancelConfirm).toHaveBeenCalledTimes(2);
        unmountConfirm();

        // PointTopupModal promo edge cases, step back, and Escape close
        rewardPaymentService.getCandidateRewardOverviewService.mockResolvedValueOnce({
            errCode: 0,
            data: { wallet: { balancePoints: 10 }, topupPackages: [], transactions: [] },
        });
        const onCloseTopup = jest.fn();
        const { unmount: unmountTopup } = render(<PointTopupModal isOpen onClose={onCloseTopup} />);
        expect(await screen.findByText('Nạp điểm tài khoản')).toBeInTheDocument();

        const promoInput = screen.getByPlaceholderText(/Nhập mã giảm giá/i);
        fireEvent.change(promoInput, { target: { value: 'UNKNOWN_PROMO' } });
        fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
        fireEvent.change(promoInput, { target: { value: 'MOMO5K' } });
        fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
        fireEvent.change(promoInput, { target: { value: 'JOBFIND10K' } });
        fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
        fireEvent.click(screen.getByRole('button', { name: 'Bỏ mã' }));

        fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
        fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCloseTopup).toHaveBeenCalled();
        unmountTopup();

        // PaymentResultPage validation branches, cardInvalid retry, and cancel
        rewardPaymentService.verifyPaymentReturnService
            .mockResolvedValueOnce({
                errCode: 0,
                data: {
                    requireSimulationAction: true,
                    paid: false,
                    order: {
                        orderCode: 'JF888',
                        provider: 'MOMO',
                        purpose: 'PACKAGE_POST',
                        itemName: 'Gói đăng bài',
                        finalAmountVnd: 100000,
                        status: 'PENDING',
                    },
                },
            })
            .mockResolvedValueOnce({
                errCode: 2,
                requireSimulationAction: true,
                errMessage: 'Giao dịch bị từ chối: Không đủ số dư',
                data: {
                    requireSimulationAction: true,
                    paid: false,
                    order: {
                        orderCode: 'JF888',
                        provider: 'MOMO',
                        purpose: 'PACKAGE_POST',
                        itemName: 'Gói đăng bài',
                        finalAmountVnd: 100000,
                        status: 'PENDING',
                    },
                },
            })
            .mockResolvedValueOnce({
                errCode: 2,
                errMessage: 'Bạn đã hủy giao dịch thanh toán',
                data: {
                    requireSimulationAction: false,
                    paid: false,
                    order: {
                        orderCode: 'JF888',
                        provider: 'MOMO',
                        purpose: 'PACKAGE_POST',
                        itemName: 'Gói đăng bài',
                        finalAmountVnd: 100000,
                        status: 'CANCELLED',
                    },
                },
            });

        render(
            <MemoryRouter initialEntries={['/payment/result?partnerCode=MOMO&resultCode=0&order=JF888']}>
                <PaymentResultPage />
            </MemoryRouter>
        );

        const nextBtn = await screen.findByRole('button', { name: 'Tiếp tục' });
        fireEvent.change(screen.getByLabelText('Ngân hàng / Loại thẻ'), {
            target: { value: 'Vietcombank (Ngân hàng Ngoại thương VN)' },
        });
        // Invalid card number
        fireEvent.change(screen.getByLabelText('Số thẻ'), { target: { value: '12345' } });
        fireEvent.click(nextBtn);
        expect(screen.getByRole('alert')).toHaveTextContent(/Số thẻ không hợp lệ/i);

        // Missing holder
        fireEvent.change(screen.getByLabelText('Số thẻ'), { target: { value: '9704195798459170488' } });
        fireEvent.click(nextBtn);
        expect(screen.getByRole('alert')).toHaveTextContent(/chủ thẻ/i);

        // Invalid date
        fireEvent.change(screen.getByLabelText('Tên chủ thẻ (không dấu)'), { target: { value: 'TRAN B' } });
        fireEvent.change(screen.getByLabelText('Ngày phát hành / hết hạn (MM/YY)'), { target: { value: '99/99' } });
        fireEvent.click(nextBtn);
        expect(screen.getByRole('alert')).toHaveTextContent(/MM\/YY/i);

        // Proceed to Step 2
        fireEvent.change(screen.getByLabelText('Ngày phát hành / hết hạn (MM/YY)'), { target: { value: '10/28' } });
        fireEvent.click(nextBtn);

        // Empty OTP validation
        fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận thanh toán' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/OTP/i);

        // Rejected card response, then go back and cancel transaction
        fireEvent.change(screen.getByLabelText('Mã xác thực OTP'), { target: { value: '123456' } });
        fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thanh toán' }));
        expect(await screen.findByText(/Không đủ số dư/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Quay lại sửa thẻ' }));
        expect(await screen.findByLabelText('Số thẻ')).toHaveValue('9704195798459170488');

        fireEvent.click(screen.getByRole('button', { name: 'Hủy giao dịch' }));
        expect(await screen.findByText(/Giao dịch chưa hoàn tất hoặc đã bị hủy/i)).toBeInTheDocument();
        expect(screen.getByText(/Quay lại Quản lý Gói đăng bài/i)).toBeInTheDocument();
    });

    test('enforces strict UI RBAC across Candidate, Employer, Company, Admin, and Guest', async () => {
        // 1. Non-candidate roles cannot load or interact with CandidateWalletCard / JobCompetitionSection / PointTopupModal
        for (const roleCode of ['COMPANY', 'EMPLOYER', 'ADMIN']) {
            localStorage.setItem('userData', JSON.stringify({ id: 9, roleCode, companyId: 4 }));
            const { unmount } = render(
                <>
                    <CandidateWalletCard onOpenTopup={jest.fn()} />
                    <JobCompetitionSection postId={55} applicationCount={10} hiringTarget={1} />
                    <PointTopupModal isOpen onClose={jest.fn()} />
                </>
            );
            expect(screen.queryByText('Ví điểm ứng viên')).not.toBeInTheDocument();
            expect(screen.queryByText('Thống kê ứng tuyển')).not.toBeInTheDocument();
            expect(screen.getByText('Tài khoản hiện tại không thuộc nhóm Ứng viên')).toBeInTheDocument();
            expect(rewardPaymentService.getCandidateRewardOverviewService).not.toHaveBeenCalled();
            expect(rewardPaymentService.getJobCompetitionReportService).not.toHaveBeenCalled();
            unmount();
        }

        // 2. EMPLOYER sees EmployerRewardsSection in read-only mode (cannot redeem)
        const employerUser = {
            id: 8,
            roleCode: 'EMPLOYER',
            companyId: 4,
            companyStatusCode: 'S1',
            companyCensorCode: 'CS1',
        };
        localStorage.setItem('userData', JSON.stringify(employerUser));
        rewardPaymentService.getEmployerRewardOverviewService.mockResolvedValueOnce({
            errCode: 0,
            data: {
                canRedeem: false,
                wallet: { balancePoints: 30, lifetimeEarned: 50, tierLabel: 'Thành viên (Member)', multiplier: 1 },
                allowances: { allowPost: 2, allowHotPost: 0, allowCv: 5 },
                redemptionCatalog: [
                    { code: 'POST_1', name: '1 lượt đăng tin', costPoints: 3, rewardField: 'allowPost', rewardAmount: 1, description: 'Cộng 1 lượt' },
                ],
                transactions: [],
            },
        });
        const { unmount: unmountEmp } = render(<RewardsWorkspace user={employerUser} />);
        expect(await screen.findByText('1 lượt đăng tin')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/Nhân viên tuyển dụng/i);
        const lockedRedeemBtns = screen.getAllByRole('button', { name: 'Chỉ Chủ công ty' });
        lockedRedeemBtns.forEach((btn) => expect(btn).toBeDisabled());
        fireEvent.click(lockedRedeemBtns[0]);
        expect(rewardPaymentService.redeemEmployerPointsService).not.toHaveBeenCalled();
        unmountEmp();

        // 3. ADMIN sees AdminRewardsOverview on /admin/rewards instead of company wallet
        const adminUser = { id: 1, roleCode: 'ADMIN' };
        localStorage.setItem('userData', JSON.stringify(adminUser));
        rewardPaymentService.getAdminRewardsOverviewService.mockResolvedValueOnce({
            errCode: 0,
            data: {
                summary: {
                    totalPaidRevenueVnd: 250000,
                    candidateTopupPaidVnd: 50000,
                    companyPackagePaidVnd: 200000,
                    paidOrders: 2,
                    totalOrders: 3,
                    pendingOrders: 1,
                    candidateWallets: { walletCount: 4, totalBalance: 120, totalEarned: 150, totalSpent: 30 },
                    companyWallets: { walletCount: 2, totalBalance: 15, totalEarned: 20, totalSpent: 5 },
                },
                orders: [
                    {
                        id: 11,
                        orderCode: 'JFADMIN99',
                        provider: 'VNPAY',
                        purpose: 'PACKAGE_POST',
                        itemName: 'Gói VIP',
                        actorName: 'Minh Trần',
                        companyName: 'VNG Corp',
                        amount: 200000,
                        points: 2,
                        status: 'PAID',
                        createdAt: new Date().toISOString(),
                    },
                ],
                transactions: [
                    {
                        id: 21,
                        ownerType: 'COMPANY',
                        ownerId: 4,
                        ownerLabel: 'VNG Corp',
                        description: 'Tích Top Point',
                        pointsDelta: 2,
                        balanceAfter: 15,
                        createdAt: new Date().toISOString(),
                    },
                ],
            },
        });
        const { unmount: unmountAdmin } = render(
            <MemoryRouter>
                <RewardsWorkspace user={adminUser} />
            </MemoryRouter>
        );
        expect(await screen.findByText('250.000 VNĐ')).toBeInTheDocument();
        expect(screen.getByText('JFADMIN99')).toBeInTheDocument();
        expect(screen.getAllByText('VNG Corp').length).toBeGreaterThanOrEqual(1);
        unmountAdmin();

        // 4. Guest and EMPLOYER are blocked at PaymentResultPage without hitting verify endpoint
        localStorage.clear();
        const { unmount: unmountGuest } = render(
            <MemoryRouter initialEntries={['/payment/result?provider=VNPAY&order=JF1']}>
                <PaymentResultPage />
            </MemoryRouter>
        );
        expect(await screen.findByText(/Vui lòng đăng nhập tài khoản đã khởi tạo giao dịch/i)).toBeInTheDocument();
        expect(rewardPaymentService.verifyPaymentReturnService).not.toHaveBeenCalled();
        unmountGuest();

        localStorage.setItem('userData', JSON.stringify(employerUser));
        render(
            <MemoryRouter initialEntries={['/payment/result?provider=VNPAY&order=JF1']}>
                <PaymentResultPage />
            </MemoryRouter>
        );
        expect(await screen.findByText(/Tài khoản hiện tại không có quyền thực hiện giao dịch thanh toán dịch vụ/i)).toBeInTheDocument();
        expect(rewardPaymentService.verifyPaymentReturnService).not.toHaveBeenCalled();
    });
});
