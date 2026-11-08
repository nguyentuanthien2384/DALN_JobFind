import db from '../models/index';
import { createSkillMatcher, prepareSkillText } from '../utils/skillMatch';
const { Op } = require('sequelize');
const {
    POINT_VALUE_VND,
    CANDIDATE_TOPUP_PACKAGES,
    formatCandidateTopupPackages,
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

const CANDIDATE_APP_SYNC_TTL_MS = 60 * 1000;
const syncedCandidateAppsAt = new Map();

const syncCandidateApplicationRewards = async (userId) => {
    if (!db.Cv?.findAll) return;
    const normalizedUserId = Number(userId);
    if (process.env.NODE_ENV !== 'test') {
        const lastSyncedAt = syncedCandidateAppsAt.get(normalizedUserId) || 0;
        if (Date.now() - lastSyncedAt < CANDIDATE_APP_SYNC_TTL_MS) {
            return;
        }
        syncedCandidateAppsAt.set(normalizedUserId, Date.now());
    }
    const submittedCvs = await db.Cv.findAll({
        where: { userId: normalizedUserId },
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
            topupPackages: formatCandidateTopupPackages(),
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
    if (db.Account?.findOne) {
        const account = await db.Account.findOne({
            where: { userId: Number(userId) },
            attributes: ['roleCode'],
            raw: true
        });
        if (account && account.roleCode !== OWNER_CANDIDATE) {
            return null;
        }
    }
    syncedCandidateAppsAt.delete(Number(userId));
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

// Bo dau tieng Viet va chuan hoa chu thuong de phan tich nhan Allcode chinh xac.
const foldVi = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .trim();

// Phan tich moc nam kinh nghiem va nhom ("under3" | "threeToFive" | "over5") tu du lieu Allcode that.
const parseExperienceInfo = (code, label) => {
    const text = foldVi(`${label || ''} ${code || ''}`);
    if (!text) return null;
    if (/khong\s*yeu\s*cau|khong\s*can|chua\s*co|moi\s*tot\s*nghiep|intern|thuc\s*tap|fresher/.test(text)) {
        return { bucket: 'under3', years: 0 };
    }
    if (/duoi\s*1|0\s*-\s*1|<\s*1/.test(text)) {
        return { bucket: 'under3', years: 0.5 };
    }
    if (/tren\s*5|hon\s*5|>\s*5|5\s*\+|\b(?:[6-9]|[1-9]\d)\s*(?:nam|y|yr|year)|principal|director|giam\s*doc/.test(text)) {
        return { bucket: 'over5', years: 6 };
    }
    const rangeMatch = text.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/);
    if (rangeMatch) {
        const low = Number(rangeMatch[1].replace(',', '.'));
        const high = Number(rangeMatch[2].replace(',', '.'));
        if (Number.isFinite(low) && Number.isFinite(high)) {
            const avg = (low + high) / 2;
            const bucket = avg < 3 ? 'under3' : avg <= 5 ? 'threeToFive' : 'over5';
            return { bucket, years: avg };
        }
    }
    const numMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:nam|y|yr|year)/);
    if (numMatch) {
        const yrs = Number(numMatch[1].replace(',', '.'));
        if (Number.isFinite(yrs)) {
            const bucket = yrs < 3 ? 'under3' : yrs <= 5 ? 'threeToFive' : 'over5';
            return { bucket, years: yrs };
        }
    }
    if (/junior/.test(text)) return { bucket: 'under3', years: 1.5 };
    if (/middle|senior|lead|truong\s*nhom/.test(text)) return { bucket: 'threeToFive', years: 4 };
    if (/manager|truong\s*phong/.test(text)) return { bucket: 'over5', years: 6 };
    return null;
};

// Phan tich khoang luong (trieu VND) tu Allcode SALARYTYPE; tra null neu Thoa thuan hoac chua cap nhat.
const parseSalaryMillion = (code, label) => {
    const foldedLabel = foldVi(label);
    const foldedCode = foldVi(code);
    if (/thoa\s*thuan|thuong\s*luong|canh\s*tranh/.test(foldedLabel) || /thoa-?thuan/.test(foldedCode)) {
        return null;
    }
    const source = foldedLabel || (/tr|trieu|\d+\s*-\s*\d+|^\d+(?:[.,]\d+)?$/.test(foldedCode) ? foldedCode : '');
    if (!source) return null;

    const numbers = (source.match(/\d+(?:[.,]\d+)?/g) || [])
        .map((val) => Number(val.replace(',', '.')))
        .filter((num) => Number.isFinite(num) && num > 0 && num < 500);
    if (numbers.length >= 2) {
        const min = Math.min(numbers[0], numbers[1]);
        const max = Math.max(numbers[0], numbers[1]);
        return { min, max, mid: Number(((min + max) / 2).toFixed(1)) };
    }
    if (numbers.length === 1) {
        const base = numbers[0];
        if (/tren|hon|>|\+/.test(source)) {
            const max = Math.round(base + Math.max(5, base * 0.3));
            return { min: base, max, mid: Number(((base + max) / 2).toFixed(1)) };
        }
        if (/duoi|<|toi\s*da/.test(source)) {
            const min = Math.max(1, Math.round(base * 0.6));
            return { min, max: base, mid: Number(((min + base) / 2).toFixed(1)) };
        }
        return { min: base, max: base, mid: Number(base.toFixed(1)) };
    }
    return null;
};

// Tinh muc luong ky vong tu ho so ung vien da nop; neu chua ai ke khai so cu the thi hien thi khung luong tin dang.
const computeApplicantSalaryInsights = (applicantSettings, detail) => {
    const parsedApplicants = (applicantSettings || [])
        .map((item) => parseSalaryMillion(item?.salaryJobCode, item?.salaryTypeSettingData?.value))
        .filter(Boolean);

    if (parsedApplicants.length > 0) {
        const min = Math.min(...parsedApplicants.map((item) => item.min));
        const max = Math.max(...parsedApplicants.map((item) => item.max));
        const avg = Number(
            (parsedApplicants.reduce((sum, item) => sum + item.mid, 0) / parsedApplicants.length).toFixed(1)
        );
        const rangeText = min === max ? `${min} triệu` : `${min} - ${max} triệu`;
        return {
            averageMillion: avg,
            rangeLabel: `Từ ${parsedApplicants.length} hồ sơ: ${rangeText}`,
            suggestedLabel: rangeText,
            source: 'APPLICANTS',
            sampleCount: parsedApplicants.length
        };
    }

    const postSalary = parseSalaryMillion(detail?.salaryJobCode, detail?.salaryTypePostData?.value);
    if (postSalary) {
        const postLabel = detail?.salaryTypePostData?.value
            || (postSalary.min === postSalary.max
                ? `${postSalary.min} triệu`
                : `${postSalary.min} - ${postSalary.max} triệu`);
        return {
            averageMillion: postSalary.mid,
            rangeLabel: `Theo tin đăng: ${postLabel}`,
            suggestedLabel: postLabel,
            source: 'JOB_POST',
            sampleCount: 0
        };
    }

    return {
        averageMillion: null,
        rangeLabel: 'Thỏa thuận (chưa có ứng viên kê khai lương)',
        suggestedLabel: 'Thỏa thuận',
        source: 'NEGOTIABLE',
        sampleCount: 0
    };
};

// Cham diem ho so ung vien (0..100%) dua tren 4 tieu chi thuc te trong CSDL:
// Ky nang JD (50d) + Kinh nghiem (25d) + Nganh nghe (15d) + Khu vuc (10d).
const evaluateProfileAgainstPost = ({ detail, requiredSkills, allSkills, ownedSkillIds, setting }) => {
    let skillRatio = 0;
    let matchedCount = 0;
    if (requiredSkills.length > 0) {
        matchedCount = requiredSkills.filter((skill) => ownedSkillIds.has(Number(skill.id))).length;
        skillRatio = matchedCount / requiredSkills.length;
    } else if ((allSkills || []).length > 0) {
        matchedCount = allSkills.filter((skill) => ownedSkillIds.has(Number(skill.id))).length;
        const targetSkillCount = Math.min(3, Math.max(1, allSkills.length));
        skillRatio = Math.min(1, matchedCount / targetSkillCount);
    } else {
        skillRatio = ownedSkillIds.size > 0 ? 1 : 0;
    }
    const skillPoints = skillRatio * 50;

    const reqExp = parseExperienceInfo(detail?.experienceJobCode, detail?.expTypePostData?.value);
    const candExp = parseExperienceInfo(setting?.experienceJobCode, setting?.expTypeSettingData?.value);
    let expPoints = 0;
    let expMet = false;
    if (!reqExp || reqExp.years === 0) {
        expPoints = candExp ? 25 : 18;
        expMet = true;
    } else if (!candExp) {
        expPoints = 0;
        expMet = false;
    } else if (
        candExp.years >= reqExp.years
        || (detail?.experienceJobCode && detail.experienceJobCode === setting?.experienceJobCode)
    ) {
        expPoints = 25;
        expMet = true;
    } else {
        expPoints = Math.round((candExp.years / reqExp.years) * 18);
        expMet = false;
    }

    const catMatch = !detail?.categoryJobCode
        || Boolean(setting?.categoryJobCode && setting.categoryJobCode === detail.categoryJobCode);
    const locMatch = !detail?.addressCode
        || Boolean(setting?.addressCode && setting.addressCode === detail.addressCode);

    const categoryPoints = catMatch ? 15 : 0;
    const locationPoints = locMatch ? 10 : 0;
    const matchPercent = Math.max(0, Math.min(100, Math.round(skillPoints + expPoints + categoryPoints + locationPoints)));

    return {
        matchPercent,
        skillRatio,
        matchedCount,
        expMet,
        candExp,
        reqExp,
        catMatch: Boolean(setting?.categoryJobCode && detail?.categoryJobCode && setting.categoryJobCode === detail.categoryJobCode),
        locMatch: Boolean(setting?.addressCode && detail?.addressCode && setting.addressCode === detail.addressCode)
    };
};

// Tong hop thong ke ung tuyen & doi chieu ho so 100% tu du lieu CSDL that (Cvs, UserSettings, UserSkills, Skills, DetailPosts).
// Chi tiet ca nhan / file CV cua ung vien khac TUYET DOI KHONG bao gio tra ra ngoai.
const buildCompetitionInsights = async ({ post, detail, cvs, userId }) => {
    const totalApplicants = cvs.length;
    const targetAmount = Math.max(1, Number(detail?.amount) || 1);
    const ratioRight = totalApplicants === 0 ? 0 : Math.max(1, Math.round(totalApplicants / targetAmount));
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const todayApplicants = cvs.filter((cv) => cv.createdAt && new Date(cv.createdAt).getTime() >= dayAgo).length;

    const applicantIds = [...new Set(cvs.map((cv) => Number(cv.userId)).filter(Boolean))];
    const settingIncludes = db.Allcode ? [
        { model: db.Allcode, as: 'expTypeSettingData', attributes: ['code', 'value'] },
        { model: db.Allcode, as: 'salaryTypeSettingData', attributes: ['code', 'value'] },
        { model: db.Allcode, as: 'jobTypeSettingData', attributes: ['code', 'value'] },
        { model: db.Allcode, as: 'provinceSettingData', attributes: ['code', 'value'] }
    ] : [];

    const categoryCode = detail?.categoryJobCode;
    const [settings, applicantSkillRows, allSkills, userSkills, userSetting] = await Promise.all([
        applicantIds.length && db.UserSetting?.findAll
            ? db.UserSetting.findAll({
                where: { userId: { [Op.in]: applicantIds } },
                attributes: ['userId', 'experienceJobCode', 'salaryJobCode', 'categoryJobCode', 'addressCode'],
                include: settingIncludes,
                raw: true,
                nest: true
            })
            : [],
        applicantIds.length && db.UserSkill?.findAll
            ? db.UserSkill.findAll({
                where: { UserId: { [Op.in]: applicantIds } },
                attributes: ['UserId', 'SkillId'],
                include: db.Skill ? [{ model: db.Skill, attributes: ['id', 'name'] }] : [],
                raw: true,
                nest: true
            })
            : [],
        categoryCode && db.Skill?.findAll ? db.Skill.findAll({ where: { categoryJobCode: categoryCode } }) : [],
        userId && db.UserSkill?.findAll ? db.UserSkill.findAll({ where: { UserId: Number(userId) } }) : [],
        userId && db.UserSetting?.findOne
            ? db.UserSetting.findOne({
                where: { userId: Number(userId) },
                attributes: ['userId', 'experienceJobCode', 'categoryJobCode', 'salaryJobCode', 'addressCode'],
                include: settingIncludes,
                raw: true,
                nest: true
            })
            : null
    ]);

    const settingByUserId = new Map(
        (settings || []).map((item) => [Number(item.userId), item])
    );

    const counts = { under3: 0, threeToFive: 0, over5: 0, unupdated: 0 };
    cvs.forEach((cv) => {
        const setting = settingByUserId.get(Number(cv.userId));
        const parsed = parseExperienceInfo(setting?.experienceJobCode, setting?.expTypeSettingData?.value);
        if (parsed?.bucket) {
            counts[parsed.bucket] += 1;
        } else {
            counts.unupdated += 1;
        }
    });

    const pct = (value) => (totalApplicants > 0 ? Math.round((value / totalApplicants) * 100) : 0);

    // Tong hop ky nang thuc te cua cac ung vien da nop CV vao tin nay
    const skillNameById = new Map((allSkills || []).map((skill) => [Number(skill.id), skill.name]));
    const applicantSkillSets = new Map();
    const applicantSkillCounts = new Map();
    (applicantSkillRows || []).forEach((row) => {
        const uid = Number(row.UserId ?? row.userId);
        const sid = Number(row.SkillId ?? row.skillId ?? row.Skill?.id);
        if (!uid || !sid) return;
        if (row.Skill?.name && !skillNameById.has(sid)) {
            skillNameById.set(sid, row.Skill.name);
        }
        if (!applicantSkillSets.has(uid)) {
            applicantSkillSets.set(uid, new Set());
        }
        const userSet = applicantSkillSets.get(uid);
        if (!userSet.has(sid)) {
            userSet.add(sid);
            applicantSkillCounts.set(sid, (applicantSkillCounts.get(sid) || 0) + 1);
        }
    });

    const jdText = prepareSkillText(`${detail?.name || ''} ${detail?.descriptionHTML || ''}`);
    const requiredSkills = (allSkills || []).filter((skill) => {
        const matcher = createSkillMatcher(skill.name);
        return matcher && matcher.matches(jdText);
    });
    const requiredSkillIds = new Set(requiredSkills.map((skill) => Number(skill.id)));

    const applicantTopSkills = [...applicantSkillCounts.entries()]
        .map(([skillId, count]) => ({
            skillId,
            name: skillNameById.get(skillId) || `Kỹ năng #${skillId}`,
            count,
            percent: applicantIds.length > 0 ? Math.round((count / applicantIds.length) * 100) : 0,
            isRequired: requiredSkillIds.has(skillId)
        }))
        .sort((a, b) => (b.count - a.count) || (Number(b.isRequired) - Number(a.isRequired)) || a.name.localeCompare(b.name))
        .slice(0, 6);

    const salary = computeApplicantSalaryInsights(settings, detail);
    const ownedSkillIds = new Set((userSkills || []).map((item) => Number(item.SkillId ?? item.skillId)).filter(Boolean));
    const matchedSkills = requiredSkills.filter((skill) => ownedSkillIds.has(Number(skill.id)));
    const missingSkills = requiredSkills.filter((skill) => !ownedSkillIds.has(Number(skill.id)));

    const requiredSkillNames = requiredSkills.slice(0, 4).map((item) => item.name).join(', ');
    const requiredExpLabel = detail?.expTypePostData?.value || 'Không yêu cầu cụ thể';
    const userExpLabel = userSetting?.expTypeSettingData?.value || null;
    const userBucket = parseExperienceInfo(userSetting?.experienceJobCode, userExpLabel)?.bucket || null;

    let matchPercent = null;
    let rankLabel = 'Đăng nhập để đối chiếu hồ sơ';
    let userEval = null;

    if (userId) {
        userEval = evaluateProfileAgainstPost({
            detail,
            requiredSkills,
            allSkills: allSkills || [],
            ownedSkillIds,
            setting: userSetting
        });
        matchPercent = userEval.matchPercent;

        if (applicantIds.length === 0) {
            rankLabel = 'Chưa có hồ sơ đối thủ';
        } else {
            const normalizedUid = Number(userId);
            const peerIds = applicantIds.filter((id) => id !== normalizedUid);
            const peerScores = peerIds.map((id) => evaluateProfileAgainstPost({
                detail,
                requiredSkills,
                allSkills: allSkills || [],
                ownedSkillIds: applicantSkillSets.get(id) || new Set(),
                setting: settingByUserId.get(id) || null
            }).matchPercent);
            const higherCount = peerScores.filter((score) => score > matchPercent).length;
            const poolSize = peerIds.length + 1;
            const rank = higherCount + 1;
            rankLabel = applicantIds.includes(normalizedUid)
                ? `Xếp hạng #${rank}/${poolSize} hồ sơ đã nộp`
                : `Dự kiến #${rank}/${poolSize} nếu nộp hồ sơ`;
        }
    }

    const experienceBreakdown = [
        {
            key: 'under3',
            label: 'Dưới 3 năm kinh nghiệm',
            percent: pct(counts.under3),
            count: counts.under3,
            isUserGroup: userBucket === 'under3',
            highlight: userBucket === 'under3',
            colorClass: '#64748b'
        },
        {
            key: 'threeToFive',
            label: '3 - 5 năm kinh nghiệm',
            percent: pct(counts.threeToFive),
            count: counts.threeToFive,
            isUserGroup: userBucket === 'threeToFive',
            highlight: userBucket === 'threeToFive',
            colorClass: '#252b60'
        },
        {
            key: 'over5',
            label: 'Trên 5 năm kinh nghiệm',
            percent: pct(counts.over5),
            count: counts.over5,
            isUserGroup: userBucket === 'over5',
            highlight: userBucket === 'over5',
            colorClass: '#475569'
        }
    ];

    if (counts.unupdated > 0) {
        experienceBreakdown.push({
            key: 'unupdated',
            label: 'Chưa cập nhật kinh nghiệm',
            percent: pct(counts.unupdated),
            count: counts.unupdated,
            isUserGroup: false,
            highlight: false,
            colorClass: '#94a3b8'
        });
    }

    const postSalaryLabel = detail?.salaryTypePostData?.value || 'Thỏa thuận';
    const userSalaryLabel = userSetting?.salaryTypeSettingData?.value || null;
    const postSalParsed = parseSalaryMillion(detail?.salaryJobCode, postSalaryLabel);
    const userSalParsed = parseSalaryMillion(userSetting?.salaryJobCode, userSalaryLabel);
    const salaryExceedsPost = Boolean(postSalParsed && userSalParsed && userSalParsed.min > postSalParsed.max);

    const skillRowLabel = requiredSkills.length > 0
        ? `Kỹ năng theo tin đăng (${requiredSkillNames})`
        : `Kỹ năng chuyên môn (${detail?.jobTypePostData?.value || 'Theo ngành'})`;
    let skillRowStatus = 'Cần đăng nhập';
    let skillRowTone = 'neutral';
    if (userId) {
        if (requiredSkills.length > 0) {
            skillRowStatus = `Khớp ${matchedSkills.length}/${requiredSkills.length} (${Math.round(userEval.skillRatio * 100)}%)`;
            skillRowTone = matchedSkills.length === requiredSkills.length
                ? 'emerald'
                : matchedSkills.length > 0
                    ? 'amber'
                    : 'rose';
        } else if (ownedSkillIds.size > 0) {
            skillRowStatus = `Đã cập nhật ${ownedSkillIds.size} kỹ năng`;
            skillRowTone = 'emerald';
        } else {
            skillRowStatus = 'Hồ sơ chưa cập nhật kỹ năng';
            skillRowTone = 'amber';
        }
    }

    let expRowStatus = 'Cần đăng nhập';
    let expRowTone = 'neutral';
    if (userId) {
        if (!userExpLabel && userEval.reqExp && userEval.reqExp.years > 0) {
            expRowStatus = 'Hồ sơ chưa cập nhật';
            expRowTone = 'amber';
        } else if (userEval.expMet) {
            expRowStatus = userExpLabel ? `Đạt (${userExpLabel})` : 'Đạt yêu cầu';
            expRowTone = 'emerald';
        } else {
            expRowStatus = `Chưa đạt (Hồ sơ: ${userExpLabel})`;
            expRowTone = 'amber';
        }
    }

    let fieldLocStatus = 'Cần đăng nhập';
    let fieldLocTone = 'neutral';
    if (userId) {
        if (!userSetting?.categoryJobCode && !userSetting?.addressCode) {
            fieldLocStatus = 'Hồ sơ chưa cập nhật';
            fieldLocTone = 'amber';
        } else if (userEval.catMatch && (userEval.locMatch || !detail?.addressCode)) {
            fieldLocStatus = 'Đúng ngành & khu vực';
            fieldLocTone = 'emerald';
        } else if (userEval.catMatch) {
            fieldLocStatus = 'Đúng ngành, khác khu vực';
            fieldLocTone = 'amber';
        } else if (userEval.locMatch) {
            fieldLocStatus = 'Cùng khu vực, khác ngành';
            fieldLocTone = 'amber';
        } else {
            fieldLocStatus = 'Khác ngành & khu vực';
            fieldLocTone = 'rose';
        }
    }

    const aiCorrelation = [
        {
            label: skillRowLabel,
            status: skillRowStatus,
            tone: skillRowTone
        },
        {
            label: `Kinh nghiệm yêu cầu (${requiredExpLabel})`,
            status: expRowStatus,
            tone: expRowTone
        },
        {
            label: 'Ngành nghề & địa điểm',
            status: fieldLocStatus,
            tone: fieldLocTone
        },
        {
            label: `Khung lương tin đăng (${postSalaryLabel})`,
            status: !userId
                ? 'Cần đăng nhập'
                : userSalaryLabel
                    ? `Hồ sơ chọn: ${userSalaryLabel}`
                    : 'Chưa chọn mức lương kỳ vọng',
            tone: !userId ? 'neutral' : salaryExceedsPost ? 'amber' : userSalaryLabel ? 'emerald' : 'neutral'
        }
    ];

    let tacticalTip = `Thống kê trực tiếp từ ${totalApplicants} hồ sơ đã nộp trên hệ thống.`;
    if (totalApplicants === 0) {
        tacticalTip = 'Hiện chưa có ứng viên nào nộp hồ sơ vào tin tuyển dụng này.';
    } else if (userId && missingSkills.length > 0) {
        tacticalTip = `So với tin đăng, hồ sơ của bạn chưa có kỹ năng: ${missingSkills.slice(0, 4).map((s) => s.name).join(', ')}.`;
    } else if (userId && !userSetting) {
        tacticalTip = 'Cập nhật mục Cài đặt hồ sơ và Kỹ năng để hệ thống đối chiếu chính xác hơn.';
    }

    return {
        postId: Number(post.id),
        totalApplicants,
        todayApplicants,
        targetAmount,
        competitionRatio: `1 : ${ratioRight}`,
        salaryRange: salary,
        applicantTopSkills,
        profileMatch: {
            matchPercent,
            rankLabel,
            coreSkillsLabel: skillRowLabel,
            coreSkillsMatch: skillRowStatus,
            experienceRequiredLabel: `Kinh nghiệm yêu cầu (${requiredExpLabel})`,
            experienceUserLabel: expRowStatus,
            suggestedSalaryLabel: salary.suggestedLabel
        },
        experienceBreakdown,
        aiCorrelation,
        tacticalTip
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
            { model: db.Allcode, as: 'expTypePostData', attributes: ['value', 'code'] },
            { model: db.Allcode, as: 'provincePostData', attributes: ['value', 'code'] }
        ]
    }],
    raw: true,
    nest: true
});

