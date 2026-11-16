import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import SessionContext from '../../auth/SessionContext';
import JobCompetitionSection from './JobCompetitionSection';
import { getProfileComparison } from './competitionReport';
import { getJobCompetitionReportService, unlockJobCompetitionReportService, notifyRewardWalletUpdated } from '../../service/rewardPaymentService';

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() } }));
jest.mock('../../auth/sessionExpiry', () => ({ SESSION_ENDED_EVENT: 'jobfind:session-ended' }));
jest.mock('../../service/rewardPaymentService', () => ({
    getJobCompetitionReportService: jest.fn(), unlockJobCompetitionReportService: jest.fn(), notifyRewardWalletUpdated: jest.fn(),
    REWARD_WALLET_UPDATED_EVENT: 'jobfind:reward-wallet-updated', CANDIDATE_PROFILE_UPDATED_EVENT: 'jobfind:candidate-profile-updated',
}));

const candidate = { id: 77, roleCode: 'CANDIDATE' };
const skills = ['Python', 'SQL', 'Power BI', 'Excel', 'Data Visualization'].map((name, index) => ({ id: index + 1, name, requirementLevel: 'unspecified' }));
const privateCandidateLabel = 'Kinh nghiệm riêng của ứng viên: 2 năm';
const response = (data) => ({ errCode: 0, data });
const pending = () => {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const profileComparison = (experienceLabel = privateCandidateLabel) => ({
    totalCriteriaCount: 4, identifiedCriteriaCount: 4, evaluatedCriteriaCount: 3, metCriteriaCount: 3,
    partialCriteriaCount: 0, unmatchedCriteriaCount: 0, needsUpdateCount: 1, notIdentifiedCount: 0, notRequiredCount: 0,
    criteria: [
        { key: 'skills', label: 'Kỹ năng', status: 'missing', requirementStatus: 'identified', requiredLabel: '5 kỹ năng được nhắc tới', candidateLabel: 'Chưa cập nhật kỹ năng', description: 'Hồ sơ tài khoản chưa ghi nhận kỹ năng đối chiếu.' },
        { key: 'experience', label: 'Kinh nghiệm', status: 'met', requirementStatus: 'identified', requiredLabel: 'Từ 2 năm', candidateLabel: experienceLabel },
        { key: 'category', label: 'Ngành nghề', status: 'met', requirementStatus: 'identified', requiredLabel: 'Công nghệ thông tin', candidateLabel: 'Công nghệ thông tin' },
        { key: 'location', label: 'Địa điểm', status: 'met', requirementStatus: 'identified', requiredLabel: 'TP Hồ Chí Minh', candidateLabel: 'TP Hồ Chí Minh' },
    ],
    requiredSkills: skills, matchedSkills: [], unrecordedSkills: skills,
    recommendations: [{ key: 'skills', label: 'Cập nhật kỹ năng', reason: 'Bổ sung các kỹ năng bạn có để hệ thống đối chiếu.', target: 'skills', relatedCriteria: ['skills'] }],
});
const lockedReport = (overrides = {}) => ({
    postId: 1, unlocked: false, expiresAt: null, unlockCostPoints: 10, unlockTtlDays: 30, validDays: 30, walletBalancePoints: 45,
    totalApplicants: 3, totalApplications: 3, todayApplicants: 0, hiringTarget: 2, applicantsPerPosition: 1.5, competitionRatio: '1 : 1.5',
    jobOverview: { salaryLabel: '15 - 20 triệu', experienceLabel: '2 năm', categoryLabel: 'Công nghệ thông tin', locationLabel: 'TP Hồ Chí Minh' },
    hasApplied: false, expectedSalaryAvgMillion: null, expectedSalaryRangeLabel: null, profileMatchPercent: null,
    profileRankLabel: null, salaryRange: null, profileMatch: null, profileComparison: null, experienceBreakdown: null, applicantTopSkills: null, aiCorrelation: null,
    ...overrides,
});
const unlockedReport = (overrides = {}) => ({
    ...lockedReport(), unlocked: true, expiresAt: new Date(Date.now() + 20 * 86400000).toISOString(),
    expectedSalaryAvgMillion: 17.5,
    salaryRange: {
        averageMillion: 17.5, source: 'APPLICANTS', sampleCount: 3, estimatedSampleCount: 1, openRangeCount: 2, missingCount: 0,
        distribution: [{ label: 'Dưới 5 triệu', count: 1 }, { label: '15 - 20 triệu', count: 1 }, { label: 'Trên 30 triệu', count: 1 }],
        jobSalaryLabel: '15 - 20 triệu', methodLabel: 'Ước tính từ trung điểm các khung lương kín; không nội suy khoảng mở.',
    },
    // Legacy fields stay in the API for compatibility, but should not lead the redesigned UI.
    profileMatchPercent: 50, profileRankLabel: 'Theo điểm hệ thống: Đồng hạng #2/4 nếu nộp hồ sơ',
    profileMatch: { sourceLabel: 'Đối chiếu thông tin tài khoản hiện tại, chưa phân tích tệp CV đã nộp.', scoreExplanation: 'Kỹ năng 50 điểm; kinh nghiệm 25; ngành nghề 15; địa điểm 10.' },
    profileComparison: profileComparison(),
    experienceBreakdown: [{ key: 'under3', label: 'Dưới 3 năm kinh nghiệm', count: 2, percent: 67, isUserGroup: true }, { key: 'over5', label: 'Trên 5 năm kinh nghiệm', count: 1, percent: 33 }],
    applicantTopSkills: [{ skillId: 1, name: 'Python', count: 1 }], aiCorrelation: [],
    ...overrides,
});
const section = (postId = 1, user = candidate, extraProps = {}) => <SessionContext.Provider value={user}><JobCompetitionSection postId={postId} {...extraProps} /></SessionContext.Provider>;
const expectNoPrivateReport = () => {
    expect(screen.queryByText(privateCandidateLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ứng viên đã nộp' })).not.toBeInTheDocument();
};
const expectNoVisibleLegacyHeadline = () => {
    for (const pattern of [/^50%$/, /#2\/4/, /^17[,.]5 triệu/]) screen.queryAllByText(pattern).forEach((element) => expect(element).not.toBeVisible());
};

beforeEach(() => {
    jest.resetAllMocks(); localStorage.clear();
    localStorage.setItem('userData', JSON.stringify(candidate)); localStorage.setItem('token_user', 'candidate-session-77');
    getJobCompetitionReportService.mockResolvedValue(response(lockedReport()));
});
afterEach(() => { jest.useRealTimers(); localStorage.clear(); });

test('does not present missing initial data as zero applicants or a confirmed locked report', () => {
    getJobCompetitionReportService.mockReturnValue(pending().promise); render(section());
    expect(screen.getByRole('status')).toHaveTextContent(/đang tải/i);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mở khóa ngay/i })).not.toBeInTheDocument();
});

test.each([
    ['a failed connection', () => Promise.reject(new Error('Offline'))],
    ['an API error envelope', () => Promise.resolve({ errCode: -1, errMessage: 'Không thể tải báo cáo' })],
])('shows a recoverable error for %s without inventing empty statistics', async (_name, failure) => {
    getJobCompetitionReportService.mockImplementationOnce(failure); render(section());
    expect(await screen.findByRole('alert')).toHaveTextContent(/báo cáo|kết nối|tải/i);
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    await screen.findByRole('button', { name: /mở khóa ngay/i });
    expect(getJobCompetitionReportService).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('ignores an earlier job response that resolves after the newly selected job', async () => {
    const oldRequest = pending();
    getJobCompetitionReportService.mockImplementation((postId) => postId === 1 ? oldRequest.promise : Promise.resolve(response(lockedReport({ postId: 2, totalApplicants: 7, applicantsPerPosition: 7, hiringTarget: 1 }))));
    const view = render(section(1)); view.rerender(section(2));
    await screen.findByRole('button', { name: /mở khóa ngay/i });
    await act(async () => { oldRequest.resolve(response(unlockedReport())); });
    expectNoPrivateReport();
    expect(screen.getByText('Đã ứng tuyển').parentElement).toHaveTextContent('7');
});

test('clears an unlocked report immediately when a different job is loading or fails', async () => {
    const newRequest = pending();
    getJobCompetitionReportService.mockResolvedValueOnce(response(unlockedReport())).mockReturnValueOnce(newRequest.promise);
    const view = render(section(1)); await screen.findByText(privateCandidateLabel);
    view.rerender(section(2)); expectNoPrivateReport();
    await act(async () => { newRequest.reject(new Error('Offline')); });
    await screen.findByRole('alert'); expectNoPrivateReport();
});

test('does not expose the previous candidate report after switching sessions', async () => {
    const oldRequest = pending();
    getJobCompetitionReportService.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(response(lockedReport()));
    const view = render(section()); const nextCandidate = { id: 88, roleCode: 'CANDIDATE' };
    localStorage.setItem('userData', JSON.stringify(nextCandidate)); localStorage.setItem('token_user', 'candidate-session-88');
    view.rerender(section(1, nextCandidate)); await screen.findByRole('button', { name: /mở khóa ngay/i });
    await act(async () => { oldRequest.resolve(response(unlockedReport())); });
    expectNoPrivateReport(); expect(getJobCompetitionReportService).toHaveBeenCalledTimes(2);
});

test('clears private insights on logout and ignores requests that were already pending', async () => {
    const oldRequest = pending();
    getJobCompetitionReportService.mockResolvedValueOnce(response(unlockedReport())).mockReturnValueOnce(oldRequest.promise);
    const view = render(section()); await screen.findByText(privateCandidateLabel);
    act(() => window.dispatchEvent(new CustomEvent('jobfind:reward-wallet-updated')));
    localStorage.clear(); view.rerender(section(1, null)); expectNoPrivateReport();
    await act(async () => { oldRequest.resolve(response(unlockedReport())); }); expectNoPrivateReport();
});

test('removes unlocked insights on the session-ended event before the parent updates its context', async () => {
    getJobCompetitionReportService.mockResolvedValueOnce(response(unlockedReport())); render(section());
    await screen.findByText(privateCandidateLabel); localStorage.clear();
    await act(async () => { window.dispatchEvent(new Event('jobfind:session-ended')); }); expectNoPrivateReport();
});

test('ignores a successful unlock response after the user navigates to a different job', async () => {
    const unlock = pending(); unlockJobCompetitionReportService.mockReturnValue(unlock.promise);
    const view = render(section()); fireEvent.click(await screen.findByRole('button', { name: /mở khóa ngay/i }));
    getJobCompetitionReportService.mockResolvedValue(response(lockedReport({ postId: 2, totalApplicants: 7, applicantsPerPosition: 7, hiringTarget: 1 })));
    view.rerender(section(2)); await screen.findByRole('button', { name: /mở khóa ngay/i });
    await act(async () => { unlock.resolve(response({ report: unlockedReport() })); }); expectNoPrivateReport();
    expect(screen.getByText('Đã ứng tuyển').parentElement).toHaveTextContent('7');
});

test('does not overwrite a newer profile report with an older pending unlock snapshot', async () => {
    const unlock = pending(); const latestLabel = 'Kinh nghiệm vừa cập nhật: 3 năm';
    getJobCompetitionReportService.mockResolvedValueOnce(response(lockedReport())).mockResolvedValue(response(unlockedReport({ profileComparison: profileComparison(latestLabel) })));
    unlockJobCompetitionReportService.mockReturnValue(unlock.promise); render(section());
    fireEvent.click(await screen.findByRole('button', { name: /mở khóa ngay/i }));
    act(() => window.dispatchEvent(new CustomEvent('jobfind:candidate-profile-updated'))); await screen.findByText(latestLabel);
    await act(async () => { unlock.resolve(response({ report: unlockedReport() })); });
    await screen.findByText(latestLabel); expect(screen.queryByText(privateCandidateLabel)).not.toBeInTheDocument();
});

test('keeps job salary public while protecting profile and applicant insights until unlocked', async () => {
    getJobCompetitionReportService.mockResolvedValue(response(lockedReport({ profileComparison: profileComparison(), salaryRange: unlockedReport().salaryRange })));
    render(section()); await screen.findByRole('button', { name: /mở khóa ngay/i });
    expect(screen.getByText('Lương tin đăng').parentElement).toHaveTextContent('15 - 20 triệu'); expectNoPrivateReport();
    expect(screen.queryByText('Dưới 5 triệu')).not.toBeInTheDocument(); expect(screen.queryByText('Trên 30 triệu')).not.toBeInTheDocument();
});

test('shows applicant count and hiring target without inventing a competition level from a small sample', async () => {
    render(section()); await screen.findByRole('button', { name: /mở khóa ngay/i });
    expect(screen.getByText('Đã ứng tuyển').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Số lượng tuyển').parentElement).toHaveTextContent('2');
    expect(screen.queryByText(/cạnh tranh (?:thấp|cao|trung bình)|cơ hội (?:cao|thấp)/i)).not.toBeInTheDocument(); expectNoVisibleLegacyHeadline();
});

test('keeps missing applicant salary separate from the posted salary', async () => {
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ expectedSalaryAvgMillion: null, salaryRange: { averageMillion: null, source: 'NO_DATA', sampleCount: 0, distribution: [], jobSalaryLabel: '15 - 20 triệu' } })));
    render(section()); await screen.findByText(privateCandidateLabel);
    expect(screen.getByText('Lương tin đăng').parentElement).toHaveTextContent('15 - 20 triệu');
    expect(screen.getAllByText(/chưa có.*(?:kê khai|dữ liệu)/i).length).toBeGreaterThan(0); expectNoVisibleLegacyHeadline();
});

test('shows literal salary segments without promoting a mean or inventing open-range limits', async () => {
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport())); render(section()); await screen.findByText(privateCandidateLabel);
    expect(screen.getByText('Dưới 5 triệu')).toBeVisible(); expect(screen.getByText('Trên 30 triệu')).toBeVisible();
    expect(screen.queryByText(/3\s*-\s*39 triệu/)).not.toBeInTheDocument(); expectNoVisibleLegacyHeadline();
});

