require('dotenv').config();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

/**
 * Hoan thien du lieu demo tren chinh du lieu goc.
 *
 * Ban dump goc co day du cong ty / tin tuyen dung / ung vien, nhung con 2 khoang
 * trong khien khong demo tron ven duoc:
 *
 *   1. Mat khau cua moi tai khoan demo la hash khong ai biet -> khong dang nhap
 *      duoc vao dung nha tuyen dung da dang tin, nen luong "ung vien xem tin roi
 *      nhan tin cho nha tuyen dung" khong the dien ra.
 *   2. Bang `cvs` rong -> man hinh "CV ung tuyen" cua nha tuyen dung khong co gi.
 *
 * Script nay KHONG xoa/sua bat ky noi dung demo nao (ten, cong ty, tin tuyen
 * dung, ky nang... giu nguyen). No chi:
 *   - Dat mat khau `123456` cho toan bo tai khoan de dang nhap duoc.
 *   - Them CV ung tuyen mau (kem file PDF that de man hinh cham do khop chay dung).
 *   - Them hoi thoai chat giua ung vien va DUNG nha tuyen dung da dang tin do.
 *   - Them thong bao tuong ung cho nha tuyen dung.
 *
 * Chay lai nhieu lan deu an toan (idempotent).
 *
 *   npm run seed:demo-data              -> ghi vao database
 *   node scripts/setup-demo-data.js --sql > out.sql   -> in ra cau lenh SQL
 */

const DEMO_PASSWORD = '123456';

// ID danh rieng cho du lieu demo bo sung, khong dam vao dai id cua dump goc.
const CV_ID_BASE = 9100;
const CHAT_ID_BASE = 9100;
const NOTI_ID_BASE = 9100;

/**
 * Tao mot file PDF hop le toi thieu, noi dung la cac tu khoa ky nang cua ung vien.
 * Nho vay chuc nang cham "do khop ky nang" cua nha tuyen dung co du lieu that de doc.
 * Frontend gui file dang data-URL (readAsDataURL) nen o day mo phong y het.
 */
function taoCvPdf(hoTen, viTri, kyNang) {
    const dong = [
        `CV UNG TUYEN - ${khongDau(hoTen)}`,
        `Vi tri ung tuyen: ${khongDau(viTri)}`,
        `Ky nang: ${kyNang.map(khongDau).join(', ')}`,
        `Kinh nghiem: 2 nam lam viec thuc te`,
        `Hoc van: Dai hoc - loai Kha`,
    ];
    const objs = [];
    objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
    objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>';
    objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>';
    const noiDung = 'BT /F1 12 Tf 40 260 Td 18 TL\n'
        + dong.map(d => `(${d.replace(/[\\()]/g, '')}) Tj T*`).join('\n')
        + '\nET';
    objs[4] = `<</Length ${noiDung.length}>>stream\n${noiDung}\nendstream`;
    objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';

    let pdf = '%PDF-1.4\n';
    const offset = [];
    for (let i = 1; i <= 5; i++) {
        offset[i] = pdf.length;
        pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) pdf += String(offset[i]).padStart(10, '0') + ' 00000 n \n';
    pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;

    return 'data:application/pdf;base64,' + Buffer.from(pdf, 'latin1').toString('base64');
}

