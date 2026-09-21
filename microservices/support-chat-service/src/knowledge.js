// Reviewed public product instructions only. Never index users, CVs, orders or chats.
export const articles = [
    { id: 'account', title: 'Đăng ký, đăng nhập và khôi phục mật khẩu', keywords: 'tai khoan dang ky dang nhap quen mat khau otp ma xac thuc email', text: 'Mở /register để tạo tài khoản ứng viên hoặc nhà tuyển dụng; đăng nhập tại /login. Nếu quên mật khẩu, mở /forget-password, nhập số điện thoại đã đăng ký rồi yêu cầu mã xác thực. Mã OTP gồm 6 chữ số được gửi tới email gắn với tài khoản và có hiệu lực 5 phút. Nhập mã cùng mật khẩu mới và xác nhận mật khẩu trên trang này. Nếu chưa nhận được mã, kiểm tra đúng hộp thư, thư rác rồi dùng “Gửi lại mã”; nếu vẫn lỗi, liên hệ hỗ trợ tại /contact. Không gửi mật khẩu, OTP hoặc khóa API cho chatbot hay người lạ.' },
    { id: 'jobs', title: 'Tìm và xem việc đang tuyển', keywords: 'tim viec tuyen dung dia diem luong react java remote', text: 'Mở /job, nhập từ khóa và chọn các bộ lọc phù hợp. Mở chi tiết tin để kiểm tra hạn tuyển, địa điểm, mức lương và yêu cầu. Chatbot chỉ giới thiệu tin đã được duyệt và còn hạn; không cam kết bạn sẽ được tuyển. Khi không có kết quả, thử bớt từ khóa hoặc mở rộng địa điểm.' },
    { id: 'cv', title: 'Tạo CV và ứng tuyển', keywords: 'tao cv ho so ung tuyen nop don', text: 'Đăng nhập bằng tài khoản ứng viên và cập nhật hồ sơ tại /candidate/info. Khi tính năng trợ lý CV được bật, mở /candidate/ai-cv để soạn CV, xem trước hoặc tải PDF. Mở một tin đang tuyển tại /job, chọn “Ứng tuyển”, chọn CV theo các lựa chọn đang hiển thị và kiểm tra trước khi bấm “Gửi hồ sơ”. Theo dõi kết quả ở /candidate/cv-post. Không gửi CV có thông tin riêng tư vào chatbot hỗ trợ. Chatbot không tự nộp hồ sơ thay bạn.' },
    { id: 'applications', title: 'Theo dõi đơn ứng tuyển', keywords: 'trang thai don ung tuyen phong van tu choi da nop ho so', text: 'Ứng viên xem đơn đã nộp tại /candidate/cv-post. Trong chatbot, chọn “Đơn ứng tuyển của tôi” để đọc trạng thái do hệ thống lưu. Chưa có phản hồi không có nghĩa là bị từ chối. Nếu dữ liệu chưa đồng bộ, kiểm tra lại sau hoặc chuyển yêu cầu cho nhân viên hỗ trợ.' },
    { id: 'saved', title: 'Việc làm đã lưu', keywords: 'viec lam da luu yeu thich bo luu', text: 'Đăng nhập ứng viên rồi dùng nút lưu trên tin tuyển dụng. Xem danh sách tại /candidate/saved-jobs. Tin đã lưu có thể đã hết hạn; lưu tin không đồng nghĩa đã ứng tuyển.' },
    { id: 'employer', title: 'Nhà tuyển dụng và tin đăng', keywords: 'cong ty nha tuyen dung dang tin duyet khoa nhan vien', text: 'Nhà tuyển dụng cần có công ty đang hoạt động và đã được duyệt để quản lý tuyển dụng. Mở /admin/list-post để quản lý bài đăng hoặc /admin/add-post để tạo tin. Tin chờ duyệt hoặc hết hạn không xuất hiện trong kết quả chatbot công khai. Nhân viên chỉ được thao tác trong phạm vi công ty của mình.' },
    { id: 'payment', title: 'Gói đăng tin và thanh toán', keywords: 'goi cuoc thanh toan mua goi giao dich han muc so du', text: 'Chủ công ty đang hoạt động và đã được duyệt mở /admin/buy-post để mua gói đăng tin, /admin/history-post để xem lịch sử giao dịch đăng tin; tài khoản nhân viên không có quyền mua gói. Kiểm tra hạn mức hiển thị trên trang đăng tin. Nếu đã thanh toán nhưng chưa nhận gói, không thanh toán lặp lại ngay; chuyển yêu cầu hỗ trợ kèm mã giao dịch qua kênh được bảo vệ. Chatbot không xác nhận thanh toán hoặc tự mua gói thay bạn.' },
    { id: 'chat', title: 'Nhắn tin và hỗ trợ trực tiếp', keywords: 'nhan tin lien he ho tro nhan vien chat loi ket noi', text: 'Để nhắn tin với nhà tuyển dụng, đăng nhập bằng tài khoản ứng viên, mở chi tiết tin tuyển dụng và bấm “Nhắn tin cho nhà tuyển dụng”; xem lại tại /chat. Nhà tuyển dụng dùng mục Tin nhắn ở /admin/chat. Hai tài khoản phải đang hoạt động và công ty nhà tuyển dụng phải đã được duyệt. Để gặp nhân viên hỗ trợ JobFind, đăng nhập, đồng ý chia sẻ hội thoại rồi chọn “Chuyển hội thoại cho hỗ trợ” trong chatbot. Khi nhân viên tiếp nhận, bấm “Mở tin nhắn” để trao đổi; tài khoản nhà tuyển dụng chưa được duyệt vẫn có thể dùng kênh hỗ trợ này. Nếu chưa có người tiếp nhận, yêu cầu ở trạng thái chờ; hệ thống không hứa thời gian phản hồi.' },
    { id: 'privacy', title: 'Dữ liệu hội thoại và quyền riêng tư', keywords: 'du lieu rieng tu xoa lich su luu bao lau tai xuong', text: 'Hội thoại được lưu trên máy chủ theo thời hạn cấu hình (mặc định 30 ngày). Bấm biểu tượng “Lịch sử trò chuyện” ở đầu chatbot, rồi chọn hội thoại để xem lại; bạn cũng có thể tải xuống hoặc xóa từng hội thoại. Khách có thể mở lại lịch sử trên cùng trình duyệt bằng mã truy cập được lưu tại đó, có hiệu lực tối đa 30 ngày. Xóa dữ liệu trình duyệt hoặc kết thúc phiên riêng tư có thể làm mất quyền truy cập lịch sử khách. Đăng nhập cùng tài khoản để xem lịch sử của tài khoản đó trên các thiết bị; lịch sử khách không tự chuyển sang tài khoản. Kết quả tra cứu cá nhân không gửi cho nhà cung cấp AI. Phần tóm tắt đã chuyển sang Tin nhắn với nhân viên chịu chính sách lưu trữ của hệ thống Tin nhắn; xóa hội thoại chatbot không xóa bản sao này. Không nhập mật khẩu, OTP, số tài khoản hoặc nội dung CV.' }
].map(article => ({ ...article, href: `/support/help#${article.id}`, version: 2 }));
export const normalize = text => String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const topicPhrases = {
    account: ['dang ky', 'dang nhap', 'mat khau', 'otp', 'ma xac thuc'],
    jobs: ['tim viec', 'tim cong viec', 'viec dang tuyen', 'muc luong', 'react', 'java', 'remote'],
    cv: ['tao cv', 'soan cv', 'cv', 'nop ho so', 'gui ho so', 'ung tuyen', 'ho so'],
    applications: ['don ung tuyen', 'trang thai ho so', 'da nop', 'da ung tuyen', 'phong van', 'tu choi'],
    saved: ['da luu', 'luu tin', 'luu viec', 'yeu thich', 'bo luu'],
    employer: ['dang tin', 'duyet tin', 'tao tin', 'quan ly bai dang', 'cong ty chua duyet'],
    payment: ['thanh toan', 'mua goi', 'han muc', 'goi cuoc', 'goi dang tin', 'giao dich', 'so du'],
    chat: ['nhan tin', 'lien he nha tuyen dung', 'gap nhan vien', 'ho tro truc tiep', 'chuyen hoi thoai', 'loi ket noi'],
    privacy: ['lich su', 'hoi thoai', 'tro chuyen', 'rieng tu', 'xoa du lieu', 'luu bao lau', 'tai xuong'],
};
const wordsOf = text => normalize(text).match(/[a-z0-9]+/g) || [];
const stopWords = new Set(['toi', 'cua', 'cho', 'voi', 'nhung', 'mot', 'ban', 'the', 'nao', 'lam', 'sao', 'muon', 'can', 'hay', 'xin', 'vui', 'long', 'co', 'khong', 'duoc', 'thi', 'phai', 'gi', 'o', 'dau', 'va']);
export function localKnowledge(query) {
    const queryWords = wordsOf(query);
    const words = [...new Set(queryWords)].filter(word => !stopWords.has(word));
    const phraseQuery = ` ${queryWords.join(' ')} `;
    const ranked = articles.map(article => {
        const terms = new Set(wordsOf(`${article.title} ${article.keywords}`));
        // Match whole words: "ha" must not match "thanh", "nhan" or "khau".
        const wordScore = words.filter(word => terms.has(word)).length;
        const phraseScore = topicPhrases[article.id].reduce((score, phrase) =>
            phraseQuery.includes(` ${phrase} `) ? Math.max(score, 5 + phrase.split(' ').length) : score, 0);
        return { article, score: wordScore + phraseScore };
    }).filter(item => item.score >= 2).sort((a, b) => b.score - a.score);
    const threshold = Math.max(2, (ranked[0]?.score || 0) * 0.65);
    return ranked.filter(item => item.score >= threshold).slice(0, 3).map(item => item.article);
}
export async function retrieveKnowledge(query, { signal, env = process.env, fetcher = fetch } = {}) {
    // Prefer reviewed phrase matches so stale search indexes cannot displace a
    // precise how-to answer with a document that shares only generic words.
    const local = localKnowledge(query);
    if (local.length) return local;
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