test('compares job requirements with account values instead of leading with a score or ranking', async () => {
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport())); render(section()); await screen.findByText(privateCandidateLabel);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Yêu cầu công việc' })).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: 'Hồ sơ của bạn' })).toBeVisible();
    expect(within(table).getByText('Từ 2 năm')).toBeVisible(); expect(within(table).getByText('Chưa cập nhật kỹ năng')).toBeVisible();
    expect(screen.getByText('3 tiêu chí đã phù hợp')).toBeVisible(); expectNoVisibleLegacyHeadline();
});

test('does not count missing or unspecified requirements as matched criteria', async () => {
    const comparison = profileComparison();
    Object.assign(comparison, { metCriteriaCount: 0, identifiedCriteriaCount: 1, evaluatedCriteriaCount: 0, notIdentifiedCount: 2, notRequiredCount: 1 });
    comparison.criteria = comparison.criteria.map((criterion, index) => index === 0 ? criterion : ({ ...criterion, status: 'not_required', requirementStatus: index === 1 ? 'not_required' : 'not_identified', requiredLabel: index === 1 ? 'Không yêu cầu kinh nghiệm' : 'Chưa công bố', candidateLabel: 'Chưa cập nhật' }));
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ profileComparison: comparison }))); render(section());
    await screen.findByText('Không yêu cầu kinh nghiệm');
    expect(screen.getAllByText('Chưa công bố').length).toBeGreaterThan(0);
    expect(screen.queryByText(/3\s*\/\s*3|100%|3 tiêu chí đã phù hợp/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText(/^Phù hợp$/)).not.toBeInTheDocument();
});

