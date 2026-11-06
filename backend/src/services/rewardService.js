import db from '../models/index';
import { createSkillMatcher, prepareSkillText } from '../utils/skillMatch';
const { Op } = require('sequelize');
const {
    POINT_VALUE_VND,
    CANDIDATE_TOPUP_PACKAGES,
    CANDIDATE_EARN_RULES,
    COMPETITION_REPORT,
    CANDIDATE_TIERS,
    EMPLOYER_REWARDS,
    USD_VND_RATE,
    tierFor
} = require('../config/rewards');

const OWNER_CANDIDATE = 'CANDIDATE';
const OWNER_COMPANY = 'COMPANY';

// Ngay hien tai theo mui gio Viet Nam (GMT+7) dang YYYY-MM-DD de tinh diem danh hang ngay.
const todayVietnam = (date = new Date()) => {
    const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
};

const runInTransaction = async (externalTransaction, callback) => {
    if (externalTransaction) return callback(externalTransaction);
    if (typeof db.sequelize?.transaction === 'function') {
        return db.sequelize.transaction(callback);
    }
    return callback({ LOCK: { UPDATE: 'UPDATE' } });
};

const getOrCreateWallet = async (ownerType, ownerId, transaction) => {
    const normalizedOwnerId = Number(ownerId);
    const options = transaction
        ? { where: { ownerType, ownerId: normalizedOwnerId }, transaction, lock: transaction.LOCK?.UPDATE, raw: false }
        : { where: { ownerType, ownerId: normalizedOwnerId }, raw: false };
    let wallet = await db.RewardWallet.findOne(options);
    if (!wallet) {
        try {
            wallet = await db.RewardWallet.create({
                ownerType,
                ownerId: normalizedOwnerId,
                balance: 0,
                lifetimeEarned: 0,
                lifetimeSpent: 0
            }, transaction ? { transaction } : undefined);
        } catch (error) {
            wallet = await db.RewardWallet.findOne(options);
            if (!wallet) throw error;
        }
    }
    return wallet;
};

// Ghi nhan cong diem idempotent: neu idempotencyKey da ton tai thi tra ve giao dich cu,
// khong cong trung lan 2.
const creditWallet = async ({
    ownerType,
    ownerId,
    amount,
    reasonCode,
    description,
    refType = null,
    refId = null,
    idempotencyKey
}, externalTransaction = null) => {
    const points = Number(amount);
    if (!ownerType || !ownerId || !Number.isInteger(points) || points <= 0 || !reasonCode || !idempotencyKey) {
        return { errCode: 1, errMessage: 'Missing required parameters !' };
    }

    return runInTransaction(externalTransaction, async (transaction) => {
        const existing = await db.RewardTransaction.findOne({
            where: { idempotencyKey: String(idempotencyKey) },
            transaction
        });
        const wallet = await getOrCreateWallet(ownerType, ownerId, transaction);
        if (existing) {
            return { errCode: 0, alreadyProcessed: true, wallet, transaction: existing };
        }

        const nextBalance = Number(wallet.balance || 0) + points;
        wallet.balance = nextBalance;
        wallet.lifetimeEarned = Number(wallet.lifetimeEarned || 0) + points;
        await wallet.save({ transaction });

        const record = await db.RewardTransaction.create({
            walletId: wallet.id,
            direction: 'CREDIT',
            amount: points,
            balanceAfter: nextBalance,
            reasonCode,
            description: description || reasonCode,
            refType: refType ? String(refType) : null,
            refId: refId !== undefined && refId !== null ? String(refId) : null,
            idempotencyKey: String(idempotencyKey)
        }, { transaction });

        return { errCode: 0, alreadyProcessed: false, wallet, transaction: record };
    });
};

// Tru diem co khoa dong (FOR UPDATE): khong bao gio de so du am.
const debitWallet = async ({
    ownerType,
    ownerId,
    amount,
    reasonCode,
    description,
    refType = null,
    refId = null,
    idempotencyKey
}, externalTransaction = null) => {
    const points = Number(amount);
    if (!ownerType || !ownerId || !Number.isInteger(points) || points <= 0 || !reasonCode || !idempotencyKey) {
        return { errCode: 1, errMessage: 'Missing required parameters !' };
    }

    return runInTransaction(externalTransaction, async (transaction) => {
        const existing = await db.RewardTransaction.findOne({
            where: { idempotencyKey: String(idempotencyKey) },
            transaction
        });
        const wallet = await getOrCreateWallet(ownerType, ownerId, transaction);
        if (existing) {
            return { errCode: 0, alreadyProcessed: true, wallet, transaction: existing };
        }

        const currentBalance = Number(wallet.balance || 0);
        if (currentBalance < points) {
            return {
                errCode: 2,
                insufficientBalance: true,
                balance: currentBalance,
                required: points,
                errMessage: `Số dư điểm không đủ (cần ${points} điểm, hiện có ${currentBalance} điểm)`
            };
        }

        const nextBalance = currentBalance - points;
        wallet.balance = nextBalance;
        wallet.lifetimeSpent = Number(wallet.lifetimeSpent || 0) + points;
        await wallet.save({ transaction });

        const record = await db.RewardTransaction.create({
            walletId: wallet.id,
            direction: 'DEBIT',
            amount: points,
            balanceAfter: nextBalance,
            reasonCode,
            description: description || reasonCode,
            refType: refType ? String(refType) : null,
            refId: refId !== undefined && refId !== null ? String(refId) : null,
            idempotencyKey: String(idempotencyKey)
        }, { transaction });

        return { errCode: 0, alreadyProcessed: false, wallet, transaction: record };
    });
};

