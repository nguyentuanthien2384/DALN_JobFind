import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import RecruiterAssessmentManager from './RecruiterAssessmentManager';
import {
    deleteApplicationAssessment,
    generateAssessmentWithAi,
    getApplicationAssessment,
    getApplicationAssessmentTemplates,
    gradeApplicationAssessment,
    gradeAssessmentWithAi,
    upsertApplicationAssessment
} from '../../service/assessmentService';

jest.mock('react-toastify', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

jest.mock('../../service/assessmentService', () => {
    const actual = jest.requireActual('../../service/assessmentService');
    return {
        ...actual,
        getApplicationAssessment: jest.fn(),
        getApplicationAssessmentTemplates: jest.fn(),
        upsertApplicationAssessment: jest.fn(),
        deleteApplicationAssessment: jest.fn(),
        generateAssessmentWithAi: jest.fn(),
        gradeApplicationAssessment: jest.fn(),
        gradeAssessmentWithAi: jest.fn()
    };
});

const lawTemplate = {
    id: 'tpl-luat-contract',
    domainCode: 'luat',
    domainLabel: 'Luật',
    source: 'builtin',
    title: 'Đánh giá Pháp chế Doanh nghiệp',
    description: 'Kiểm tra hợp đồng thương mại.',
    timeLimitMinutes: 40,
    questions: [
        {
            id: 'luat-1',
            order: 1,
            type: 'mcq_single',
            prompt: 'Mức phạt vi phạm hợp đồng thương mại tối đa là bao nhiêu?',
            points: 2,
            options: [{ id: 'A', text: '8%' }, { id: 'B', text: '20%' }],
            correctOptionIds: ['A'],
            explanation: 'Điều 301 Luật Thương mại.'
        },
        {
            id: 'luat-2',
            order: 2,
            type: 'text',
            prompt: 'Soạn điều khoản bất khả kháng ngắn gọn.',
            points: 4,
            placeholder: 'Nhập câu trả lời...',
            rubric: 'Thông báo + chứng minh + miễn trừ',
            sampleAnswer: 'Mẫu chuẩn'
        }
    ]
};

beforeEach(() => {
    jest.clearAllMocks();
    getApplicationAssessmentTemplates.mockResolvedValue({
        errCode: 0,
        data: { domainCode: 'luat', domainLabel: 'Luật', templates: [lawTemplate] }
    });
    upsertApplicationAssessment.mockResolvedValue({ errCode: 0, data: { id: 1, status: 'ASSIGNED' } });
    deleteApplicationAssessment.mockResolvedValue({ errCode: 0 });
    gradeApplicationAssessment.mockResolvedValue({ errCode: 0, data: { id: 1, status: 'GRADED' } });
    gradeAssessmentWithAi.mockResolvedValue({ errCode: 0, data: { id: 1, status: 'GRADED' } });
});

describe('RecruiterAssessmentManager', () => {
    it('locks test creation outside phong_van interview round (no pre-created tests)', async () => {
        getApplicationAssessment.mockResolvedValueOnce({
            errCode: 0,
            data: {
                applicationId: 10,
                stage: 'dang_xem_xet',
                canCreate: false,
                domainCode: 'luat',
                domainLabel: 'Luật',
                assessment: null
            }
        });

        render(<RecruiterAssessmentManager applicationId={10} stage="dang_xem_xet" />);
        expect(await screen.findByText(/đang bị khóa ở vòng này/i)).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(getApplicationAssessmentTemplates).not.toHaveBeenCalled();
    });

    it('lets recruiter in phong_van pick a domain-matched template, edit/add mixed questions, and assign it', async () => {
        getApplicationAssessment.mockResolvedValue({
            errCode: 0,
            data: {
                applicationId: 10,
                stage: 'phong_van',
                canCreate: true,
                domainCode: 'luat',
                domainLabel: 'Luật',
                assessment: null
            }
        });

        const onUpdated = jest.fn();
        render(<RecruiterAssessmentManager applicationId={10} stage="phong_van" onAssessmentUpdated={onUpdated} />);

        expect(await screen.findByText('Đánh giá Pháp chế Doanh nghiệp')).toBeInTheDocument();
        fireEvent.click(screen.getByText(/Dùng đề này/i));

        // Switched to editor tab with template loaded
        expect(screen.getByDisplayValue('Đánh giá Pháp chế Doanh nghiệp')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /\+ Câu điền tự luận/i }));
        expect(screen.getByText(/Soạn & Giao đề \(3 câu\)/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Giao bài test cho ứng viên/i }));
        await waitFor(() => expect(upsertApplicationAssessment).toHaveBeenCalledWith(10, expect.objectContaining({
            templateId: 'tpl-luat-contract',
            domainCode: 'luat',
            title: 'Đánh giá Pháp chế Doanh nghiệp'
        })));
        expect(onUpdated).toHaveBeenCalled();
    });

    it('lets recruiter generate a custom-domain test with AI when in phong_van', async () => {
        getApplicationAssessment.mockResolvedValue({
            errCode: 0,
            data: {
                applicationId: 15,
                stage: 'phong_van',
                canCreate: true,
                domainCode: 'custom-nganh-moi',
                domainLabel: 'Nghề đặc thù mới',
                assessment: null
            }
        });
        getApplicationAssessmentTemplates.mockResolvedValueOnce({
            errCode: 0,
            data: { domainCode: 'custom-nganh-moi', domainLabel: 'Nghề đặc thù mới', templates: [] }
        });
        generateAssessmentWithAi.mockResolvedValueOnce({
            title: 'AI Test Nghề Đặc Thù',
            description: 'Tạo tự động chuẩn ngành',
            timeLimitMinutes: 35,
            questions: [
                { id: 'ai-1', order: 1, type: 'text', prompt: 'Xử lý tình huống đặc thù', points: 5, placeholder: '...', rubric: 'Chuẩn' }
            ]
        });

        render(<RecruiterAssessmentManager applicationId={15} stage="phong_van" />);
        expect(await screen.findByText(/không copy đề từ ngành khác sang/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Nhờ AI tạo bài test' }));
        fireEvent.change(screen.getByLabelText(/Chủ đề muốn AI tập trung/i), { target: { value: 'Quy trình vận hành' } });
        fireEvent.click(screen.getByRole('button', { name: /Nhờ AI tạo bài test ngành/i }));

        await waitFor(() => expect(generateAssessmentWithAi).toHaveBeenCalledWith(15, expect.objectContaining({
            focusTopics: 'Quy trình vận hành'
        })));
        expect(await screen.findByDisplayValue('AI Test Nghề Đặc Thù')).toBeInTheDocument();
        expect(toast.success).toHaveBeenCalled();
    });

    it('supports withdrawing an unassigned/unsubmitted assessment in phong_van', async () => {
        getApplicationAssessment.mockResolvedValue({
            errCode: 0,
            data: {
                applicationId: 18,
                stage: 'phong_van',
                canCreate: true,
                domainCode: 'cong-nghe-thong-tin',
                domainLabel: 'Công nghệ thông tin',
                assessment: {
                    id: 77,
                    status: 'ASSIGNED',
                    title: 'Đề đang giao',
                    timeLimitMinutes: 30,
                    questions: lawTemplate.questions
                }
            }
        });

        render(<RecruiterAssessmentManager applicationId={18} stage="phong_van" />);
        expect(await screen.findByText(/Đã giao bài test/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Soạn & Giao đề/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Thu hồi bài test' }));
        fireEvent.click(screen.getByRole('button', { name: 'Xác nhận thu hồi' }));
        await waitFor(() => expect(deleteApplicationAssessment).toHaveBeenCalledWith(18));
    });

    it('lets recruiter grade manually OR click AI auto-grade for a submitted mixed IT test', async () => {
        getApplicationAssessment.mockResolvedValue({
            errCode: 0,
            data: {
                applicationId: 20,
                stage: 'phong_van',
                canCreate: true,
                domainCode: 'cong-nghe-thong-tin',
                domainLabel: 'Công nghệ thông tin',
                assessment: {
                    id: 99,
                    status: 'SUBMITTED',
                    title: 'Backend Node.js Test',
                    timeSpentSeconds: 920,
                    isOvertime: false,
                    mcqScore: 2,
                    mcqAutoResults: {
                        mcqMaxScore: 2,
                        perQuestion: [{ questionId: 'it-1', autoGraded: true, isCorrect: true, earnedPoints: 2 }]
                    },
                    questions: [
                        { id: 'it-1', type: 'mcq_single', prompt: 'Event loop?', points: 2, options: [{ id: 'A', text: 'Single-thread' }], correctOptionIds: ['A'] },
                        { id: 'it-2', type: 'code', language: 'javascript', prompt: 'Viết hàm lọc số dương', points: 4, rubric: 'O(n)', sampleAnswer: 'arr.filter(x=>x>0)' }
                    ],
                    answers: {
                        'it-1': { selectedOptionIds: ['A'] },
                        'it-2': { codeAnswer: 'const fn = (a) => a.filter(n => n > 0);' }
                    }
                }
            }
        });

        render(<RecruiterAssessmentManager applicationId={20} stage="phong_van" />);
        expect(await screen.findByText(/Điểm trắc nghiệm hệ thống: 2\/2đ/i)).toBeInTheDocument();
        expect(screen.getByText(/const fn = \(a\)/)).toBeInTheDocument();

        // Trigger AI grading
        fireEvent.click(screen.getByRole('button', { name: /Nhờ AI chấm bài tự động/i }));
        await waitFor(() => expect(gradeAssessmentWithAi).toHaveBeenCalledWith(20, { language: 'vi' }));

        // Also test manual grading submission
        const scoreInputs = screen.getAllByLabelText(/Chấm điểm:/i);
        fireEvent.change(scoreInputs[1], { target: { value: '3.5' } });
        fireEvent.change(screen.getByLabelText(/Đánh giá tổng quan/i), { target: { value: 'Code sạch sẽ' } });
        fireEvent.click(screen.getByRole('button', { name: /Lưu kết quả chấm điểm thủ công/i }));

        await waitFor(() => expect(gradeApplicationAssessment).toHaveBeenCalledWith(20, expect.objectContaining({
            overallFeedback: 'Code sạch sẽ',
            recommendation: 'PASS'
        })));
    });

    it('uses +/- score steppers without changing on wheel and shows clear 401 AI key alert', async () => {
        getApplicationAssessment.mockResolvedValue({
            errCode: 0,
            data: {
                applicationId: 21,
                stage: 'phong_van',
                canCreate: true,
                domainCode: 'cong-nghe-thong-tin',
                domainLabel: 'Công nghệ thông tin',
                assessment: {
                    id: 100,
                    status: 'SUBMITTED',
                    title: 'Code Review Test',
                    timeSpentSeconds: 600,
                    isOvertime: false,
                    mcqScore: 2,
                    mcqAutoResults: {
                        mcqMaxScore: 2,
                        perQuestion: [{ questionId: 'it-1', autoGraded: true, isCorrect: true, earnedPoints: 2 }]
                    },
                    questions: [
                        { id: 'it-1', type: 'mcq_single', prompt: 'Key React?', points: 2, options: [{ id: 'A', text: 'ID duy nhất' }], correctOptionIds: ['A'] },
                        { id: 'it-2', type: 'code', language: 'javascript', prompt: 'Viết hàm sum', points: 4 }
                    ],
                    answers: {
                        'it-1': { selectedOptionIds: ['A'] },
                        'it-2': { codeAnswer: 'const sum = (a, b) => a + b;' }
                    }
                }
            }
        });
        gradeAssessmentWithAi.mockRejectedValueOnce(new Error('Khóa API AI (ANTHROPIC_API_KEY) không hợp lệ hoặc đã hết hạn (HTTP 401)'));

        render(<RecruiterAssessmentManager applicationId={21} stage="phong_van" />);
        expect(await screen.findByText(/const sum = \(a, b\)/)).toBeInTheDocument();

        const q2Input = screen.getAllByLabelText(/Chấm điểm:/i)[1];
        const blurSpy = jest.spyOn(q2Input, 'blur');
        fireEvent.wheel(q2Input, { deltaY: -100 });
        expect(blurSpy).toHaveBeenCalled();
        expect(q2Input).toHaveValue(0);

        fireEvent.click(screen.getByRole('button', { name: 'Tăng điểm câu 2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Tăng điểm câu 2' }));
        expect(q2Input).toHaveValue(0.5);
        expect(screen.getByText(/Tổng điểm dự kiến: 2.5\/6đ/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Giảm điểm câu 2' }));
        expect(q2Input).toHaveValue(0.25);

        fireEvent.click(screen.getByRole('button', { name: /Nhờ AI chấm bài tự động/i }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/ANTHROPIC_API_KEY/i);
    });
});