test('partitions matched and unrecorded skills and links to the correct profile editor section', async () => {
    const comparison = profileComparison(); comparison.matchedSkills = [skills[0], skills[1]]; comparison.unrecordedSkills = skills.slice(2);
    comparison.criteria[0] = { ...comparison.criteria[0], status: 'partial', candidateLabel: 'Khớp 2/5 kỹ năng' };
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ profileComparison: comparison }))); render(section()); await screen.findByText('Khớp 2/5 kỹ năng');
    const matched = screen.getByRole('group', { name: 'Đã có trong hồ sơ' }); const unrecorded = screen.getByRole('group', { name: 'Cần kiểm tra / bổ sung' });
    expect(within(matched).getByText('Python')).toBeVisible(); expect(within(matched).getByText('SQL')).toBeVisible(); expect(within(matched).queryByText('Power BI')).not.toBeInTheDocument();
    expect(within(unrecorded).getByText('Power BI')).toBeVisible(); expect(within(unrecorded).getByText('Data Visualization')).toBeVisible(); expect(within(unrecorded).queryByText('Python')).not.toBeInTheDocument();
    const target = new URL(screen.getByRole('link', { name: /cập nhật kỹ năng/i }).getAttribute('href'), 'https://jobfind.test');
    expect(target.pathname).toBe('/candidate/usersetting'); expect(target.searchParams.get('section')).toBe('skills'); expect(target.searchParams.get('returnTo')).toBe('/detail-job/1');
});