// Tinh do hoan thien ho so ung vien (0..100%) dua tren User + UserSetting + UserSkill.
const evaluateCandidateProfileCompletion = async (userId) => {
    const [user, setting, skillCount] = await Promise.all([
        db.User?.findOne ? db.User.findOne({ where: { id: userId }, attributes: ['id', 'firstName', 'lastName', 'email', 'address', 'dob'] }) : null,
        db.UserSetting?.findOne ? db.UserSetting.findOne({ where: { userId } }) : null,
        db.UserSkill?.count ? db.UserSkill.count({ where: { UserId: userId } }) : 0
    ]);
    const checks = [
        Boolean(user?.firstName && user?.lastName),
        Boolean(user?.email),
        Boolean(user?.address),
        Boolean(setting?.categoryJobCode && setting?.addressCode),
        Boolean(setting?.experienceJobCode && setting?.salaryJobCode),
        Boolean(setting?.file || Number(skillCount) > 0)
    ];
    const passed = checks.filter(Boolean).length;
    const percent = Math.round((passed / checks.length) * 100);
    return { percent, isComplete: passed >= 5 };
};

const formatTransactionsForClient = (rows = []) => (rows || []).map((item) => {
    const raw = typeof item?.toJSON === 'function' ? item.toJSON() : { ...item };
    const amount = Number(raw.amount || 0);
    const pointsDelta = raw.direction === 'DEBIT' ? -amount : amount;
    return {
        ...raw,
        pointsDelta,
        transactionType: raw.reasonCode || raw.transactionType || 'REWARD'
    };
});

const syncCandidateApplicationRewards = async (userId) => {
    if (!db.Cv?.findAll) return;
    const submittedCvs = await db.Cv.findAll({
        where: { userId: Number(userId) },
        attributes: ['id', 'postId'],
        order: [['id', 'ASC']]
    });
    const postIds = [...new Set((submittedCvs || []).map((cv) => cv.postId).filter(Boolean))];
    if (!postIds.length) return;

    const candidateKeys = postIds.map((postId) => `CANDIDATE:APPLY:${userId}:${postId}`);
    const existingRows = db.RewardTransaction?.findAll
        ? await db.RewardTransaction.findAll({
            where: { idempotencyKey: { [Op.in]: candidateKeys } },
            attributes: ['idempotencyKey'],
            raw: true
        })
        : [];
    const existingKeys = new Set((existingRows || []).map((row) => row?.idempotencyKey).filter(Boolean));

    for (const postId of postIds) {
        if (!existingKeys.has(`CANDIDATE:APPLY:${userId}:${postId}`)) {
            await awardCandidateApplicationPoints({ userId, postId });
        }
    }
};

const getCandidateRewardOverview = async (userId) => {
    if (!userId) return { errCode: 1, errMessage: 'Missing required parameters !' };

    await syncCandidateApplicationRewards(userId);
    const wallet = await getOrCreateWallet(OWNER_CANDIDATE, userId);
    const today = todayVietnam();
    const checkinKey = `CANDIDATE:CHECKIN:${userId}:${today}`;
    const profileKey = `CANDIDATE:PROFILE_COMPLETE:${userId}`;

    const [checkinTx, profileTx, profileStatus, recentTransactions] = await Promise.all([
        db.RewardTransaction.findOne({ where: { idempotencyKey: checkinKey } }),
        db.RewardTransaction.findOne({ where: { idempotencyKey: profileKey } }),
        evaluateCandidateProfileCompletion(userId),
        db.RewardTransaction.findAll({
            where: { walletId: wallet.id },
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            limit: 15
        })
    ]);

    const balance = Number(wallet.balance || 0);
    const lifetimeEarned = Number(wallet.lifetimeEarned || 0);
    const lifetimeSpent = Number(wallet.lifetimeSpent || 0);
    const tier = tierFor(CANDIDATE_TIERS, lifetimeEarned);
    const formattedTransactions = formatTransactionsForClient(recentTransactions);

    return {
        errCode: 0,
        data: {
            wallet: {
                id: wallet.id,
                balance,
                balancePoints: balance,
                balanceXu: balance * POINT_VALUE_VND,
                valueVnd: balance * POINT_VALUE_VND,
                pointValueVnd: POINT_VALUE_VND,
                tierLabel: tier.name,
                tierShortLabel: tier.name,
                lifetimeEarned,
                lifetimeSpent
            },
            tier,
            missions: {
                checkedInToday: Boolean(checkinTx),
                profileCompletionClaimed: Boolean(profileTx),
                profileCompletionPercent: profileStatus.percent,
                profileCompletionEligible: profileStatus.isComplete
            },
            earnRules: {
                applyJob: { points: CANDIDATE_EARN_RULES.APPLY_JOB, label: 'Nộp CV vào vị trí tuyển dụng' },
                dailyCheckin: {
                    points: CANDIDATE_EARN_RULES.DAILY_CHECKIN,
                    claimedToday: Boolean(checkinTx),
                    date: today,
                    label: 'Điểm danh hằng ngày'
                },
                profileComplete: {
                    points: CANDIDATE_EARN_RULES.PROFILE_COMPLETE,
                    claimed: Boolean(profileTx),
                    completionPercent: profileStatus.percent,
                    eligible: profileStatus.isComplete,
                    label: 'Hoàn thiện hồ sơ & CV'
                }
            },
            competitionReport: COMPETITION_REPORT,
            packages: CANDIDATE_TOPUP_PACKAGES,
            recentTransactions,
            transactions: formattedTransactions
        }
    };
};

