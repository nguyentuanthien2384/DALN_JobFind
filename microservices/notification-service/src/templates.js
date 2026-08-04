// Noi dung thong bao gom mot cho.
//
// Gom lai de sua chu nghia khong phai lan mo trong logic xu ly, va de nhin thay
// ngay giong dieu chung cua ca he thong. Moi mau tra ve ca ban ngan (hien trong
// chuong thong bao) lan ban day du (gui qua email).

const STAGE_MESSAGES = {
    dang_xem_xet: {
        short: (job) => `Hồ sơ của bạn ứng tuyển "${job}" đang được xem xét`,
        subject: (job) => `Hồ sơ ứng tuyển ${job} đang được xem xét`,
        body: (name, job, company) => `
            <p>Chào ${name || 'bạn'},</p>
            <p>Nhà tuyển dụng ${company || ''} đã mở hồ sơ bạn ứng tuyển vị trí
            <b>${job}</b> và đang xem xét.</p>
            <p>Chúng tôi sẽ báo bạn ngay khi có bước tiếp theo.</p>`
    },
    phong_van: {
        short: (job) => `Bạn được mời phỏng vấn vị trí "${job}"`,
        subject: (job) => `Mời phỏng vấn vị trí ${job}`,
        body: (name, job, company) => `
            <p>Chào ${name || 'bạn'},</p>
            <p>Chúc mừng! Hồ sơ của bạn cho vị trí <b>${job}</b>
            ${company ? `tại ${company}` : ''} đã qua vòng sàng lọc và được mời phỏng vấn.</p>
            <p>Nhà tuyển dụng sẽ liên hệ với bạn để hẹn lịch cụ thể.</p>`
    },
    de_nghi: {
        short: (job) => `Bạn nhận được đề nghị nhận việc cho vị trí "${job}"`,
        subject: (job) => `Đề nghị nhận việc — ${job}`,
        body: (name, job, company) => `
            <p>Chào ${name || 'bạn'},</p>
            <p>Chúc mừng! ${company || 'Nhà tuyển dụng'} muốn mời bạn về làm việc ở vị trí
            <b>${job}</b>.</p>
            <p>Vui lòng liên hệ lại với nhà tuyển dụng để trao đổi chi tiết.</p>`
    },
    nhan_viec: {
        short: (job) => `Bạn đã nhận việc vị trí "${job}"`,
        subject: (job) => `Chúc mừng bạn nhận việc — ${job}`,
        body: (name, job, company) => `
            <p>Chào ${name || 'bạn'},</p>
            <p>Chúc mừng bạn đã chính thức nhận việc ở vị trí <b>${job}</b>
            ${company ? `tại ${company}` : ''}.</p>
            <p>Chúc bạn có khởi đầu thuận lợi!</p>`
    },
    tu_choi: {
        short: (job) => `Hồ sơ ứng tuyển "${job}" chưa phù hợp lần này`,
        subject: (job) => `Kết quả ứng tuyển vị trí ${job}`,
        body: (name, job) => `
            <p>Chào ${name || 'bạn'},</p>
            <p>Cảm ơn bạn đã quan tâm tới vị trí <b>${job}</b>. Rất tiếc lần này hồ sơ
            của bạn chưa phù hợp với yêu cầu.</p>
            <p>Chúng tôi sẽ lưu hồ sơ của bạn và liên hệ khi có vị trí phù hợp hơn.
            Chúc bạn sớm tìm được công việc như ý.</p>`
    }
};

export const applicationStageTemplate = ({ toStage, jobTitle, candidateName, companyName }) => {
    const tpl = STAGE_MESSAGES[toStage];
    // Buoc "moi ung tuyen" khong can bao lai cho ung vien: chinh ho vua bam nop.
    if (!tpl) return null;

    return {
        typeCode: 'APPLICATION_STAGE',
        content: tpl.short(jobTitle || 'vị trí đã ứng tuyển'),
        link: '/candidate/manage-cv',
        email: {
            subject: tpl.subject(jobTitle || 'đã ứng tuyển'),
            html: wrap(tpl.body(candidateName, jobTitle || 'đã ứng tuyển', companyName))
        }
    };
};

export const jobModeratedTemplate = ({ approved, jobTitle, reason }) => ({
    typeCode: approved ? 'POST_APPROVED' : 'POST_REJECTED',
    content: approved
        ? `Tin tuyển dụng "${jobTitle}" đã được duyệt và đang hiển thị`
        : `Tin tuyển dụng "${jobTitle}" bị từ chối${reason ? `: ${reason}` : ''}`,
    link: '/admin/list-post/',
    email: {
        subject: approved
            ? `Tin tuyển dụng đã được duyệt — ${jobTitle}`
            : `Tin tuyển dụng chưa được duyệt — ${jobTitle}`,
        html: wrap(approved
            ? `<p>Tin tuyển dụng <b>${jobTitle}</b> của bạn đã qua kiểm duyệt và
               đang hiển thị với ứng viên.</p>`
            : `<p>Tin tuyển dụng <b>${jobTitle}</b> chưa qua được kiểm duyệt.</p>
               ${reason ? `<p><b>Lý do:</b> ${reason}</p>` : ''}
               <p>Bạn có thể chỉnh sửa nội dung rồi đăng lại.</p>`)
    }
});

// Bao cho nha tuyen dung khi co nguoi vua ung tuyen.
//
// Thieu thong bao nay thi nha tuyen dung phai tu mo bang Kanban ra kiem tra moi
// biet co ai nop chua - ho so de nam do nhieu ngay, ung vien cho mai khong thay
// hoi am roi bo di.
export const newApplicationTemplate = ({ candidateName, jobTitle }) => ({
    typeCode: 'NEW_CV',
    content: `${candidateName || 'Một ứng viên'} vừa ứng tuyển vị trí "${jobTitle || 'tin tuyển dụng của bạn'}"`,
    link: '/admin/pipeline/',
    email: {
        subject: `Hồ sơ ứng tuyển mới — ${jobTitle || 'tin tuyển dụng của bạn'}`,
        html: wrap(`
            <p>Bạn vừa nhận được một hồ sơ ứng tuyển mới.</p>
            <p><b>Ứng viên:</b> ${candidateName || 'Chưa rõ tên'}<br>
               <b>Vị trí:</b> ${jobTitle || 'Chưa rõ'}</p>
            <p>Vào mục <b>Quản lý ứng viên → Quy trình tuyển dụng</b> để xem hồ sơ.</p>`)
    }
});

export const newJobFromFollowedCompanyTemplate = ({ jobTitle, companyName, jobId }) => ({
    typeCode: 'NEW_POST',
    content: `${companyName || 'Công ty bạn theo dõi'} vừa đăng tin tuyển dụng: ${jobTitle}`,
    link: `/detail-job/${jobId}`,
    email: {
        subject: `${companyName || 'Công ty bạn theo dõi'} vừa đăng tin mới`,
        html: wrap(`<p>${companyName || 'Công ty bạn theo dõi'} vừa đăng tin tuyển dụng
                    <b>${jobTitle}</b>.</p>`)
    }
});

// Khung email chung cho moi loai thong bao.
function wrap(inner) {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;
                max-width:560px;margin:0 auto;padding:20px">
        <h2 style="color:#2563eb;margin:0 0 16px">Job Finder</h2>
        ${inner}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
        <p style="font-size:12px;color:#888">
            Email tự động từ hệ thống Job Finder, vui lòng không trả lời thư này.
        </p>
    </div>`;
}