test('does not interpret an unidentified legacy skill requirement as no skill requirement', async () => {
    const legacy = {
        requiredSkillStatus: 'not_identified', requiredSkills: [], missingSkills: [],
        criteria: [{ key: 'skills', status: 'not_required', label: 'Chưa xác định yêu cầu kỹ năng' }],
    };
    const normalized = getProfileComparison({ profileMatch: legacy });
    expect(normalized.criteria.find(item => item.key === 'skills')).toMatchObject({
        status: 'not_identified', requirementStatus: 'not_identified',
    });
    expect(normalized.metCriteriaCount).toBe(0);
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ profileComparison: null, profileMatch: legacy })));
    render(section());
    const table = await screen.findByRole('table');
    const skillRow = within(table).getByRole('rowheader', { name: 'Kỹ năng' }).closest('tr');
    expect(within(skillRow).getByText('Chưa đủ dữ liệu từ tin đăng')).toBeVisible();
    expect(within(skillRow).queryByText('Không yêu cầu')).not.toBeInTheDocument();
});

test('offers a profile view instead of requesting a skill update when all requirements match', async () => {
    const comparison = profileComparison();
    comparison.criteria = comparison.criteria.map(item => ({
        ...item, status: 'met', candidateLabel: item.key === 'skills' ? 'Khớp 5/5 kỹ năng' : item.candidateLabel,
    }));
    Object.assign(comparison, {
        matchedSkills: skills, unrecordedSkills: [], metCriteriaCount: 4,
        evaluatedCriteriaCount: 4, needsUpdateCount: 0, recommendations: [],
    });
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ profileComparison: comparison })));
    render(section());
    const viewProfile = await screen.findByRole('link', { name: 'Xem hồ sơ' });
    const target = new URL(viewProfile.getAttribute('href'), 'https://jobfind.test');
    expect(target.pathname).toBe('/candidate/usersetting');
    expect(target.searchParams.get('returnTo')).toBe('/detail-job/1');
    expect(target.searchParams.has('section')).toBe(false);
    expect(screen.queryByRole('link', { name: 'Cập nhật kỹ năng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cập nhật hồ sơ' })).not.toBeInTheDocument();
});