const getJobCompetitionReport = async ({ postId, userId, roleCode = null }) => {
    if (!postId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const post = await loadPostWithDetail(postId);
    if (!post) return { errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' };

    const detail = post.postDetailData || {};
    const cvs = await db.Cv.findAll({
        where: { postId: Number(postId) },
        attributes: ['id', 'userId', 'createdAt']
    });

    const isCandidateCaller = Boolean(userId) && (!roleCode || roleCode === 'CANDIDATE');
    let activeUnlock = null;
    let walletBalance = 0;
    if (isCandidateCaller) {
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

    const insights = await buildCompetitionInsights({
        post,
        detail,
        cvs,
        userId: isCandidateCaller ? userId : null
    });
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
            profileMatchPercent: unlocked ? insights.profileMatch.matchPercent : null,
            profileRankLabel: unlocked ? insights.profileMatch.rankLabel : null,
            salaryRange: unlocked ? insights.salaryRange : null,
            profileMatch: unlocked ? insights.profileMatch : null,
            experienceBreakdown: unlocked ? insights.experienceBreakdown : null,
            applicantTopSkills: unlocked ? insights.applicantTopSkills : null,
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

const getEmployerRewardOverview = async (companyId, { canRedeem = true } = {}) => {
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
            canRedeem: Boolean(canRedeem),
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

const getAdminRewardsOverview = async ({ limit = 20, offset = 0, purpose = '', status = '' } = {}) => {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const normalizedPurpose = String(purpose || '').trim().toUpperCase();
    const normalizedStatus = String(status || '').trim().toUpperCase();

    const orderWhere = {};
    if (normalizedPurpose && ['POINT_TOPUP', 'PACKAGE_POST', 'PACKAGE_CV'].includes(normalizedPurpose)) {
        orderWhere.purpose = normalizedPurpose;
    }
    if (normalizedStatus && ['PAID', 'PENDING', 'FAILED', 'CANCELLED'].includes(normalizedStatus)) {
        orderWhere.status = normalizedStatus;
    }

    const [allWallets, allOrdersSummary, pagedOrders, recentTxRows] = await Promise.all([
        db.RewardWallet?.findAll
            ? db.RewardWallet.findAll({
                attributes: ['id', 'ownerType', 'ownerId', 'balance', 'lifetimeEarned', 'lifetimeSpent'],
                raw: true
            })
            : [],
        db.PaymentOrder?.findAll
            ? db.PaymentOrder.findAll({
                attributes: ['purpose', 'status', 'amount', 'points'],
                raw: true
            })
            : [],
        db.PaymentOrder?.findAndCountAll
            ? db.PaymentOrder.findAndCountAll({
                where: orderWhere,
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
                limit: safeLimit,
                offset: safeOffset
            })
            : { rows: [], count: 0 },
        db.RewardTransaction?.findAll
            ? db.RewardTransaction.findAll({
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
                limit: 25
            })
            : []
    ]);

    const summarizeWallets = (type) => {
        const subset = (allWallets || []).filter((w) => w.ownerType === type);
        return {
            walletCount: subset.length,
            totalBalance: subset.reduce((sum, w) => sum + (Number(w.balance) || 0), 0),
            totalEarned: subset.reduce((sum, w) => sum + (Number(w.lifetimeEarned) || 0), 0),
            totalSpent: subset.reduce((sum, w) => sum + (Number(w.lifetimeSpent) || 0), 0)
        };
    };

    const candidateWallets = summarizeWallets(OWNER_CANDIDATE);
    const companyWallets = summarizeWallets(OWNER_COMPANY);

    let paidOrders = 0;
    let pendingOrders = 0;
    let totalPaidRevenueVnd = 0;
    let candidateTopupPaidVnd = 0;
    let candidateTopupOrders = 0;
    let companyPackagePaidVnd = 0;
    let companyPackageOrders = 0;

    for (const ord of allOrdersSummary || []) {
        if (ord.status === 'PAID') {
            paidOrders += 1;
            const amt = Number(ord.amount) || 0;
            totalPaidRevenueVnd += amt;
            if (ord.purpose === 'POINT_TOPUP') {
                candidateTopupPaidVnd += amt;
                candidateTopupOrders += 1;
            } else if (ord.purpose === 'PACKAGE_POST' || ord.purpose === 'PACKAGE_CV') {
                companyPackagePaidVnd += amt;
                companyPackageOrders += 1;
            }
        } else if (ord.status === 'PENDING') {
            pendingOrders += 1;
        }
    }

    const walletById = new Map((allWallets || []).map((w) => [Number(w.id), w]));
    const rawOrderRows = (pagedOrders?.rows || []).map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : { ...row }));
    const rawTxRows = formatTransactionsForClient(recentTxRows || []);

    const userIds = new Set();
    const companyIds = new Set();
    for (const row of rawOrderRows) {
        if (row.userId) userIds.add(Number(row.userId));
        if (row.companyId) companyIds.add(Number(row.companyId));
    }
    for (const tx of rawTxRows) {
        const wallet = walletById.get(Number(tx.walletId));
        if (wallet?.ownerType === OWNER_CANDIDATE && wallet.ownerId) userIds.add(Number(wallet.ownerId));
        if (wallet?.ownerType === OWNER_COMPANY && wallet.ownerId) companyIds.add(Number(wallet.ownerId));
    }

    const [users, companies] = await Promise.all([
        userIds.size > 0 && db.User?.findAll
            ? db.User.findAll({
                where: { id: { [Op.in]: [...userIds] } },
                attributes: ['id', 'firstName', 'lastName', 'email'],
                raw: true
            })
            : [],
        companyIds.size > 0 && db.Company?.findAll
            ? db.Company.findAll({
                where: { id: { [Op.in]: [...companyIds] } },
                attributes: ['id', 'name'],
                raw: true
            })
            : []
    ]);

    const userMap = new Map((users || []).map((u) => {
        const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        return [Number(u.id), { id: Number(u.id), name: fullName || u.email || `User #${u.id}`, email: u.email || '' }];
    }));
    const companyMap = new Map((companies || []).map((c) => [Number(c.id), c.name || `Công ty #${c.id}`]));

    const orders = rawOrderRows.map((row) => {
        const userInfo = userMap.get(Number(row.userId));
        return {
            ...row,
            actorName: userInfo?.name || `Tài khoản #${row.userId}`,
            actorEmail: userInfo?.email || '',
            companyName: row.companyId ? (companyMap.get(Number(row.companyId)) || `Công ty #${row.companyId}`) : null
        };
    });

    const transactions = rawTxRows.map((tx) => {
        const wallet = walletById.get(Number(tx.walletId));
        const ownerType = wallet?.ownerType || 'CANDIDATE';
        const ownerId = wallet?.ownerId || null;
        let ownerLabel = ownerId ? `#${ownerId}` : 'Hệ thống';
        if (ownerType === OWNER_COMPANY && ownerId) {
            ownerLabel = companyMap.get(Number(ownerId)) || `Công ty #${ownerId}`;
        } else if (ownerType === OWNER_CANDIDATE && ownerId) {
            ownerLabel = userMap.get(Number(ownerId))?.name || `Ứng viên #${ownerId}`;
        }
        return {
            ...tx,
            ownerType,
            ownerId,
            ownerLabel
        };
    });

    return {
        errCode: 0,
        data: {
            summary: {
                candidateWallets,
                companyWallets,
                totalOrders: (allOrdersSummary || []).length,
                paidOrders,
                pendingOrders,
                totalPaidRevenueVnd,
                candidateTopupPaidVnd,
                candidateTopupOrders,
                companyPackagePaidVnd,
                companyPackageOrders
            },
            orders,
            orderCount: Number(pagedOrders?.count || 0),
            transactions
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
                    allowCv: Number(company.allowCv || 0),
                    allowCvFree: Number(company.allowCvFree || 0)
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
    getAdminRewardsOverview,
    redeemEmployerPoints
};
