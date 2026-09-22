import axios from '../axios';

// The API uses the authenticated session to scope these lists to the candidate.
export const getNotificationJobs = ({ source, limit = 10, offset = 0 }) =>
    axios.get('/api/get-notification-jobs', { params: { source, limit, offset } });