test('prioritizes the actual non-skill gap when skills already match', async () => {
    const comparison = profileComparison();
    comparison.criteria = comparison.criteria.map(item => ({
        ...item, status: item.key === 'experience' ? 'partial' : 'met',
        candidateLabel: item.key === 'skills' ? 'Khớp 5/5 kỹ năng' : item.key === 'experience' ? '1 năm' : item.candidateLabel,
    }));
    Object.assign(comparison, {
        matchedSkills: skills, unrecordedSkills: [], metCriteriaCount: 3,
        partialCriteriaCount: 1, evaluatedCriteriaCount: 4, needsUpdateCount: 0,
        recommendations: [{ key: 'review_experience', label: 'Đối chiếu kinh nghiệm', target: 'experience', relatedCriteria: ['experience'] }],
    });
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ profileComparison: comparison })));
    render(section());
    const updateProfile = await screen.findByRole('link', { name: 'Cập nhật hồ sơ' });
    const target = new URL(updateProfile.getAttribute('href'), 'https://jobfind.test');
    expect(target.pathname).toBe('/candidate/usersetting');
    expect(target.searchParams.get('section')).toBe('experience');
    expect(target.searchParams.get('returnTo')).toBe('/detail-job/1');
    expect(screen.queryByRole('link', { name: 'Cập nhật kỹ năng' })).not.toBeInTheDocument();
});

