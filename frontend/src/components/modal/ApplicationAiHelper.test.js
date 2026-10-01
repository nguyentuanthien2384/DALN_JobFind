import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ApplicationAiHelper from './ApplicationAiHelper';
import { applicationIntroAi, matchCvPdfAi, getAiTask } from '../../service/aiSearchService';

jest.mock('../../service/aiSearchService', () => ({
    createAiRequestOptions: () => ({ idempotencyKey: 'a'.repeat(32) }), applicationIntroAi: jest.fn(), matchCvPdfAi: jest.fn(), getAiTask: jest.fn()
}));

const pdf = `data:application/pdf;base64,${btoa('%PDF-1.4\nCV')}`;

beforeEach(() => jest.clearAllMocks());

test('writes intros from the selected CV and lets the candidate choose one', async () => {
    applicationIntroAi.mockResolvedValue({ errCode: 0, taskId: 'task-1' });
    getAiTask.mockResolvedValue({ errCode: 0, data: { id: 'task-1', type: 'write_assist', status: 'done',
        result: { suggestions: ['Tôi có 3 năm React và muốn ứng tuyển vị trí Frontend.', 'Phương án hai'] } } });
    const onUseIntro = jest.fn();
    render(<React.StrictMode><ApplicationAiHelper source={pdf} postId={7} onUseIntro={onUseIntro} /></React.StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Viết lời giới thiệu bằng AI' }));
    expect(applicationIntroAi).toHaveBeenCalledWith(btoa('%PDF-1.4\nCV'), 7, 'vi', expect.anything());
    fireEvent.click((await screen.findAllByRole('button', { name: 'Dùng lời giới thiệu này' }))[0]);
    expect(onUseIntro).toHaveBeenCalledWith('Tôi có 3 năm React và muốn ứng tuyển vị trí Frontend.');
});

test('shows a fit score for the selected CV', async () => {
    matchCvPdfAi.mockResolvedValue({ errCode: 0, taskId: 'task-2' });
    getAiTask.mockResolvedValue({ errCode: 0, data: { id: 'task-2', type: 'match_cv', status: 'done',
        result: { score: 72, summary: 'Khớp React', matchedSkills: ['React'], missingSkills: ['Docker'], strengths: [], concerns: [] } } });
    render(<ApplicationAiHelper source={pdf} postId="7" onUseIntro={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra độ phù hợp' }));
    expect(await screen.findByText('72/100')).toBeInTheDocument();
    expect(screen.getByText('Phù hợp')).toBeInTheDocument();
    expect(screen.getByText(/Docker/)).toBeInTheDocument();
    expect(matchCvPdfAi).toHaveBeenCalledWith(btoa('%PDF-1.4\nCV'), 7, expect.anything());
});

test('stays disabled until a CV is selected', () => {
    render(<ApplicationAiHelper source="" postId={7} onUseIntro={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Viết lời giới thiệu bằng AI' })).toBeDisabled();
    expect(screen.getByText('Chọn CV ở bên dưới để dùng trợ lý AI.')).toBeInTheDocument();
});
