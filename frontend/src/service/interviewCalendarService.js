import axios from '../axios';

// Identity and company scope are taken from the authenticated session by the server.
export const getInterviewCalendar = ({ candidate = false, from, to, jobId } = {}) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (!candidate && jobId) query.set('jobId', jobId);
    const path = candidate ? '/api/my-interviews' : '/api/applications/interviews';
    const encoded = query.toString();
    return axios.get(`${path}${encoded ? `?${encoded}` : ''}`);
};