test('partitions legacy skills by identity when two required skills share the same name', () => {
    const required = [{ id: 1, name: 'SQL' }, { id: 2, name: 'SQL' }];
    const comparison = getProfileComparison({ profileMatch: {
        requiredSkills: required, missingSkills: [required[1]], requiredSkillStatus: 'identified',
        criteria: [{ key: 'skills', status: 'partial' }],
    } });
    expect(comparison.matchedSkills.map(skill => skill.id)).toEqual([1]);
    expect(comparison.unrecordedSkills.map(skill => skill.id)).toEqual([2]);
    expect(comparison.criteria.find(item => item.key === 'skills').candidateLabel).toBe('Khớp 1/2 kỹ năng');
});

test.each([[true, 'Dự kiến #2/4 nếu nộp hồ sơ'], [false, 'Xếp hạng #2/3 hồ sơ đã nộp']])('uses explicit hasApplied=%s rather than guessing from a legacy rank label', async (hasApplied, profileRankLabel) => {
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ hasApplied, profileRankLabel }))); render(section()); await screen.findByText(privateCandidateLabel);
    expect(screen.getByText(hasApplied ? 'Bạn đã ứng tuyển công việc này.' : 'Bạn chưa ứng tuyển công việc này.')).toBeVisible();
    expect(screen.queryByText(hasApplied ? 'Bạn chưa ứng tuyển công việc này.' : 'Bạn đã ứng tuyển công việc này.')).not.toBeInTheDocument();
});

test('states the cost and duration before charging and prevents repeated submission', async () => {
    const unlock = pending(); unlockJobCompetitionReportService.mockReturnValue(unlock.promise); render(section());
    const button = await screen.findByRole('button', { name: /mở khóa ngay/i });
    expect(screen.getAllByText(/10 điểm/).length).toBeGreaterThan(0); expect(screen.getAllByText(/30 ngày/).length).toBeGreaterThan(0);
    fireEvent.click(button); fireEvent.click(button); expect(unlockJobCompetitionReportService).toHaveBeenCalledTimes(1); expect(notifyRewardWalletUpdated).not.toHaveBeenCalled();
});

test('shows actual expiry in Vietnam time and removes insights when expiry passes', async () => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2030-01-01T16:59:58.000Z'));
    getJobCompetitionReportService.mockResolvedValueOnce(response(unlockedReport({ expiresAt: '2030-01-01T17:00:00.000Z' }))); render(section());
    await act(async () => {}); expect(screen.getByText(privateCandidateLabel)).toBeInTheDocument(); expect(screen.getByText(/02\/01\/2030/)).toBeInTheDocument();
    expect(screen.queryByText('Đã mở khóa (30 ngày)')).not.toBeInTheDocument(); await act(async () => { jest.advanceTimersByTime(2001); }); expectNoPrivateReport();
});

test('does not expose details or charge again when the returned expiry is invalid', async () => {
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ expiresAt: 'invalid-expiry' }))); render(section());
    expect(await screen.findByRole('alert')).toHaveTextContent('Không xác định được hạn xem báo cáo'); expectNoPrivateReport();
    expect(screen.queryByRole('button', { name: /mở khóa ngay/i })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: /thử lại/i })).toBeEnabled(); expect(unlockJobCompetitionReportService).not.toHaveBeenCalled();
});

test('reloads after profile changes and after submitting an application', async () => {
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport())); render(section()); await screen.findByText(privateCandidateLabel);
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ profileComparison: profileComparison('Kinh nghiệm đã cập nhật: 3 năm') })));
    act(() => window.dispatchEvent(new CustomEvent('jobfind:candidate-profile-updated'))); await screen.findByText('Kinh nghiệm đã cập nhật: 3 năm');
    getJobCompetitionReportService.mockResolvedValue(response(unlockedReport({ hasApplied: true, profileComparison: profileComparison('Hồ sơ mới nộp: 3 năm kinh nghiệm') })));
    act(() => window.dispatchEvent(new CustomEvent('jobfind:reward-wallet-updated', { detail: { submittedPostId: 1 } }))); await screen.findByText('Hồ sơ mới nộp: 3 năm kinh nghiệm');
});