const getCandidateTransactions = async ({ userId, limit = 20, offset = 0 }) => {
    if (!userId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const wallet = await getOrCreateWallet(OWNER_CANDIDATE, userId);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const result = await db.RewardTransaction.findAndCountAll({
        where: { walletId: wallet.id },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: safeLimit,
        offset: safeOffset
    });
    return {
        errCode: 0,
        data: result.rows,
        count: result.count,
        wallet: {
            balance: Number(wallet.balance || 0),
            valueVnd: Number(wallet.balance || 0) * POINT_VALUE_VND,
            tier: tierFor(CANDIDATE_TIERS, wallet.lifetimeEarned)
        }
    };
};

const claimDailyCheckin = async (userId) => {
    if (!userId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const today = todayVietnam();
    const result = await creditWallet({
        ownerType: OWNER_CANDIDATE,
        ownerId: userId,
        amount: CANDIDATE_EARN_RULES.DAILY_CHECKIN,
        reasonCode: 'DAILY_CHECKIN',
        description: `Điểm danh hằng ngày (${today})`,
        refType: 'DATE',
        refId: today,
        idempotencyKey: `CANDIDATE:CHECKIN:${userId}:${today}`
    });
    if (result.errCode !== 0) return result;
    if (result.alreadyProcessed) {
        return {
            errCode: 2,
            alreadyClaimed: true,
            balance: Number(result.wallet.balance || 0),
            errMessage: 'Hôm nay bạn đã điểm danh nhận điểm rồi'
        };
    }
    return {
        errCode: 0,
        pointsAdded: CANDIDATE_EARN_RULES.DAILY_CHECKIN,
        balance: Number(result.wallet.balance || 0),
        errMessage: `Điểm danh thành công! Bạn nhận được +${CANDIDATE_EARN_RULES.DAILY_CHECKIN} Điểm thưởng`
    };
};

const claimProfileCompleteBonus = async (userId) => {
    if (!userId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const status = await evaluateCandidateProfileCompletion(userId);
    if (!status.isComplete) {
        return {
            errCode: 2,
            completionPercent: status.percent,
            errMessage: `Hồ sơ hiện đạt ${status.percent}%. Hãy cập nhật đầy đủ thông tin và kỹ năng/CV để nhận +${CANDIDATE_EARN_RULES.PROFILE_COMPLETE} điểm`
        };
    }
    const result = await creditWallet({
        ownerType: OWNER_CANDIDATE,
        ownerId: userId,
        amount: CANDIDATE_EARN_RULES.PROFILE_COMPLETE,
        reasonCode: 'PROFILE_COMPLETE',
        description: 'Thưởng hoàn thiện 100% hồ sơ ứng viên',
        refType: 'USER',
        refId: userId,
        idempotencyKey: `CANDIDATE:PROFILE_COMPLETE:${userId}`
    });
    if (result.alreadyProcessed) {
        return {
            errCode: 2,
            alreadyClaimed: true,
            balance: Number(result.wallet.balance || 0),
            errMessage: 'Bạn đã nhận thưởng hoàn thiện hồ sơ trước đó'
        };
    }
    return {
        errCode: 0,
        pointsAdded: CANDIDATE_EARN_RULES.PROFILE_COMPLETE,
        balance: Number(result.wallet.balance || 0),
        errMessage: `Chúc mừng! Bạn nhận được +${CANDIDATE_EARN_RULES.PROFILE_COMPLETE} Điểm thưởng hoàn thiện hồ sơ`
    };
};

// Tu dong cong +5 diem khi ung vien nop CV thanh cong vao mot tin tuyen dung.
const awardCandidateApplicationPoints = async ({ userId, postId }, externalTransaction = null) => {
    if (!userId || !postId) return null;
    return creditWallet({
        ownerType: OWNER_CANDIDATE,
        ownerId: userId,
        amount: CANDIDATE_EARN_RULES.APPLY_JOB,
        reasonCode: 'APPLY_JOB',
        description: `Thưởng nộp CV ứng tuyển tin #${postId}`,
        refType: 'POST',
        refId: postId,
        idempotencyKey: `CANDIDATE:APPLY:${userId}:${postId}`
    }, externalTransaction);
};

// Phan loai nhom kinh nghiem ("under3" | "threeToFive" | "over5") tu code hoac chuoi mo ta.
const classifyExperienceBucket = (codeOrValue) => {
    const text = String(codeOrValue || '').toLowerCase();
    if (!text) return null;
    if (/khong|chua|duoi\s*1|1\s*nam|2\s*nam|1-2|0-1|intern|fresher|junior/i.test(text)) return 'under3';
    if (/3\s*nam|4\s*nam|5\s*nam|3-5|2-4|3-4|middle|senior/i.test(text)) return 'threeToFive';
    if (/tren\s*5|5\+|6|7|8|10|lead|manager|principal/i.test(text)) return 'over5';
    return null;
};

// Uoc luong dai luong ky vong (trieu VND) tu ma luong hoac nhan luong cua tin tuyen dung.
const deriveSalaryInsights = (salaryCode, salaryLabel) => {
    const raw = `${salaryCode || ''} ${salaryLabel || ''}`;
    const numbers = (raw.match(/\d+(?:[.,]\d+)?/g) || [])
        .map((val) => Number(val.replace(',', '.')))
        .filter((num) => Number.isFinite(num) && num > 0 && num < 500);
    if (numbers.length >= 2) {
        const min = Math.min(numbers[0], numbers[1]);
        const max = Math.max(numbers[0], numbers[1]);
        const avg = Number(((min + max) / 2).toFixed(1));
        const sugMin = Math.round(min + (max - min) * 0.35);
        const sugMax = Math.round(min + (max - min) * 0.75);
        return {
            averageMillion: avg,
            rangeLabel: `Dải: ${min} - ${max} triệu`,
            suggestedLabel: `${sugMin} - ${sugMax} Triệu`
        };
    }
    if (numbers.length === 1) {
        const base = numbers[0];
        const min = Math.max(8, Math.round(base * 0.8));
        const max = Math.round(base * 1.2);
        return {
            averageMillion: Number(base.toFixed(1)),
            rangeLabel: `Dải: ${min} - ${max} triệu`,
            suggestedLabel: `${Math.round(base * 0.9)} - ${Math.round(base * 1.1)} Triệu`
        };
    }
    return {
        averageMillion: 24.5,
        rangeLabel: 'Dải: 18 - 32 triệu',
        suggestedLabel: '22 - 28 Triệu'
    };
};

// Xay dung Bao Cao Ung Tuyen & Ti Le Canh Tranh (giong TopCV & design10).
// Chi tiet ca nhan / file CV cua ung vien khac TUYET DOI KHONG bao gio tra ra ngoai.
const buildCompetitionInsights = async ({ post, detail, cvs, userId }) => {
    const totalApplicants = cvs.length;
    const targetAmount = Math.max(1, Number(detail?.amount) || 1);
    const ratioRight = totalApplicants === 0 ? 1 : Math.max(1, Math.round(totalApplicants / targetAmount));
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const todayApplicants = cvs.filter((cv) => cv.createdAt && new Date(cv.createdAt).getTime() >= dayAgo).length;

    const applicantIds = [...new Set(cvs.map((cv) => Number(cv.userId)).filter(Boolean))];
    const settings = applicantIds.length && db.UserSetting?.findAll
        ? await db.UserSetting.findAll({
            where: { userId: { [Op.in]: applicantIds } },
            include: db.Allcode ? [{ model: db.Allcode, as: 'expTypeSettingData', attributes: ['code', 'value'] }] : []
        })
        : [];

    const counts = { under3: 0, threeToFive: 0, over5: 0 };
    settings.forEach((setting) => {
        const bucket = classifyExperienceBucket(setting.expTypeSettingData?.value || setting.experienceJobCode);
        if (bucket) counts[bucket] += 1;
    });
    const classified = counts.under3 + counts.threeToFive + counts.over5;
    if (totalApplicants > classified) {
        const rem = totalApplicants - classified;
        const b2 = Math.round(rem * 0.56);
        const b3 = Math.round(rem * 0.26);
        const b1 = Math.max(0, rem - b2 - b3);
        counts.under3 += b1;
        counts.threeToFive += b2;
        counts.over5 += b3;
    }

    const pct = (value) => (totalApplicants > 0 ? Math.round((value / totalApplicants) * 100) : 0);
    const pUnder3 = pct(counts.under3);
    const pOver5 = pct(counts.over5);
    const pMid = totalApplicants > 0 ? Math.max(0, 100 - pUnder3 - pOver5) : 0;

    // So khop ho so cua ung vien hien tai voi JD
    const categoryCode = detail?.categoryJobCode;
    const [allSkills, userSkills, userSetting] = await Promise.all([
        categoryCode && db.Skill?.findAll ? db.Skill.findAll({ where: { categoryJobCode: categoryCode } }) : [],
        userId && db.UserSkill?.findAll ? db.UserSkill.findAll({ where: { UserId: userId } }) : [],
        userId && db.UserSetting?.findOne ? db.UserSetting.findOne({
            where: { userId },
            include: db.Allcode ? [{ model: db.Allcode, as: 'expTypeSettingData', attributes: ['code', 'value'] }] : []
        }) : null
    ]);

    const jdText = prepareSkillText(`${detail?.name || ''} ${detail?.descriptionHTML || ''}`);
    const requiredSkills = (allSkills || []).filter((skill) => {
        const matcher = createSkillMatcher(skill.name);
        return matcher && matcher.matches(jdText);
    });
    const ownedSkillIds = new Set((userSkills || []).map((item) => Number(item.SkillId ?? item.skillId)));
    const matchedSkills = requiredSkills.filter((skill) => ownedSkillIds.has(Number(skill.id)));
    const focusSkills = (requiredSkills.length ? requiredSkills : (allSkills || []).slice(0, 3)).slice(0, 3);
    const skillNames = focusSkills.map((item) => item.name).join(', ') || detail?.jobTypePostData?.value || 'Kỹ năng chuyên môn';

    let skillRatio = requiredSkills.length > 0 ? matchedSkills.length / requiredSkills.length : (ownedSkillIds.size > 0 ? 0.85 : 0.75);
    skillRatio = Math.min(1, Math.max(0.55, skillRatio));
    const expMatch = !detail?.experienceJobCode || !userSetting?.experienceJobCode
        || detail.experienceJobCode === userSetting.experienceJobCode;
    const matchPercent = Math.min(98, Math.max(62, Math.round(skillRatio * 70 + (expMatch ? 24 : 16))));
    const topPercentile = matchPercent >= 88 ? 15 : matchPercent >= 80 ? 25 : 35;

    const userBucket = classifyExperienceBucket(userSetting?.expTypeSettingData?.value || userSetting?.experienceJobCode) || 'threeToFive';
    const salary = deriveSalaryInsights(detail?.salaryJobCode, detail?.salaryTypePostData?.value);
    const requiredExpLabel = detail?.expTypePostData?.value || '2 - 3 năm';
    const userExpLabel = userSetting?.expTypeSettingData?.value || requiredExpLabel;

    return {
        postId: Number(post.id),
        totalApplicants,
        todayApplicants,
        targetAmount,
        competitionRatio: `1 : ${ratioRight}`,
        salaryRange: salary,
        profileMatch: {
            matchPercent,
            rankLabel: `Top ${topPercentile}% ứng viên`,
            ratingBadge: matchPercent >= 85 ? 'Rất cao' : 'Khá cao',
            coreSkillsLabel: `Kỹ năng cốt lõi (${skillNames})`,
            coreSkillsMatch: `${Math.round(skillRatio * 100)}% Khớp`,
            experienceRequiredLabel: `Kinh nghiệm yêu cầu (${requiredExpLabel})`,
            experienceUserLabel: expMatch ? `Đạt (${userExpLabel})` : `Cần bổ sung (${userExpLabel})`,
            suggestedSalaryLabel: salary.suggestedLabel
        },
        experienceBreakdown: [
            {
                key: 'under3',
                label: 'Dưới 3 năm kinh nghiệm',
                percent: pUnder3,
                count: counts.under3,
                isUserGroup: userBucket === 'under3',
                highlight: userBucket === 'under3',
                colorClass: '#94a3b8'
            },
            {
                key: 'threeToFive',
                label: '3 - 5 năm kinh nghiệm',
                percent: pMid,
                count: counts.threeToFive,
                isUserGroup: userBucket === 'threeToFive',
                highlight: userBucket === 'threeToFive',
                colorClass: '#004ac6'
            },
            {
                key: 'over5',
                label: 'Trên 5 năm kinh nghiệm',
                percent: pOver5,
                count: counts.over5,
                isUserGroup: userBucket === 'over5',
                highlight: userBucket === 'over5',
                colorClass: '#6366f1'
            }
        ],
        aiCorrelation: [
            {
                label: `Kỹ năng cốt lõi (${skillNames})`,
                status: `${Math.round(skillRatio * 100)}% Khớp`,
                tone: 'emerald'
            },
            {
                label: `Kinh nghiệm yêu cầu (${requiredExpLabel})`,
                status: expMatch ? `Đạt (${userExpLabel})` : `Cần bổ sung (${userExpLabel})`,
                tone: expMatch ? 'emerald' : 'amber'
            },
            {
                label: 'Mức lương đề xuất cạnh tranh',
                status: salary.suggestedLabel,
                tone: 'amber'
            }
        ],
        tacticalTip: `Nhóm 3-5 năm chiếm ưu thế (${pMid}%). Nêu bật kinh nghiệm thực tế với ${skillNames} trong CV sẽ giúp bạn tăng khả năng vào vòng phỏng vấn!`
    };
};

const loadPostWithDetail = (postId) => db.Post.findOne({
    where: { id: Number(postId) },
    include: [{
        model: db.DetailPost,
        as: 'postDetailData',
        include: [
            { model: db.Allcode, as: 'jobTypePostData', attributes: ['value', 'code'] },
            { model: db.Allcode, as: 'salaryTypePostData', attributes: ['value', 'code'] },
            { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] }
        ]
    }]
});

const getJobCompetitionReport = async ({ postId, userId }) => {
    if (!postId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const post = await loadPostWithDetail(postId);
    if (!post) return { errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' };

    const detail = post.postDetailData || {};
    const cvs = await db.Cv.findAll({
        where: { postId: Number(postId) },
        attributes: ['id', 'userId', 'createdAt']
    });

    let activeUnlock = null;
    let walletBalance = 0;
    if (userId) {
        const [unlock, wallet] = await Promise.all([
            db.CompetitionUnlock.findOne({
                where: {
                    userId: Number(userId),
                    postId: Number(postId),
                    expiresAt: { [Op.gt]: new Date() }
                },
                order: [['expiresAt', 'DESC']]
            }),
            getOrCreateWallet(OWNER_CANDIDATE, userId)
        ]);
        activeUnlock = unlock;
        walletBalance = Number(wallet?.balance || 0);
    }

    const insights = await buildCompetitionInsights({ post, detail, cvs, userId });
    const unlocked = Boolean(activeUnlock);

    return {
        errCode: 0,
        data: {
            postId: Number(post.id),
            unlocked,
            expiresAt: activeUnlock?.expiresAt || null,
            unlockCost: COMPETITION_REPORT.unlockCost,
            unlockCostPoints: COMPETITION_REPORT.unlockCost,
            validDays: COMPETITION_REPORT.validDays,
            unlockTtlDays: COMPETITION_REPORT.validDays,
            walletBalance,
            walletBalancePoints: walletBalance,
            totalApplicants: insights.totalApplicants,
            todayApplicants: insights.todayApplicants,
            targetAmount: insights.targetAmount,
            hiringTarget: insights.targetAmount,
            competitionRatio: insights.competitionRatio,
            expectedSalaryAvgMillion: unlocked ? insights.salaryRange.averageMillion : null,
            expectedSalaryRangeLabel: unlocked ? insights.salaryRange.rangeLabel : null,
            profileMatchPercent: insights.profileMatch.matchPercent,
            profileRankLabel: insights.profileMatch.rankLabel,
            // Chi tra du lieu phan tich sau khi da mo khoa (hoac preview co ban).
            salaryRange: unlocked ? insights.salaryRange : null,
            profileMatch: unlocked ? insights.profileMatch : {
                matchPercent: insights.profileMatch.matchPercent,
                rankLabel: insights.profileMatch.rankLabel
            },
            experienceBreakdown: unlocked ? insights.experienceBreakdown : null,
            aiCorrelation: unlocked ? insights.aiCorrelation : null,
            tacticalTip: unlocked ? insights.tacticalTip : null
        }
    };
};

const unlockJobCompetitionReport = async ({ postId, userId }) => {
    if (!postId || !userId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const post = await loadPostWithDetail(postId);
    if (!post) return { errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' };

    const existing = await db.CompetitionUnlock.findOne({
        where: {
            userId: Number(userId),
            postId: Number(postId),
            expiresAt: { [Op.gt]: new Date() }
        },
        order: [['expiresAt', 'DESC']]
    });
    if (existing) {
        const report = await getJobCompetitionReport({ postId, userId });
        return {
            ...report,
            alreadyUnlocked: true,
            errMessage: 'Báo cáo cạnh tranh của tin này đã được mở khóa'
        };
    }

    const expiresAt = new Date(Date.now() + COMPETITION_REPORT.validDays * 24 * 60 * 60 * 1000);
    const debitResult = await runInTransaction(null, async (transaction) => {
        const concurrent = await db.CompetitionUnlock.findOne({
            where: {
                userId: Number(userId),
                postId: Number(postId),
                expiresAt: { [Op.gt]: new Date() }
            },
            transaction
        });
        if (concurrent) return { errCode: 0, alreadyUnlocked: true };

        const windowBucket = Math.floor(Date.now() / (COMPETITION_REPORT.validDays * 24 * 60 * 60 * 1000));
        const debited = await debitWallet({
            ownerType: OWNER_CANDIDATE,
            ownerId: userId,
            amount: COMPETITION_REPORT.unlockCost,
            reasonCode: 'UNLOCK_COMPETITION_REPORT',
            description: `Mở khóa báo cáo cạnh tranh tin #${postId}`,
            refType: 'POST',
            refId: postId,
            idempotencyKey: `CANDIDATE:UNLOCK:${userId}:${postId}:${windowBucket}`
        }, transaction);
        if (debited.errCode !== 0) return debited;

        await db.CompetitionUnlock.create({
            userId: Number(userId),
            postId: Number(postId),
            transactionId: debited.transaction?.id || null,
            pointsSpent: COMPETITION_REPORT.unlockCost,
            expiresAt
        }, { transaction });
        return debited;
    });

    if (debitResult.errCode !== 0) return debitResult;

    const report = await getJobCompetitionReport({ postId, userId });
    return {
        ...report,
        data: report.data ? { ...report.data, report: report.data } : report.data,
        errMessage: `Đã mở khóa báo cáo cạnh tranh (-${COMPETITION_REPORT.unlockCost} Điểm)`
    };
};

// ===== NHA TUYEN DUNG: TOP POINT (JobFind Rewards giong TopCV Rewards) =====
const calculateEmployerTopPoints = (vndAmount, currentLifetimeEarned = 0) => {
    const rawVnd = Number(vndAmount) || 0;
    if (rawVnd <= 0) return 0;
    const basePoints = Math.max(1, Math.round(rawVnd / EMPLOYER_REWARDS.vndPerPoint));
    const currentTier = tierFor(EMPLOYER_REWARDS.tiers, currentLifetimeEarned);
    return Math.max(1, Math.round(basePoints * (Number(currentTier.multiplier) || 1)));
};

const awardEmployerPointsForPayment = async ({
    companyId,
    vndAmount,
    sourceType,
    sourceId,
    description
}, externalTransaction = null) => {
    if (!companyId || !sourceType || !sourceId) return null;
    const wallet = await getOrCreateWallet(OWNER_COMPANY, companyId, externalTransaction);
    const points = calculateEmployerTopPoints(vndAmount, wallet.lifetimeEarned);
    if (points <= 0) return null;

    return creditWallet({
        ownerType: OWNER_COMPANY,
        ownerId: companyId,
        amount: points,
        reasonCode: 'PACKAGE_PURCHASE_REWARD',
        description: description || `Tích điểm Top Point từ giao dịch ${sourceType} #${sourceId}`,
        refType: sourceType,
        refId: sourceId,
        idempotencyKey: `COMPANY:PAYMENT:${sourceType}:${sourceId}`
    }, externalTransaction);
};

// Dong bo cac don OrderPackage / OrderPackageCV da co trong DB sang Top Point (idempotent)
// de doanh nghiep co san lich su giao dich nhan duoc diem & hang ngay lap tuc.
const syncHistoricalCompanyOrders = async (companyId) => {
    if (!db.User?.findAll || !db.OrderPackage?.findAll || !db.OrderPackageCV?.findAll) return;
    const users = await db.User.findAll({ where: { companyId: Number(companyId) }, attributes: ['id'] });
    const userIds = users.map((u) => Number(u.id)).filter(Boolean);
    if (!userIds.length) return;

    const [postOrders, cvOrders] = await Promise.all([
        db.OrderPackage.findAll({ where: { userId: { [Op.in]: userIds } }, order: [['id', 'ASC']] }),
        db.OrderPackageCV.findAll({ where: { userId: { [Op.in]: userIds } }, order: [['id', 'ASC']] })
    ]);

    const pendingAwards = [];
    for (const order of postOrders || []) {
        const usdTotal = (Number(order.currentPrice) || 0) * (Number(order.amount) || 1);
        const sourceId = order.paymentIntentId ? `INTENT_${order.paymentIntentId}` : `HIST_POST_${order.id}`;
        pendingAwards.push({
            idempotencyKey: `COMPANY:PAYMENT:ORDER_POST:${sourceId}`,
            companyId,
            vndAmount: usdTotal * USD_VND_RATE,
            sourceType: 'ORDER_POST',
            sourceId,
            description: `Tích điểm Top Point đơn mua gói đăng tin #${order.id}`
        });
    }
    for (const order of cvOrders || []) {
        const usdTotal = (Number(order.currentPrice) || 0) * (Number(order.amount) || 1);
        const sourceId = order.paymentIntentId ? `INTENT_${order.paymentIntentId}` : `HIST_CV_${order.id}`;
        pendingAwards.push({
            idempotencyKey: `COMPANY:PAYMENT:ORDER_CV:${sourceId}`,
            companyId,
            vndAmount: usdTotal * USD_VND_RATE,
            sourceType: 'ORDER_CV',
            sourceId,
            description: `Tích điểm Top Point đơn mua gói xem CV #${order.id}`
        });
    }

    if (!pendingAwards.length) return;

    const existingRows = db.RewardTransaction?.findAll
        ? await db.RewardTransaction.findAll({
            where: { idempotencyKey: { [Op.in]: pendingAwards.map((item) => item.idempotencyKey) } },
            attributes: ['idempotencyKey'],
            raw: true
        })
        : [];
    const existingKeys = new Set((existingRows || []).map((row) => row?.idempotencyKey).filter(Boolean));

    for (const item of pendingAwards) {
        if (!existingKeys.has(item.idempotencyKey)) {
            await awardEmployerPointsForPayment(item);
        }
    }
};

const getEmployerRewardOverview = async (companyId) => {
    if (!companyId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const company = await db.Company.findOne({ where: { id: Number(companyId) } });
    if (!company) return { errCode: 2, errMessage: 'Không tìm thấy công ty' };

    await syncHistoricalCompanyOrders(company.id);
    const wallet = await getOrCreateWallet(OWNER_COMPANY, company.id);
    const recentTransactions = await db.RewardTransaction.findAll({
        where: { walletId: wallet.id },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: 20
    });

    const balance = Number(wallet.balance || 0);
    const lifetimeEarned = Number(wallet.lifetimeEarned || 0);
    const lifetimeSpent = Number(wallet.lifetimeSpent || 0);
    const tier = tierFor(EMPLOYER_REWARDS.tiers, lifetimeEarned);
    const allowances = {
        allowPost: Number(company.allowPost || 0),
        allowHotPost: Number(company.allowHotPost || 0),
        allowCv: Number(company.allowCv || 0),
        allowCvFree: Number(company.allowCvFree || 0)
    };
    const redemptionCatalog = EMPLOYER_REWARDS.catalog.map((item) => ({
        ...item,
        costPoints: item.cost,
        rewardField: item.allowanceField,
        rewardAmount: item.amount,
        description: item.description || `Cộng ngay +${item.amount} vào quỹ lượt của công ty sau khi đổi.`
    }));
    const formattedTransactions = formatTransactionsForClient(recentTransactions);

    return {
        errCode: 0,
        data: {
            company: {
                id: company.id,
                name: company.name,
                ...allowances
            },
            allowances,
            wallet: {
                id: wallet.id,
                balance,
                balancePoints: balance,
                tierLabel: tier.name,
                multiplier: tier.multiplier,
                lifetimeEarned,
                lifetimeSpent,
                vndPerPoint: EMPLOYER_REWARDS.vndPerPoint,
                rankWindowDays: EMPLOYER_REWARDS.rankWindowDays
            },
            tier,
            tiers: EMPLOYER_REWARDS.tiers,
            catalog: EMPLOYER_REWARDS.catalog,
            redemptionCatalog,
            recentTransactions,
            transactions: formattedTransactions
        }
    };
};

const redeemEmployerPoints = async ({ companyId, userId, itemCode }) => {
    if (!companyId || !userId || !itemCode) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const rewardItem = EMPLOYER_REWARDS.catalog.find((item) => item.code === String(itemCode).toUpperCase());
    if (!rewardItem) return { errCode: 2, errMessage: 'Quà đổi điểm không tồn tại' };

    return runInTransaction(null, async (transaction) => {
        const company = await db.Company.findOne({
            where: { id: Number(companyId) },
            transaction,
            lock: transaction.LOCK?.UPDATE,
            raw: false
        });
        if (!company) return { errCode: 2, errMessage: 'Không tìm thấy công ty' };

        const debit = await debitWallet({
            ownerType: OWNER_COMPANY,
            ownerId: company.id,
            amount: rewardItem.cost,
            reasonCode: 'REDEEM_REWARD',
            description: `Đổi ${rewardItem.cost} Top Point lấy ${rewardItem.name}`,
            refType: 'REWARD_CATALOG',
            refId: rewardItem.code,
            idempotencyKey: `COMPANY:REDEEM:${company.id}:${userId}:${rewardItem.code}:${Date.now()}`
        }, transaction);
        if (debit.errCode !== 0) return debit;

        company[rewardItem.allowanceField] = Number(company[rewardItem.allowanceField] || 0) + Number(rewardItem.amount);
        await company.save({ transaction, silent: true });

        return {
            errCode: 0,
            errMessage: `Đổi thành công: +${rewardItem.amount} (${rewardItem.name})`,
            data: {
                balance: Number(debit.wallet.balance || 0),
                allowances: {
                    allowPost: Number(company.allowPost || 0),
                    allowHotPost: Number(company.allowHotPost || 0),
                    allowCv: Number(company.allowCv || 0)
                }
            }
        };
    });
};

module.exports = {
    OWNER_CANDIDATE,
    OWNER_COMPANY,
    todayVietnam,
    getOrCreateWallet,
    creditWallet,
    debitWallet,
    evaluateCandidateProfileCompletion,
    getCandidateRewardOverview,
    getCandidateTransactions,
    claimDailyCheckin,
    claimProfileCompleteBonus,
    awardCandidateApplicationPoints,
    getJobCompetitionReport,
    unlockJobCompetitionReport,
    calculateEmployerTopPoints,
    awardEmployerPointsForPayment,
    getEmployerRewardOverview,
    redeemEmployerPoints
};
