import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CandidateAssessmentRunner from './CandidateAssessmentRunner';
import { getMyAssessment, startMyAssessment, submitMyAssessment } from '../../service/assessmentService';

jest.mock('react-router-dom', () => ({
    Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
    useParams: () => ({ applicationId: '50' })
}));

jest.mock('react-toastify', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

jest.mock('../../service/assessmentService', () => {
    const actual = jest.requireActual('../../service/assessmentService');
    return {
        ...actual,
        getMyAssessment: jest.fn(),
        startMyAssessment: jest.fn(),
        submitMyAssessment: jest.fn()
    };
});

const mixedCandidateQuestions = [
    {
        id: 'q-mcq-s',
        order: 1,
        type: 'mcq_single',
        prompt: 'Chọn câu đúng về HTTP GET:',
        points: 2,
        options: [{ id: 'A', text: 'Idempotent' }, { id: 'B', text: 'Thay đổi DB mặc định' }]
    },
    {
        id: 'q-mcq-m',
        order: 2,
        type: 'mcq_multi',
        prompt: 'Chọn tất cả status 2xx:',
        points: 2,
        options: [{ id: 'A', text: '200 OK' }, { id: 'B', text: '201 Created' }, { id: 'C', text: '404 Not Found' }]
    },
    {
        id: 'q-code',
        order: 3,
        type: 'code',
        prompt: 'Viết hàm đảo ngược mảng:',
        points: 4,
        language: 'javascript',
        starterCode: 'function rev(arr) {\n  return arr;\n}'
    },
    {
        id: 'q-text',
        order: 4,
        type: 'text',
        prompt: 'Trình bày cách tối ưu hiệu năng React list:',
        points: 2,
        placeholder: 'Nhập phương án của bạn...',
        maxLength: 4000
    }
];

beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
});

