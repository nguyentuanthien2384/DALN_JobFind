import React from 'react';
import { useFetchAllcode } from '../../../util/fetch';
import { jobLabel } from '../../../util/jobLocale';
import './LeftBar.css';

const Checkboxes = ({ title, rows, selected = [], onChange }) => (
    <fieldset className="job-filter-options">
        <legend>{title}</legend>
        {rows.map(row => (
            <label className="job-filter-option" key={row.code}>
                <input type="checkbox" value={row.code} checked={selected.includes(row.code)}
                    onChange={event => onChange(event.target.value)} />
                <span>{jobLabel(row)}</span>
            </label>
        ))}
    </fieldset>
);

const LeftBar = (props) => {
    const selected = props.selected || {};
    const { data: dataJobType } = useFetchAllcode('JOBTYPE', { retain: true });
    const { data: dataJobLevel } = useFetchAllcode('JOBLEVEL', { retain: true });
    const { data: dataSalaryType } = useFetchAllcode('SALARYTYPE', { retain: true });
    const { data: dataExpType } = useFetchAllcode('EXPTYPE', { retain: true });
    const { data: dataWorkType } = useFetchAllcode('WORKTYPE', { retain: true });
    const { data: dataJobLocation } = useFetchAllcode('PROVINCE', { retain: true });

    return (
        <aside className="job-filter-panel" aria-label="Bộ lọc việc làm">
            <section className="job-filter-section" aria-labelledby="job-filter-field-location">
                <h3 id="job-filter-field-location">Lĩnh vực và địa điểm</h3>
                <div className="job-filter-field">
                    <label htmlFor="job-filter-field">Lĩnh vực công việc</label>
                    <select id="job-filter-field" name="categoryJobCode" value={selected.jobType || ''}
                        onChange={event => props.recieveJobType(event.target.value)}>
                        <option value="">Tất cả lĩnh vực</option>
                        {dataJobType.map(row => <option value={row.code} key={row.code}>{jobLabel(row)}</option>)}
                    </select>
                </div>
                <div className="job-filter-field">
                    <label htmlFor="job-filter-location">Địa điểm làm việc</label>
                    <select id="job-filter-location" name="addressCode" value={selected.jobLocation || ''}
                        onChange={event => props.recieveLocation(event.target.value)}>
                        <option value="">Tất cả địa điểm</option>
                        {dataJobLocation.map(row => <option value={row.code} key={row.code}>{jobLabel(row)}</option>)}
                    </select>
                </div>
            </section>

            <section className="job-filter-section" aria-labelledby="job-filter-conditions">
                <h3 id="job-filter-conditions">Điều kiện làm việc</h3>
                <Checkboxes title="Hình thức làm việc" rows={dataWorkType}
                    selected={selected.workType} onChange={props.worktype} />
                <Checkboxes title="Mức lương" rows={dataSalaryType}
                    selected={selected.salary} onChange={props.recieveSalary} />
            </section>

            <section className="job-filter-section" aria-labelledby="job-filter-requirements">
                <h3 id="job-filter-requirements">Yêu cầu vị trí</h3>
                <Checkboxes title="Cấp bậc" rows={dataJobLevel}
                    selected={selected.jobLevel} onChange={props.recieveJobLevel} />
                <Checkboxes title="Kinh nghiệm làm việc" rows={dataExpType}
                    selected={selected.exp} onChange={props.recieveExp} />
            </section>
        </aside>
    );
};

export default LeftBar;
