import axios from 'axios';
import { requireEnvironment } from '../../../shared/securityConfig.js';

export const jobIdString = (value) => {
    const id = String(value ?? '');
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid job ID');
    return id;
};

const requestOptions = () => ({ timeout: 10000, headers: { 'x-internal-secret': requireEnvironment('INTERNAL_SECRET') } });
const baseUrl = () => process.env.JOB_CORE_URL || 'http://job-core-service:4002';

export const loadCurrentJob = async (jobId) => {
    const id = jobIdString(jobId);
    try {
        const { data } = await axios.get(`${baseUrl()}/internal/jobs/${id}`, requestOptions());
        if (data?.errCode !== 0 || !data.data || jobIdString(data.data.id) !== id ||
            typeof data.data.statusCode !== 'string' || !data.data.statusCode) {
            throw new Error('Invalid current-job response from Job Core');
        }
        return data.data;
    } catch (error) {
        // A missing route, 401/403, timeout or server error is NOT a deleted job.
        if (error.response?.status === 404 && error.response.data?.errCode === 2) return null;
        throw error;
    }
};

export const listCurrentJobIds = async (companyId) => {
    const company = companyId === undefined ? undefined : jobIdString(companyId);
    const { data } = await axios.get(`${baseUrl()}/internal/jobs`, { ...requestOptions(), timeout: 30000 });
    if (data?.errCode !== 0 || !Array.isArray(data.data)) throw new Error('Invalid job-list response from Job Core');
    // This snapshot discovers IDs only. Every job is read again immediately
    // before its guarded projection write; never bulk-write this old snapshot.
    return data.data.filter((job) => company === undefined || String(job.companyId) === company)
        .map((job) => jobIdString(job.id));
};
