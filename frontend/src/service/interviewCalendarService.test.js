import axios from '../axios';
import { getInterviewCalendar } from './interviewCalendarService';

jest.mock('../axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

beforeEach(() => axios.get.mockReset());

test('uses the private employer endpoint and encodes only the supported filters', async () => {
    const response = { errCode: 0, data: [] };
    axios.get.mockResolvedValue(response);
    expect(await getInterviewCalendar({ from: '2026-09-28', to: '2026-11-08', jobId: '12&x', companyId: 99, userId: 42 })).toBe(response);
    const url = new URL(axios.get.mock.calls[0][0], 'https://jobfind.test');
    expect(url.pathname).toBe('/api/applications/interviews');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-09-28', to: '2026-11-08', jobId: '12&x' });
});

test('candidate requests never send a job or account scope', async () => {
    await getInterviewCalendar({ candidate: true, from: '2026-10-01', to: '2026-10-31', jobId: 12, userId: 42 });
    const url = new URL(axios.get.mock.calls[0][0], 'https://jobfind.test');
    expect(url.pathname).toBe('/api/my-interviews');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    await getInterviewCalendar();
    expect(axios.get).toHaveBeenLastCalledWith('/api/applications/interviews');
});
