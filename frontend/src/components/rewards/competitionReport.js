const CRITERIA = [
    { key: 'skills', label: 'Kỹ năng' },
    { key: 'experience', label: 'Kinh nghiệm', overview: 'experienceLabel' },
    { key: 'category', label: 'Ngành nghề', overview: 'categoryLabel' },
    { key: 'location', label: 'Địa điểm', overview: 'locationLabel' },
];

export const COMPARISON_STATUS = {
    met: { label: 'Phù hợp', tone: 'emerald' },
    partial: { label: 'Khớp một phần', tone: 'amber' },
    unmatched: { label: 'Cần xem lại', tone: 'amber' },
    missing: { label: 'Cần bổ sung', tone: 'neutral' },
    not_required: { label: 'Không yêu cầu', tone: 'neutral' },
    not_identified: { label: 'Chưa đủ dữ liệu từ tin đăng', tone: 'neutral' },
};

const skillsFrom = (value) => Array.isArray(value)
    ? value.map((skill) => typeof skill === 'string' ? { name: skill } : skill)
        .filter((skill) => typeof skill?.name === 'string' && skill.name.trim())
    : [];
const sameSkill = (left, right) => {
    const leftId = left.id ?? left.skillId;
    const rightId = right.id ?? right.skillId;
    if (leftId != null && leftId !== '' && rightId != null && rightId !== '') {
        return String(leftId) === String(rightId);
    }
    return left.name.trim().toLocaleLowerCase('vi-VN') === right.name.trim().toLocaleLowerCase('vi-VN');
};

// Older API payloads can lack display labels. Preserve their explicit statuses
// and skills, but never infer candidate values by parsing descriptive sentences.
export const getProfileComparison = (report = {}) => {
    const legacy = report.profileMatch || {};
    const comparison = report.profileComparison || {};
    const requiredSkills = skillsFrom(comparison.requiredSkills ?? legacy.requiredSkills);
    const unrecordedSkills = skillsFrom(comparison.unrecordedSkills ?? legacy.missingSkills);
    const missingKnown = Array.isArray(comparison.unrecordedSkills ?? legacy.missingSkills);
    const matchedSkills = Array.isArray(comparison.matchedSkills)
        ? skillsFrom(comparison.matchedSkills)
        : missingKnown ? requiredSkills.filter((skill) => !unrecordedSkills.some((missing) => sameSkill(skill, missing))) : [];
    const rows = Array.isArray(comparison.criteria) ? comparison.criteria
        : Array.isArray(legacy.criteria) ? legacy.criteria : [];
    const overview = report.jobOverview || {};
    const criteria = CRITERIA.map((definition) => {
        const row = rows.find((item) => item.key === definition.key);
        let requirementStatus = row?.requirementStatus ||
            (!row || row.status === 'not_identified' ? 'not_identified'
                : row.status === 'not_required' ? 'not_required' : 'identified');
        if (definition.key === 'skills' && !row?.requirementStatus &&
            (legacy.requiredSkillStatus === 'not_identified' || requiredSkills.length === 0)) {
            requirementStatus = 'not_identified';
        }
        const status = requirementStatus !== 'identified' ? requirementStatus
            : COMPARISON_STATUS[row?.status] ? row.status : 'missing';
        const fallbackRequired = definition.key === 'skills'
            ? requiredSkills.length ? `${requiredSkills.length} kỹ năng được nhắc tới` : 'Chưa công bố kỹ năng cụ thể'
            : overview[definition.overview] || 'Chưa có dữ liệu yêu cầu';
        return {
            key: definition.key,
            label: definition.label,
            status,
            requirementStatus,
            requiredLabel: row?.requiredLabel || fallbackRequired,
            candidateLabel: row?.candidateLabel ||
                (definition.key === 'skills' && requiredSkills.length && missingKnown
                    ? `Khớp ${matchedSkills.length}/${requiredSkills.length} kỹ năng` : 'Chưa có dữ liệu chi tiết'),
        };
    });
    // Count only requirements the posting actually states. An unknown or
    // unnecessary requirement must never look like a successful match.
    const metCriteriaCount = criteria.filter((row) => row.requirementStatus === 'identified' && row.status === 'met').length;
    const needsUpdateCount = criteria.filter((row) => row.requirementStatus === 'identified' && row.status === 'missing').length;
    return {
        criteria, requiredSkills, matchedSkills, unrecordedSkills,
        metCriteriaCount, needsUpdateCount, skillComparisonKnown: missingKnown,
    };
};