// pdf.js doc font Helvetica chuan khong ho tro dau tieng Viet -> bo dau cho noi dung PDF
function khongDau(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * Cac ho so ung tuyen mau. Moi dong la: ung vien co that -> tin tuyen dung co that,
 * va nha tuyen dung nhan CV chinh la nguoi da dang tin do.
 */
const HO_SO = [
    {
        candidateId: 30, hoTen: 'Nguyễn Lê Tấn Tài', postId: 22, recruiterId: 18,
        viTri: 'Lập trình viên Reactjs', kyNang: ['Reactjs', 'Java', 'JS', 'MySQL', 'Angular', 'Blockchain'],
        moTa: 'Em có 2 năm kinh nghiệm làm Reactjs, mong được ứng tuyển vị trí này ạ.'
    },
    {
        candidateId: 31, hoTen: 'Trần Văn Kha', postId: 31, recruiterId: 18,
        viTri: 'Lập trình viên Reactjs', kyNang: ['Reactjs', 'Nextjs', 'Java', 'Nodejs'],
        moTa: 'Em thành thạo Reactjs và Nextjs, đã làm 3 dự án thực tế.'
    },
    {
        candidateId: 36, hoTen: 'Trần Thị My', postId: 46, recruiterId: 34,
        viTri: 'Tuyển dụng Developer', kyNang: ['Reactjs', 'Nextjs', 'Java', 'Figma', 'Jira'],
        moTa: 'Em quan tâm vị trí Developer, gửi anh/chị CV của em ạ.'
    },
    {
        candidateId: 33, hoTen: 'Trần Văn Nghĩa', postId: 45, recruiterId: 34,
        viTri: 'Tuyển dụng lập trình viên', kyNang: ['C#', 'MySQL', 'MSSQL', 'Python', 'Machine Learning'],
        moTa: 'Em có kinh nghiệm C# và cơ sở dữ liệu, rất mong được trao đổi thêm.'
    },
    {
        candidateId: 5, hoTen: 'Lê Thị Kim Ảnh', postId: 1, recruiterId: 2,
        viTri: 'Chuyên Viên Tài Chính', kyNang: ['Java', 'Nodejs', 'JS', 'Vuejs', 'Angular'],
        moTa: 'Em gửi CV ứng tuyển vị trí Chuyên viên tài chính ạ.'
    },
    {
        candidateId: 9, hoTen: 'Nguyễn Lê Tấn Tài', postId: 32, recruiterId: 19,
        viTri: 'Nhân viên kinh doanh', kyNang: ['Giải quyết vấn đề'],
        moTa: 'Em muốn ứng tuyển vị trí nhân viên kinh doanh của công ty.'
    },
];

/**
 * Hoi thoai mau. Moi hoi thoai la giua mot ung vien va DUNG nguoi da dang tin
 * ma ung vien quan tam, dung y nhu luong that: xem tin -> bam "Nhắn tin cho nhà
 * tuyển dụng" -> trao doi.
 */
const HOI_THOAI = [
    {
        candidateId: 30, recruiterId: 18, tin: 'Lập trình viên Reactjs', ngay: '2025-06-10',
        loi: [
            ['c', '09:00:00', 'Chào anh/chị, em thấy công ty đang tuyển Lập trình viên Reactjs. Vị trí này có yêu cầu kinh nghiệm tối thiểu bao nhiêu năm ạ?'],
            ['r', '09:12:00', 'Chào em, vị trí này bên anh cần tối thiểu 1 năm kinh nghiệm Reactjs, có biết thêm Nextjs là một lợi thế.'],
            ['c', '09:15:00', 'Dạ em có 2 năm làm Reactjs và đã dùng qua Nextjs ở dự án gần nhất ạ.'],
            ['r', '09:20:00', 'Vậy rất phù hợp. Em nộp CV qua tin tuyển dụng giúp anh nhé, bên anh sẽ xem và hẹn phỏng vấn trong tuần này.'],
            ['c', '09:22:00', 'Dạ vâng, em vừa nộp CV rồi ạ. Em cảm ơn anh!'],
        ]
    },
    {
        candidateId: 36, recruiterId: 34, tin: 'Tuyển dụng Developer', ngay: '2025-06-12',
        loi: [
            ['c', '14:05:00', 'Chào anh/chị, cho em hỏi vị trí Developer bên mình làm việc onsite hay có hỗ trợ remote ạ?'],
            ['r', '14:30:00', 'Chào em, bên công ty làm onsite từ thứ 2 đến thứ 6, được remote 1 ngày mỗi tuần em nhé.'],
            ['c', '14:33:00', 'Dạ em rõ rồi ạ. Mức lương vị trí này khoảng bao nhiêu ạ?'],
            ['r', '14:40:00', 'Tùy năng lực em nhé, khoảng 15-22 triệu. Em cứ gửi CV để bên anh đánh giá cụ thể hơn.'],
        ]
    },
    {
        candidateId: 33, recruiterId: 34, tin: 'Tuyển dụng lập trình viên', ngay: '2025-06-14',
        loi: [
            ['c', '10:00:00', 'Chào anh, em thấy tin tuyển lập trình viên của công ty. Bên mình có làm mảng dữ liệu không ạ?'],
            ['r', '10:25:00', 'Chào em, bên anh có một nhóm làm về xử lý dữ liệu và báo cáo. Em có kinh nghiệm mảng này chưa?'],
            ['c', '10:28:00', 'Dạ em làm C# với MSSQL được 2 năm, có học thêm Python và Machine Learning ạ.'],
        ]
    },
    {
        candidateId: 31, recruiterId: 18, tin: 'Lập trình viên Reactjs', ngay: '2025-06-15',
        loi: [
            ['c', '16:10:00', 'Chào anh/chị, em đã nộp CV vị trí Reactjs, không biết bên mình đã xem chưa ạ?'],
            ['r', '16:45:00', 'Anh vừa xem CV của em, hồ sơ khá phù hợp. Em sắp xếp được lịch phỏng vấn thứ 5 tuần này không?'],
            ['c', '16:47:00', 'Dạ được ạ, em cảm ơn anh nhiều!'],
        ]
    },
    {
        candidateId: 9, recruiterId: 19, tin: 'Nhân viên kinh doanh', ngay: '2025-06-18',
        loi: [
            ['c', '08:30:00', 'Chào anh/chị, vị trí Nhân viên kinh doanh có yêu cầu kinh nghiệm bất động sản không ạ?'],
            ['r', '09:00:00', 'Chào em, chưa có kinh nghiệm vẫn được nhé, bên anh đào tạo 1 tháng đầu.'],
        ]
    },
];

async function setupDemoData(existingConnection, { emitSql = false } = {}) {
    const databaseName = process.env.DB_NAME || 'jobfindtest';
    const connection = emitSql ? null : (existingConnection || await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: databaseName
    }));

    const sql = [];
    const hashMatKhau = bcrypt.hashSync(DEMO_PASSWORD, 10);

    const run = async (cauLenh, thamSo = []) => {
        if (emitSql) {
            sql.push(dienThamSo(cauLenh, thamSo));
            return { affectedRows: 0 };
        }
        const [r] = await connection.query(cauLenh, thamSo);
        return r;
    };

    try {
        if (connection) await connection.query(`USE \`${databaseName}\``);

        // ---- 1. Mat khau dung duoc cho moi tai khoan demo ----
        const r1 = await run('UPDATE accounts SET password = ?', [hashMatKhau]);
        if (!emitSql) console.log(`  ✔ Đặt mật khẩu "${DEMO_PASSWORD}" cho ${r1.affectedRows} tài khoản`);

        // ---- 2. CV ung tuyen ----
        let soCv = 0;
        for (let i = 0; i < HO_SO.length; i++) {
            const h = HO_SO[i];
            const file = taoCvPdf(h.hoTen, h.viTri, h.kyNang);
            await run(
                `INSERT INTO cvs (id, userId, file, postId, isChecked, description, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE file = VALUES(file), description = VALUES(description)`,
                [CV_ID_BASE + i, h.candidateId, file, h.postId, i < 2 ? 1 : 0, h.moTa,
                `2025-06-${String(10 + i).padStart(2, '0')} 03:00:00`, `2025-06-${String(10 + i).padStart(2, '0')} 03:00:00`]
            );
            soCv++;
        }
        if (!emitSql) console.log(`  ✔ Thêm ${soCv} CV ứng tuyển (kèm file PDF thật)`);

        // ---- 3. Hoi thoai chat ----
        let idChat = CHAT_ID_BASE;
        let soTin = 0;
        for (const ht of HOI_THOAI) {
            for (let k = 0; k < ht.loi.length; k++) {
                const [ai, gio, noiDung] = ht.loi[k];
                const senderId = ai === 'c' ? ht.candidateId : ht.recruiterId;
                const receiverId = ai === 'c' ? ht.recruiterId : ht.candidateId;
                // Tin cuoi cung cua ung vien de chua doc -> nha tuyen dung thay badge
                const chuaDoc = (k === ht.loi.length - 1 && ai === 'c') ? 0 : 1;
                const thoiDiem = `${ht.ngay} ${gio}`;
                await run(
                    `INSERT INTO chatmessages (id, senderId, receiverId, content, isRead, createdAt, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE content = VALUES(content), isRead = VALUES(isRead)`,
                    [idChat++, senderId, receiverId, noiDung, chuaDoc, thoiDiem, thoiDiem]
                );
                soTin++;
            }
        }
        if (!emitSql) console.log(`  ✔ Thêm ${soTin} tin nhắn (${HOI_THOAI.length} cuộc trò chuyện ứng viên ↔ nhà tuyển dụng)`);

        // ---- 4. Thong bao "co CV moi" cho nha tuyen dung ----
        const nhaTuyenDung = [...new Set(HO_SO.map(h => h.recruiterId))];
        for (let i = 0; i < nhaTuyenDung.length; i++) {
            const soLuong = HO_SO.filter(h => h.recruiterId === nhaTuyenDung[i]).length;
            await run(
                `INSERT INTO notifications (id, userId, typeCode, isChecked, content, link, createdAt, updatedAt)
                 VALUES (?, ?, 'NEW_CV', 0, ?, '/admin/manage-cv/', ?, ?)
                 ON DUPLICATE KEY UPDATE content = VALUES(content)`,
                [NOTI_ID_BASE + i, nhaTuyenDung[i],
                `Có ${soLuong} ứng viên vừa nộp CV vào tin tuyển dụng của bạn`,
                '2025-06-20 03:00:00', '2025-06-20 03:00:00']
            );
        }
        if (!emitSql) console.log(`  ✔ Thêm ${nhaTuyenDung.length} thông báo "có CV mới" cho nhà tuyển dụng`);

        if (emitSql) return sql.join('\n');
    } finally {
        if (connection && !existingConnection) await connection.end();
    }
}

// Thay ? bang gia tri that de xuat ra file .sql
function dienThamSo(cauLenh, thamSo) {
    let i = 0;
    const s = cauLenh.replace(/\?/g, () => {
        const v = thamSo[i++];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    });
    return s.replace(/\s+/g, ' ').trim() + ';';
}

module.exports = setupDemoData;

if (require.main === module) {
    const emitSql = process.argv.includes('--sql');
    setupDemoData(null, { emitSql })
        .then((out) => {
            if (emitSql) console.log(out);
            else console.log(`\nXong. Mọi tài khoản demo đăng nhập bằng mật khẩu: ${DEMO_PASSWORD}`);
        })
        .catch(error => {
            console.error(`Dựng dữ liệu demo thất bại: ${error.message}`);
            process.exitCode = 1;
        });
}
