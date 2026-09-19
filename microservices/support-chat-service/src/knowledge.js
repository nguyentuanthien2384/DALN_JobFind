// Reviewed public product instructions only. Never index users, CVs, orders or chats.
export const articles = [
    { id: 'account', title: 'Đăng ký và đăng nhập', keywords: 'tai khoan dang ky dang nhap quen mat khau otp', text: 'Mở /register để tạo tài khoản ứng viên hoặc nhà tuyển dụng. Đăng nhập tại /login. Nếu quên mật khẩu, mở /forget-password và làm theo bước xác minh. Không gửi mật khẩu, OTP hoặc khóa API cho chatbot hay người lạ.' },
    { id: 'jobs', title: 'Tìm và xem việc đang tuyển', keywords: 'tim viec tuyen dung dia diem luong react java remote', text: 'Mở /job, nhập từ khóa và chọn các bộ lọc phù hợp. Mở chi tiết tin để kiểm tra hạn tuyển, địa điểm, mức lương và yêu cầu. Chatbot chỉ giới thiệu tin đã được duyệt và còn hạn; không cam kết bạn sẽ được tuyển. Khi không có kết quả, thử bớt từ khóa hoặc mở rộng địa điểm.' },
    { id: 'cv', title: 'Tạo CV và ứng tuyển', keywords: 'tao cv ho so ung tuyen nop don', text: 'Đăng nhập bằng tài khoản ứng viên. Mở /candidate/ai-cv để làm việc với CV; cập nhật hồ sơ tại /candidate/info. Mở tin đang tuyển, chọn ứng tuyển và kiểm tra CV trước khi gửi. Không gửi CV có thông tin riêng tư vào chatbot hỗ trợ. Chatbot không tự nộp hồ sơ thay bạn.' },
    { id: 'applications', title: 'Theo dõi đơn ứng tuyển', keywords: 'trang thai don ung tuyen phong van tu choi da nop ho so', text: 'Ứng viên xem đơn đã nộp tại /candidate/cv-post. Trong chatbot, chọn “Đơn ứng tuyển của tôi” để đọc trạng thái do hệ thống lưu. Chưa có phản hồi không có nghĩa là bị từ chối. Nếu dữ liệu chưa đồng bộ, kiểm tra lại sau hoặc chuyển yêu cầu cho nhân viên hỗ trợ.' },
    { id: 'saved', title: 'Việc làm đã lưu', keywords: 'viec lam da luu yeu thich bo luu', text: 'Đăng nhập ứng viên rồi dùng nút lưu trên tin tuyển dụng. Xem danh sách tại /candidate/saved-jobs. Tin đã lưu có thể đã hết hạn; lưu tin không đồng nghĩa đã ứng tuyển.' },
    { id: 'employer', title: 'Nhà tuyển dụng và tin đăng', keywords: 'cong ty nha tuyen dung dang tin duyet khoa nhan vien', text: 'Nhà tuyển dụng cần có công ty đang hoạt động và đã được duyệt để quản lý tuyển dụng. Trong khu vực quản trị, mở mục quản lý bài đăng để tạo hoặc sửa tin. Tin chờ duyệt hoặc hết hạn không xuất hiện trong kết quả chatbot công khai. Nhân viên chỉ được thao tác trong phạm vi công ty của mình.' },
    { id: 'payment', title: 'Gói đăng tin và thanh toán', keywords: 'goi cuoc thanh toan mua goi giao dich han muc so du', text: 'Mở mục mua gói và lịch sử giao dịch trong khu vực nhà tuyển dụng. Kiểm tra hạn mức hiển thị trên trang đăng tin. Nếu đã thanh toán nhưng chưa nhận gói, không thanh toán lặp lại ngay; chuyển yêu cầu hỗ trợ kèm mã giao dịch qua kênh được bảo vệ. Chatbot không xác nhận thanh toán hoặc tự mua gói thay bạn.' },
    { id: 'chat', title: 'Nhắn tin và hỗ trợ trực tiếp', keywords: 'nhan tin lien he ho tro nhan vien chat loi ket noi', text: 'Đăng nhập để dùng tin nhắn tại /chat hoặc mục Tin nhắn trong khu vực quản trị. Muốn gặp nhân viên, chọn “Chuyển hội thoại cho hỗ trợ” trong chatbot. Nội dung hội thoại được chia sẻ với người tiếp nhận. Nếu chưa có người tiếp nhận, yêu cầu ở trạng thái chờ; hệ thống không hứa thời gian phản hồi. Bạn có thể xóa hội thoại và yêu cầu hỗ trợ liên quan trong lịch sử.' },
    { id: 'privacy', title: 'Dữ liệu hội thoại và quyền riêng tư', keywords: 'du lieu rieng tu xoa lich su luu bao lau tai xuong', text: 'Hội thoại được lưu trên máy chủ theo thời hạn cấu hình (mặc định 30 ngày). Bạn có thể tải xuống hoặc xóa từng hội thoại trong lịch sử. Khách chỉ truy cập bằng mã phiên trên trình duyệt; tài khoản đăng nhập xem được lịch sử của chính mình. Tra cứu cá nhân hiển thị trực tiếp, không gửi kết quả đó cho nhà cung cấp AI. Phần tóm tắt đã chuyển sang Tin nhắn với nhân viên chịu chính sách lưu trữ của hệ thống Tin nhắn; xóa hội thoại chatbot không xóa bản sao này. Không nhập mật khẩu, OTP, số tài khoản hoặc nội dung CV.' }
].map(article => ({ ...article, href: `/support/help#${article.id}`, version: 1 }));
export const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
export function localKnowledge(query) {
    const words = [...new Set(normalize(query).match(/[a-z0-9]{2,}/g) || [])].filter(word => !['toi','cua','cho','voi','nhung','mot','ban','the','nao','lam'].includes(word));
    return articles.map(article => ({ article, score: words.reduce((n, word) => n + (normalize(`${article.title} ${article.keywords}`).includes(word) ? 1 : 0), 0) }))
        .filter(item => item.score >= 2 || (item.score && words.length <= 2)).sort((a,b) => b.score - a.score).slice(0, 3).map(item => item.article);
}
export async function retrieveKnowledge(query, { signal, env = process.env, fetcher = fetch } = {}) {
    if (env.ELASTICSEARCH_URL) {
        try {
            const response = await fetcher(`${env.ELASTICSEARCH_URL.replace(/\/$/, '')}/support_kb_v1/_search`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(1500)]),
                body: JSON.stringify({ size: 3, query: { multi_match: { query: normalize(query), fields: ['title^3', 'keywords^2', 'text'], minimum_should_match: '40%' } } })
            });
            if (response.ok) {
                const data = await response.json();
                // Resolve IDs against reviewed corpus: index contents cannot inject instructions/URLs.
                const hits = (data.hits?.hits || []).map(hit => articles.find(article => article.id === hit._id)).filter(Boolean);
                if (hits.length) return hits;
            }
        } catch { /* Public bundled knowledge remains available when search is down. */ }
    }
    return localKnowledge(query);
}
export const knowledgeAnswer = sources => sources.length
    ? `AI hiện chưa sẵn sàng. Dưới đây là hướng dẫn đã được lưu của JobFind:\n\n${sources.map(source => `**${source.title}**\n${source.text}`).join('\n\n')}\n\nBạn có thể chuyển hội thoại cho nhân viên nếu hướng dẫn chưa giải quyết được vấn đề.`
    : 'AI hiện chưa sẵn sàng và tôi chưa tìm thấy hướng dẫn đủ phù hợp. Bạn hãy mô tả rõ thao tác đang gặp lỗi, chọn một mục tra cứu, hoặc chuyển hội thoại cho nhân viên hỗ trợ. Tôi chưa thể xác nhận thông tin ngoài dữ liệu JobFind.';
