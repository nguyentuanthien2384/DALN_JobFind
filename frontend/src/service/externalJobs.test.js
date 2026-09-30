import catalog from '../data/verifiedJobs.json';
import { externalAssetUrl, filterExternalJobs, isExternalJobExpired, vietnamDate } from './externalJobs';

const now = new Date('2026-09-29T12:00:00Z');
const vacancy = {id:'external-test', title:'Kỹ sư phần mềm', employer:'Công ty A',
    provinceCodes:['Hồ Chí Minh','Hà Nội'], sourceLocation:'Hà Nội hoặc Hồ Chí Minh', summary:'Phát triển phần mềm',
    categoryJobCode:'cong-nghe-thong-tin', categoryJoblevelCode:'nhan-vien', salaryJobCode:null,
    deadline:'2026-09-29'};

test('a deadline remains open through the last second of its date in Vietnam', () => {
    expect(isExternalJobExpired(vacancy, new Date('2026-09-29T16:59:59Z'))).toBe(false);
    expect(isExternalJobExpired(vacancy, new Date('2026-09-29T17:00:00Z'))).toBe(true);
    expect(vietnamDate(new Date('2026-09-29T17:00:00Z'))).toBe('2026-09-30');
    expect(isExternalJobExpired({...vacancy,deadline:null}, now)).toBe(false);
});

test('multi-province source appears once and supports old province aliases', () => {
    expect(filterExternalJobs({addressCode:['Hà Nội','Hồ Chí Minh']},now,[vacancy])).toEqual([vacancy]);
    expect(filterExternalJobs({addressCode:'Bình Dương'},now,[vacancy])).toEqual([vacancy]);
    expect(filterExternalJobs({addressCode:'Tỉnh Bình Dương'},now,[vacancy])).toEqual([vacancy]);
    expect(filterExternalJobs({addressCode:'Lai Châu'},now,[vacancy])).toEqual([]);
});

test('search ignores Vietnamese accents and intersects all selected filters', () => {
    expect(filterExternalJobs({search:'ky su cong ty',categoryJobCode:'cong-nghe-thong-tin'},now,[vacancy])).toEqual([vacancy]);
    expect(filterExternalJobs({search:'ky su',categoryJoblevelCode:['truong-phong','nhan-vien']},now,[vacancy])).toEqual([vacancy]);
    expect(filterExternalJobs({categoryJobCode:'kinh-te'},now,[vacancy])).toEqual([]);
    expect(filterExternalJobs({salaryJobCode:['thoa-thuan']},now,[vacancy])).toEqual([]);
});

test('vacancies removed from or closed at their source never appear in searches', () => {
    expect(filterExternalJobs({}, now, [{...vacancy, deadline:'2026-10-30', sourceStatus:'removed'}])).toEqual([]);
    expect(filterExternalJobs({}, now, [{...vacancy, deadline:'2026-10-30', sourceStatus:'closed'}])).toEqual([]);
    expect(filterExternalJobs({}, now, [{...vacancy, deadline:'2026-10-30', sourceStatus:'open'}])).toHaveLength(1);
    expect(catalog.jobs.filter(job => job.sourceStatus === 'removed').every(job => !filterExternalJobs({}, now).includes(job))).toBe(true);
});

test('source images are served only from the local external-jobs folder', () => {
    expect(externalAssetUrl('/external-jobs/logos/vnpt.png')).toBe('/external-jobs/logos/vnpt.png');
    for (const path of ['https://cdn.example.test/logo.png', '/external-jobs/../index.html', 'external-jobs/a.png', null]) {
        expect(externalAssetUrl(path)).toBeNull();
    }
});

test('every listed vacancy carries source sections and points at existing local images', () => {
    const listed = catalog.jobs.filter(job => ['open', 'deadline-not-published'].includes(job.sourceStatus));
    expect(listed.length).toBeGreaterThan(0);
    for (const job of listed) {
        expect(job.sections.length).toBeGreaterThan(0);
        for (const path of [job.logo, job.coverImage, job.jobImage?.src].filter(Boolean)) expect(externalAssetUrl(path)).not.toBeNull();
    }
});

test('expired jobs leave active searches and each current province had a sourced match when checked', () => {
    expect(filterExternalJobs({},new Date('2026-09-30T00:00:00Z'),[vacancy])).toEqual([]);
    const checked = new Date(`${catalog.checkedAt}T05:00:00Z`);
    expect(catalog.provinces).toHaveLength(34);
    for (const province of catalog.provinces) {
        expect(filterExternalJobs({addressCode:province.code},checked).length).toBeGreaterThan(0);
    }
});