describe('CandidateAssessmentRunner', () => {
    it('lets candidate start an assigned mixed assessment, answer MCQ/code/text interactively, and submit', async () => {
        getMyAssessment.mockResolvedValueOnce({
            errCode: 0,
            data: {
                applicationId: 50,
                stage: 'phong_van',
                jobTitle: 'Fullstack Engineer',
                domainCode: 'cong-nghe-thong-tin',
                domainLabel: 'Công nghệ thông tin',
                assessment: {
                    id: 700,
                    status: 'ASSIGNED',
                    domainLabel: 'Công nghệ thông tin',
                    title: 'Đánh giá Fullstack Mixed',
                    description: 'Làm trực tiếp trên hệ thống',
                    timeLimitMinutes: 45,
                    timeLimitSeconds: 2700,
                    maxScore: 10,
                    questions: mixedCandidateQuestions
                }
            }
        });

        startMyAssessment.mockResolvedValueOnce({
            errCode: 0,
            data: {
                applicationId: 50,
                stage: 'phong_van',
                jobTitle: 'Fullstack Engineer',
                assessment: {
                    id: 700,
                    status: 'IN_PROGRESS',
                    domainLabel: 'Công nghệ thông tin',
                    title: 'Đánh giá Fullstack Mixed',
                    timeLimitMinutes: 45,
                    timeLimitSeconds: 2700,
                    remainingSeconds: 2700,
                    maxScore: 10,
                    questions: mixedCandidateQuestions
                }
            }
        });

        submitMyAssessment.mockResolvedValueOnce({
            errCode: 0,
            errMessage: 'Đã nộp bài test thành công.',
            data: {
                applicationId: 50,
                stage: 'phong_van',
                jobTitle: 'Fullstack Engineer',
                assessment: {
                    id: 700,
                    status: 'SUBMITTED',
                    domainLabel: 'Công nghệ thông tin',
                    title: 'Đánh giá Fullstack Mixed',
                    maxScore: 10,
                    questions: mixedCandidateQuestions,
                    answers: {
                        'q-mcq-s': { selectedOptionIds: ['A'] },
                        'q-mcq-m': { selectedOptionIds: ['A', 'B'] },
                        'q-code': { codeAnswer: 'function rev(arr) { return [...arr].reverse(); }' },
                        'q-text': { textAnswer: 'Dùng key ổn định và React.memo' }
                    }
                }
            }
        });

        render(<CandidateAssessmentRunner />);
        expect(await screen.findByText('Đánh giá Fullstack Mixed')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Bắt đầu làm bài test/i }));

        // Verify IN_PROGRESS inputs rendered: radio, checkboxes, code editor, textarea
        expect(await screen.findByLabelText(/Code editor cho q-code/i)).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/Idempotent/i));
        fireEvent.click(screen.getByLabelText(/200 OK/i));
        fireEvent.click(screen.getByLabelText(/201 Created/i));

        const codeEditor = screen.getByLabelText(/Code editor cho q-code/i);
        fireEvent.keyDown(codeEditor, { key: 'Tab' });
        fireEvent.change(codeEditor, { target: { value: 'function rev(arr) { return [...arr].reverse(); }' } });

        const textInput = screen.getByLabelText(/Câu trả lời tự luận câu 4/i);
        fireEvent.change(textInput, { target: { value: 'Dùng key ổn định và React.memo' } });

        expect(screen.getByText(/4\/4/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Khôi phục khung mẫu/i }));
        fireEvent.change(codeEditor, { target: { value: 'function rev(arr) { return [...arr].reverse(); }' } });
        fireEvent.click(screen.getByRole('button', { name: /Nộp bài test/i }));

        await waitFor(() => expect(submitMyAssessment).toHaveBeenCalledWith(
            '50',
            mixedCandidateQuestions,
            expect.objectContaining({
                'q-mcq-s': { selectedOptionIds: ['A'] },
                'q-mcq-m': { selectedOptionIds: ['A', 'B'] },
                'q-code': { codeAnswer: 'function rev(arr) { return [...arr].reverse(); }' },
                'q-text': { textAnswer: 'Dùng key ổn định và React.memo' }
            })
        ));
        expect(await screen.findByText(/Nhà tuyển dụng hoặc hệ thống AI đang chấm điểm/i)).toBeInTheDocument();
    });

    it('shows final score, grading mode (AI or Recruiter), feedback and solutions once GRADED', async () => {
        getMyAssessment.mockResolvedValueOnce({
            errCode: 0,
            data: {
                applicationId: 50,
                stage: 'phong_van',
                jobTitle: 'Fullstack Engineer',
                assessment: {
                    id: 700,
                    status: 'GRADED',
                    domainLabel: 'Công nghệ thông tin',
                    title: 'Đánh giá Fullstack Mixed',
                    totalScore: 8.5,
                    earnedPoints: 8.5,
                    maxScore: 10,
                    gradingMode: 'AI',
                    gradingFeedback: {
                        recommendation: 'PASS',
                        overallFeedback: 'Code sạch, nắm chắc HTTP.',
                        perQuestion: [
                            { questionId: 'q-mcq-s', earnedPoints: 2, passed: true, comment: 'Chính xác.' },
                            { questionId: 'q-code', earnedPoints: 3.5, passed: true, comment: 'Thuật toán tốt.' }
                        ]
                    },
                    questions: [
                        { ...mixedCandidateQuestions[0], correctOptionIds: ['A'], explanation: 'GET không thay đổi tài nguyên.' },
                        mixedCandidateQuestions[2]
                    ],
                    answers: {
                        'q-mcq-s': { selectedOptionIds: ['A'] },
                        'q-code': { codeAnswer: 'return [...arr].reverse();' }
                    }
                }
            }
        });

        render(<CandidateAssessmentRunner />);
        expect(await screen.findByText(/Kết quả: 8\.5\/10/i)).toBeInTheDocument();
        expect(screen.getByText(/Chấm bởi AI/i)).toBeInTheDocument();
        expect(screen.getByText(/Code sạch, nắm chắc HTTP\./i)).toBeInTheDocument();
        expect(screen.getByText(/GET không thay đổi tài nguyên\./i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Quay lại lịch sử ứng tuyển/i })).toHaveAttribute('href', '/candidate/cv-post');
    });
});
