'use strict';

const bcrypt = require('bcryptjs');
const { createResume } = require('./catalog.cjs');
const SEED_ID = 'jobfind-demo-v1';
const PASSWORD = 'Demo@123456';
const DAY = 86400000;

// A ledger links stable fixture keys to auto-increment IDs. Never reserve a range
// of IDs or adopt unrelated records just because their phone/name happens to match.
async function prepareLedger(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS jobfind_demo_records (
        seedKey VARCHAR(190) PRIMARY KEY, tableName VARCHAR(64) NOT NULL,
        recordId INT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function seedMysql(db, catalog, { now = new Date() } = {}) {
    const manifest = { seedId: SEED_ID, companies: [], candidates: [], posts: [], cvs: [] };
    const changes = {};
    const date = days => new Date(now.getTime() - days * DAY);
    const timestamp = days => ({ createdAt: date(days), updatedAt: date(days) });
    const hash = await bcrypt.hash(PASSWORD, 10);
    const [entries] = await db.query('SELECT * FROM jobfind_demo_records WHERE seedKey LIKE ?', [`${SEED_ID}:%`]);
    const registry = new Map(entries.map(item => [item.seedKey, item]));
    async function insert(table, data) {
        const [result] = await db.query('INSERT INTO ?? SET ?', [table, data]);
        changes[table] = (changes[table] || 0) + 1;
        return Number(result.insertId);
    }
    async function owned(key, table, data) {
        const seedKey = `${SEED_ID}:${key}`;
        const old = registry.get(seedKey);
        if (old) {
            if (old.tableName !== table) throw new Error(`Sai bảng dữ liệu mẫu: ${key}`);
            const [[row]] = await db.query('SELECT id FROM ?? WHERE id = ?', [table, old.recordId]);
            if (!row) throw new Error(`Bản ghi demo đã bị xóa: ${key}. Cần kiểm tra trước khi nạp lại.`);
            return old.recordId;
        }
        const id = await insert(table, data);
        await db.query('INSERT INTO jobfind_demo_records SET ?', { seedKey, tableName: table, recordId: id });
        registry.set(seedKey, { tableName: table, recordId: id });
        return id;
    }
    async function relation(table, where, data = {}) {
        const columns = Object.keys(where);
        const [rows] = await db.query(`SELECT 1 FROM ?? WHERE ${columns.map(() => '?? = ?').join(' AND ')} LIMIT 1`,
            [table, ...columns.flatMap(key => [key, where[key]])]);
        if (!rows.length) await insert(table, { ...where, ...data });
    }
    async function account(key, person, companyId, role = 'CANDIDATE') {
        // Phone collisions should fail before any unrelated account is changed.
        const known = registry.has(`${SEED_ID}:account:${key}`);
        if (!known) {
            const [collisions] = await db.query('SELECT id FROM accounts WHERE phonenumber = ?', [person.phone]);
            if (collisions.length) throw new Error(`Số tài khoản mẫu đã được sử dụng: ${person.phone}`);
        }
        const id = await owned(`user:${key}`, 'users', {
            firstName: person.firstName, lastName: person.lastName, email: person.email,
            address: person.address || '', genderCode: person.genderCode || 'FE',
            dob: person.dob || '1990-01-01', image: person.avatar || '/demo/avatar.svg', companyId
        });
        await owned(`account:${key}`, 'accounts', { userId: id, phonenumber: person.phone,
            password: hash, roleCode: role, statusCode: 'S1', ...timestamp(75) });
        return id;
    }

    for (const code of catalog.allcodes) {
        const [[existing]] = await db.query('SELECT code, type FROM allcodes WHERE code = ?', [code.code]);
        if (existing && existing.type !== code.type) throw new Error(`Mã danh mục xung đột: ${code.code}`);
        if (!existing) await db.query('INSERT INTO allcodes SET ?', code);
    }

    // Cover existing approved companies, including the account already open in
    // the user's browser. Existing owners, passwords and quotas remain intact.
    const [existingCompanies] = await db.query(`SELECT c.id,c.name,c.address,
        COALESCE(MAX(CASE WHEN a.phonenumber='0900000002' THEN u.id END), MIN(u.id)) recruiterId
        FROM companies c JOIN users u ON u.companyId=c.id
        JOIN accounts a ON a.userId=u.id AND a.statusCode='S1' AND a.roleCode IN ('COMPANY','EMPLOYER')
        WHERE c.statusCode='S1' AND c.censorCode='CS1'
        AND c.id NOT IN (SELECT recordId FROM jobfind_demo_records WHERE tableName='companies' AND seedKey LIKE ?)
        GROUP BY c.id ORDER BY c.id`, [`${SEED_ID}:%`]);
    manifest.companies.push(...existingCompanies.map(c => ({ ...c, key: `existing-company-${c.id}`, existing: true })));

    for (const [index, company] of catalog.companies.entries()) {
        const recruiterId = await account(company.key, company.recruiter, null, 'COMPANY');
        const id = await owned(`company:${company.key}`, 'companies', {
            name: company.name, descriptionHTML: company.descriptionHTML, descriptionMarkdown: company.descriptionMarkdown,
            website: company.website, address: company.address, phonenumber: company.phonenumber,
            taxnumber: company.taxnumber, amountEmployer: company.amountEmployer,
            thumbnail: company.logo, coverimage: company.cover,
            statusCode: 'S1', censorCode: 'CS1', userId: recruiterId,
            allowPost: 100, allowHotPost: 20, allowCvFree: 20, allowCV: 200, ...timestamp(90 - index)
        });
        // Set company only at creation; never reassign an account edited later.
        if (changes.companies && !entries.some(entry => entry.seedKey === `${SEED_ID}:company:${company.key}`)) {
            await db.query('UPDATE users SET companyId = ? WHERE id = ? AND companyId IS NULL', [id, recruiterId]);
        }
        await account(`${company.key}-staff`, { ...company.recruiter, firstName: 'Chuyên viên', lastName: `Tuyển dụng ${index + 1}`,
            email: `hr-team-${index + 1}@example.test`, phone: `093880000${index + 1}` }, id, 'EMPLOYER');
        manifest.companies.push({ ...company, id, recruiterId });
    }

    for (const candidate of catalog.candidates) {
        const id = await account(candidate.key, candidate, null);
        manifest.candidates.push({ ...candidate, id, name: `${candidate.firstName} ${candidate.lastName}` });
    }
    const [[demoCandidate]] = await db.query(`SELECT u.*, a.phonenumber phone FROM users u
        JOIN accounts a ON a.userId=u.id WHERE a.phonenumber='0900000003' AND a.roleCode='CANDIDATE' AND a.statusCode='S1'`);
    if (demoCandidate) manifest.candidates.push({ ...catalog.candidates[0], ...demoCandidate,
        key: 'existing-demo-candidate', existing: true, fullName: `${demoCandidate.firstName} ${demoCandidate.lastName}`,
        name: `${demoCandidate.firstName} ${demoCandidate.lastName}` });

    for (const person of manifest.candidates) {
        person.file = await createResume(person);
        await relation('usersettings', { userId: person.id }, { ...person.setting, isTakeMail: 0, file: person.file });
        for (const name of person.skills) {
            const [[found]] = await db.query('SELECT id FROM skills WHERE name=? AND categoryJobCode=?', [name, person.setting.categoryJobCode]);
            const skillId = found?.id || await insert('skills', { name, categoryJobCode: person.setting.categoryJobCode });
            await relation('userskills', { userId: person.id, skillId });
        }
    }

    for (const company of manifest.companies) {
        const templates = company.existing
            ? [...catalog.jobs.filter(j => j.companyKey === catalog.companies[0].key).slice(0, 4),
                catalog.jobs.find(j => j.categoryJobCode === 'truyen-thong'), catalog.jobs.find(j => j.categoryJobCode === 'quan-ly-nhan-su')]
            : catalog.jobs.filter(j => j.companyKey === company.key);
        for (const [index, template] of templates.entries()) {
            if (!template) throw new Error('Thiếu tin mẫu cho nhóm ngành.');
            const key = `${company.key}:job-${index + 1}`;
            const fields = ['name','descriptionHTML','descriptionMarkdown','categoryJobCode','addressCode','salaryJobCode',
                'amount','categoryJoblevelCode','categoryWorktypeCode','experienceJobCode','genderPostCode'];
            const detail = Object.fromEntries(fields.map(field => [field, template[field]]));
            detail.name = `[Demo] ${template.title || template.name} — ${company.name}`;
            if (company.existing) {
                const sourceName = catalog.companies.find(c => c.key === template.companyKey).name;
                detail.descriptionHTML = detail.descriptionHTML.split(sourceName).join(company.name);
                detail.descriptionMarkdown = detail.descriptionMarkdown.split(sourceName).join(company.name);
            }
            // Existing businesses receive clearly labelled demo postings with
            // location and company text resolved to the target owner.
            detail.descriptionHTML += `<p><em>Dữ liệu giả lập để trình diễn JobFind tại ${company.name}; không phải thông báo tuyển dụng thật.</em></p>`;
            detail.descriptionMarkdown += `\n\nDữ liệu giả lập để trình diễn JobFind tại ${company.name}.`;
            const detailPostId = await owned(`detail:${key}`, 'detailposts', detail);
            const id = await owned(`post:${key}`, 'posts', { detailPostId, userId: company.recruiterId,
                statusCode: template.statusCode || 'PS1', isHot: index % 3 === 0 ? 1 : 0,
                timePost: String(date(42 - index * 4).getTime()), timeEnd: String(date(-60 - index * 5).getTime()),
                ...timestamp(42 - index * 4) });
            const [[stored]] = await db.query('SELECT p.*,d.name FROM posts p JOIN detailposts d ON d.id=p.detailPostId WHERE p.id=?', [id]);
            manifest.posts.push({ ...template, ...stored, id, key, title: stored.name, companyId: company.id });
        }
    }

    // Three different candidates per post. Each company gets 18 applications,
    // distributed across all six stages by the workflow seeder.
    for (const post of manifest.posts) {
        const postIndex = Number(post.key.match(/job-(\d+)$/)[1]) - 1;
        const people = manifest.candidates.filter(c => c.setting.categoryJobCode === post.categoryJobCode && !c.existing);
        if (people.length < 3) throw new Error(`Thiếu ứng viên cho ${post.categoryJobCode}`);
        for (let offset = 0; offset < 3; offset++) {
            const person = people[(postIndex + offset) % people.length];
            const key = `${post.key}:${person.key}`;
            const createdAt = date(18 - (postIndex % 9) - offset);
            const description = `Hồ sơ demo: ${person.name} ứng tuyển ${post.name.replace(/^\[Demo\]\s*/, '')}. ${person.skills.slice(0, 3).join(', ')}.`.slice(0, 250);
            const id = await owned(`cv:${key}`, 'cvs', { userId: person.id, postId: post.id, file: person.file,
                description, isChecked: (postIndex * 3 + offset) % 6 !== 0 ? 1 : 0, createdAt, updatedAt: createdAt });
            const [[stored]] = await db.query('SELECT id,userId,postId,createdAt,description FROM cvs WHERE id=?', [id]);
            manifest.cvs.push(stored);
        }
    }
    if (demoCandidate) {
        const person = manifest.candidates.find(c => c.existing);
        for (const post of manifest.posts.slice(0, 6)) {
            const id = await owned(`cv:existing-demo:${post.id}`, 'cvs', { userId: person.id, postId: post.id, file: person.file,
                description: 'Hồ sơ ứng tuyển giả lập cho tài khoản ứng viên demo.', isChecked: 1, ...timestamp(12) });
            const [[stored]] = await db.query('SELECT id,userId,postId,createdAt,description FROM cvs WHERE id=?', [id]);
            manifest.cvs.push(stored);
        }
    }

    const reviewTexts = [
        'Môi trường demo: quy trình trao đổi rõ ràng, nhóm hỗ trợ nhân viên mới tốt; mong lịch phỏng vấn linh hoạt hơn.',
        'Đánh giá giả lập: có lộ trình đào tạo và phản hồi cụ thể; phù hợp để phát triển kỹ năng chuyên môn.',
        'Đánh giá giả lập: dự án đa dạng, đồng nghiệp chia sẻ kiến thức; cần cải thiện phối hợp giữa các bộ phận.'
    ];
    for (const [index, person] of manifest.candidates.entries()) {
        for (let offset = 0; offset < 3; offset++) {
            const post = manifest.posts[(index * 3 + offset * 7) % manifest.posts.length];
            await relation('favoriteposts', { userId: person.id, postId: post.id }, timestamp(4 + offset));
            await relation('followcompanies', { userId: person.id, companyId: post.companyId }, timestamp(10 + offset));
        }
        const cv = manifest.cvs.find(item => item.userId === person.id);
        if (cv) await owned(`notification:candidate:${person.key}`, 'notifications', { userId: person.id,
            typeCode: 'SYSTEM', isChecked: index % 3 === 0 ? 0 : 1,
            content: 'Thông báo demo: hồ sơ ứng tuyển đã được ghi nhận. Bạn có thể xem tiến độ trong lịch sử ứng tuyển.',
            link: '/candidate/cv-post', ...timestamp(1 + index % 7) });
    }
    const [postPackages] = await db.query('SELECT * FROM packageposts WHERE price > 0 ORDER BY id');
    const [cvPackages] = await db.query('SELECT * FROM packagecvs WHERE price > 0 ORDER BY id');
    for (const company of manifest.companies) {
        const posts = manifest.posts.filter(p => p.companyId === company.id);
        const cvs = manifest.cvs.filter(cv => posts.some(p => p.id === cv.postId));
        const candidates = [...new Set(cvs.map(cv => cv.userId))];
        for (const [index, id] of candidates.entries()) {
            const person = manifest.candidates.find(c => c.id === id);
            // Opening seeded profiles remains possible even for an existing
            // employer with no remaining allowance; other profiles retain rules.
            await relation('candidateviews', { companyId: company.id, candidateId: id }, { allowanceType: 'FREE', ...timestamp(9) });
            if (index < 3) await relation('companyreviews', { companyId: company.id, userId: id }, {
                star: 3 + index % 3, content: reviewTexts[index], ...timestamp(15 - index) });
            if (index >= 4) continue;
            const post = posts[index % posts.length];
            const conversation = [
                [id, company.recruiterId, `Trao đổi demo: Em quan tâm vị trí ${post.name}. Em có kinh nghiệm ${person.skills.slice(0, 2).join(' và ')}.`],
                [company.recruiterId, id, 'Trao đổi demo: Cảm ơn bạn đã gửi hồ sơ. Nhóm tuyển dụng sẽ trao đổi về kinh nghiệm dự án và thời gian có thể bắt đầu.'],
                [id, company.recruiterId, 'Trao đổi demo: Em có thể tham gia phỏng vấn trực tuyến trong tuần. Em đã chuẩn bị CV và phần giới thiệu các dự án gần nhất.']
            ];
            for (const [messageIndex, [senderId, receiverId, content]] of conversation.entries()) {
                const createdAt = new Date(date(2 + index).getTime() + messageIndex * 10 * 60000);
                await owned(`chat:${company.key}:${id}:${messageIndex}`, 'chatmessages', {
                    senderId, receiverId, content, isRead: messageIndex === 2 ? 0 : 1,
                    clientMessageId: `demo-v1-${company.id}-${id}-${messageIndex}`, jobPostId: post.id,
                    jobSnapshot: messageIndex === 1 ? JSON.stringify({ id: post.id, name: post.name,
                        companyName: company.name, location: post.addressCode,
                        salary: catalog.allcodes.find(c => c.code === post.salaryJobCode)?.value || '',
                        experience: catalog.allcodes.find(c => c.code === post.experienceJobCode)?.value || '',
                        workType: catalog.allcodes.find(c => c.code === post.categoryWorktypeCode)?.value || '',
                        descriptionText: post.descriptionMarkdown, sharedAt: createdAt.toISOString() }) : null,
                    createdAt, updatedAt: createdAt
                });
            }
        }
        await owned(`notification:company:${company.key}`, 'notifications', { userId: company.recruiterId,
            typeCode: 'NEW_CV', isChecked: 0, content: `Dữ liệu demo: ${cvs.length} hồ sơ đã có trong quy trình tuyển dụng của công ty.`,
            link: '/admin/pipeline/', ...timestamp(1) });
        // Each employer can demonstrate both order-history screens. These are
        // labelled DEMO provider receipts, never payments or quota grants.
        for (const [type, packages, table, packageKey] of [
            ['POST', postPackages, 'orderpackages', 'packagePostId'],
            ['CV', cvPackages, 'orderpackagecvs', 'packageCvId']
        ]) {
            if (!packages.length) continue;
            for (let i = 0; i < 2; i++) {
                const pack = packages[i % packages.length];
                const quantity = i + 1;
                const when = timestamp(35 - i * 20);
                const key = `${company.key}:${type}:${i}`;
                const paymentIntentId = await owned(`payment:${key}`, 'paymentintents', {
                    provider: 'DEMO', providerPaymentId: `${SEED_ID}:${key}`, providerToken: `${SEED_ID}:${key}:receipt`,
                    userId: company.recruiterId, companyId: company.id, packageType: type, packageId: pack.id,
                    quantity, unitPrice: Number(pack.price), totalPrice: Number(pack.price) * quantity, currency: 'USD',
                    entitlementType: type === 'CV' ? 'ALLOW_CV' : Number(pack.isHot) ? 'ALLOW_HOT_POST' : 'ALLOW_POST',
                    entitlementAmount: Number(pack.value) * quantity, status: 'COMPLETED',
                    expiresAt: when.createdAt, completedAt: when.createdAt, ...when
                });
                await owned(`order:${key}`, table, { [packageKey]: pack.id, userId: company.recruiterId,
                    currentPrice: Number(pack.price), amount: quantity, paymentIntentId, ...when });
            }
        }
    }
    return { manifest, changes };
}

module.exports = { SEED_ID, PASSWORD, prepareLedger, seedMysql };
