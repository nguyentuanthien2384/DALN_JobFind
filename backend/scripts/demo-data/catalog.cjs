'use strict';
const { PROVINCES, JOB_LEVELS } = require('../../../microservices/shared/recruitmentCatalog.cjs');

// Pure, repeatable demo fixtures. All people, companies and achievements are fictional.
// No database or external service is contacted by this module.
const DAY = 24 * 60 * 60 * 1000;
const VERSION = 'jobfind-rich-demo-v1';
const FICTION = 'Dữ liệu giả lập phục vụ trình diễn Job Finder; không phải thông tin tuyển dụng thực tế.';
const pad = value => String(value).padStart(2, '0');
const html = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ascii = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7e\n]/g, '');
const sections = data => ({
  descriptionHTML: data.map(([title, lines]) => `<h3>${html(title)}</h3><ul>${lines.map(line => `<li>${html(line)}</li>`).join('')}</ul>`).join(''),
  descriptionMarkdown: data.map(([title, lines]) => `### ${title}\n${lines.map(line => `- ${line}`).join('\n')}`).join('\n\n'),
});

const SALARIES = [
  ['3-5tr', '3 - 5 triệu', 4000000], ['5-10tr', '5 - 10 triệu', 8000000],
  ['10-15tr', '10-15 triệu', 13000000], ['15-20tr', '15 - 20 triệu', 18000000],
  ['20-30tr', '20 - 30 triệu', 25000000], ['tren-30tr', 'Trên 30 triệu', 35000000],
  ['thoa-thuan', 'Thoả thuận', null],
];
const EXPERIENCES = [
  ['khong-yeu-cau', 'Không yêu cầu kinh nghiệm', 0], ['1-nam', '1 năm', 1],
  ['2-nam', '2 năm', 2], ['3nam', '3 năm', 3], ['tren-5-nam', 'Trên 5 năm', 6],
];
const COMPANIES = [
  ['cong-nghe-thong-tin', 'Công nghệ thông tin', 'Sao Khuê Digital', 'saokhue', 'Đà Nẵng', 180, 'phần mềm quản lý vận hành và sản phẩm thương mại điện tử', 'Khoa học máy tính', 'Xây dựng nền tảng sản phẩm có khả năng mở rộng; phát triển đội ngũ kỹ thuật và quy trình kiểm thử chất lượng.'],
  ['truyen-thong', 'Truyền thông', 'Mây Xanh Creative', 'mayxanh', 'Hồ Chí Minh', 95, 'chiến lược thương hiệu, nội dung số và tiếp thị hiệu suất', 'Marketing', 'Kết nối nội dung sáng tạo với dữ liệu đo lường; triển khai chiến dịch đa kênh cho doanh nghiệp bán lẻ.'],
  ['kinh-te', 'Kinh tế', 'An Phúc Commerce', 'anphuc', 'Hà Nội', 260, 'phân phối hàng tiêu dùng và giải pháp quản trị tài chính', 'Kinh tế doanh nghiệp', 'Chuẩn hóa dịch vụ khách hàng, phát triển kênh phân phối và cải thiện hiệu quả vận hành tài chính.'],
  ['quan-ly-nhan-su', 'Quản lý nhân sự', 'Kết Nối People', 'ketnoi', 'Hồ Chí Minh', 120, 'dịch vụ nhân sự, đào tạo nội bộ và phát triển tổ chức', 'Quản trị nhân lực', 'Đồng hành cùng doanh nghiệp xây dựng trải nghiệm nhân viên rõ ràng, công bằng và có khả năng đo lường.'],
  ['giao-vien', 'Giáo viên', 'Ánh Dương Learning', 'anhduong', 'Cần Thơ', 140, 'giáo dục ngoại ngữ, kỹ năng số và nội dung học tập trực tuyến', 'Sư phạm', 'Thiết kế chương trình học thực hành, theo dõi tiến bộ học viên và hỗ trợ giáo viên phát triển chuyên môn.'],
  ['bat-dong-san', 'Bất động sản', 'Không Gian Việt', 'khonggianviet', 'Đà Nẵng', 210, 'quản lý mặt bằng thương mại và vận hành tòa nhà', 'Quản lý bất động sản', 'Cung cấp quy trình tư vấn minh bạch và dịch vụ vận hành nhất quán cho khách thuê và chủ sở hữu.'],
  ['luat', 'Luật', 'Minh Định Legal', 'minhdinh', 'Hà Nội', 65, 'tư vấn pháp lý doanh nghiệp và quản lý hợp đồng', 'Luật kinh tế', 'Tổ chức hồ sơ, rà soát hợp đồng và hỗ trợ doanh nghiệp hiểu rõ trách nhiệm trong các giao dịch.'],
  ['logistics', 'Logistics / Chuỗi cung ứng', 'Hành Trình Logistics', 'hanhtrinh', 'Hải Phòng', 320, 'dịch vụ kho vận, điều phối giao nhận và quản lý chuỗi cung ứng', 'Logistics và quản lý chuỗi cung ứng', 'Ứng dụng dữ liệu trong lập kế hoạch vận tải, kiểm soát tồn kho và theo dõi chất lượng giao hàng.'],
];

// [title, salary code, experience code, skills, responsibilities, demonstrable project, achievement]
const ROLES = [
  [
    ['Frontend Developer React / TypeScript', '15-20tr', '2-nam', ['Reactjs', 'TypeScript', 'JS', 'HTML', 'CSS', 'Git'], ['Phát triển giao diện quản lý đơn hàng với React và TypeScript, hỗ trợ máy tính và thiết bị di động.', 'Kết nối REST API, xử lý biểu mẫu, trạng thái tải và thông báo lỗi có thể hiểu được.', 'Viết kiểm thử thành phần, rà soát mã nguồn và phối hợp cùng thiết kế trong từng sprint.'], 'Cổng quản lý đơn hàng đa thiết bị', 'Giảm thời gian tải trang danh sách từ 3,2 giây xuống 1,8 giây; bổ sung kiểm thử cho 24 luồng biểu mẫu.'],
    ['Backend Developer Node.js / MySQL', '20-30tr', '3nam', ['Nodejs', 'TypeScript', 'MySQL', 'REST API', 'Docker', 'Git'], ['Thiết kế API quản lý tồn kho, phân quyền và đồng bộ đơn hàng.', 'Tối ưu truy vấn MySQL, xử lý giao dịch và chống ghi trùng khi tiếp nhận sự kiện.', 'Theo dõi lỗi dịch vụ, viết tài liệu tích hợp và kiểm thử các tình huống tải cao.'], 'Dịch vụ đồng bộ tồn kho theo sự kiện', 'Xây dựng 18 API nghiệp vụ và giảm 42% thời gian xử lý truy vấn báo cáo trên tập dữ liệu thử nghiệm.'],
    ['QA Engineer Manual / Automation', '10-15tr', '1-nam', ['Test Case', 'Postman', 'SQL', 'Playwright', 'Jira'], ['Phân tích yêu cầu để lập kế hoạch và kịch bản kiểm thử.', 'Kiểm thử API, giao diện web và luồng phân quyền trước mỗi bản phát hành.', 'Ghi nhận lỗi có bằng chứng, tái kiểm tra và xây dựng bộ kiểm thử tự động.'], 'Bộ kiểm thử hành trình mua hàng', 'Thiết kế 120 test case, tự động hóa 35 kịch bản quan trọng và phát hiện 16 lỗi trước khi bàn giao.'],
    ['Data Analyst SQL / Power BI', '15-20tr', '2-nam', ['SQL', 'Power BI', 'Python', 'Excel', 'Data Visualization'], ['Xây dựng bộ chỉ số sản phẩm và báo cáo hoạt động theo tuần.', 'Làm sạch dữ liệu giao dịch, kiểm tra tính nhất quán và mô tả định nghĩa chỉ số.', 'Trình bày phát hiện cho bộ phận sản phẩm và đề xuất thử nghiệm cải thiện chuyển đổi.'], 'Bảng điều khiển tăng trưởng sản phẩm', 'Tự động hóa 8 báo cáo tuần, giảm 6 giờ tổng hợp thủ công và đối soát dữ liệu của 12 nguồn.'],
    ['DevOps Engineer Cloud / CI-CD', 'tren-30tr', 'tren-5-nam', ['Docker', 'Kubernetes', 'Linux', 'CI/CD', 'AWS', 'Terraform'], ['Quản lý cấu hình hạ tầng, quy trình triển khai và phân quyền môi trường.', 'Thiết lập cảnh báo, đo độ sẵn sàng và diễn tập phục hồi dữ liệu.', 'Phối hợp với nhóm phát triển tối ưu chi phí tài nguyên và thời gian phát hành.'], 'Chuẩn hóa nền tảng triển khai dịch vụ', 'Rút thời gian triển khai từ 45 xuống 12 phút và thực hiện 4 buổi diễn tập phục hồi có biên bản.'],
    ['Thực tập sinh phát triển Web', '3-5tr', 'khong-yeu-cau', ['HTML', 'CSS', 'JS', 'Git', 'Reactjs'], ['Xây dựng các trang giới thiệu và thành phần giao diện dưới sự hướng dẫn của người phụ trách.', 'Sửa lỗi hiển thị, bổ sung trạng thái trống và kiểm tra khả năng sử dụng trên điện thoại.', 'Tham gia họp nhóm, ghi chú kỹ thuật và trình bày kết quả cuối mỗi tuần.'], 'Ứng dụng quản lý lịch học cá nhân', 'Hoàn thành ứng dụng 8 màn hình, xử lý lưu trữ cục bộ và thử nghiệm với 15 người dùng giả lập.'],
  ],
  [
    ['Chuyên viên Performance Marketing', '15-20tr', '2-nam', ['Google Ads', 'Meta Ads', 'GA4', 'Excel', 'A/B Testing'], ['Lập kế hoạch ngân sách và triển khai chiến dịch quảng cáo tìm kiếm, mạng xã hội.', 'Theo dõi chuyển đổi, chi phí theo kênh và kiểm tra sự chính xác của mã đo lường.', 'Phối hợp nội dung và thiết kế để thử nghiệm thông điệp theo từng nhóm khách hàng.'], 'Chiến dịch giới thiệu bộ sưu tập bán lẻ', 'Thực hiện 12 thử nghiệm nội dung, giảm 18% chi phí khách hàng tiềm năng trên ngân sách giả lập.'],
    ['Content Marketing / Biên tập nội dung', '10-15tr', '1-nam', ['Content Writing', 'SEO', 'WordPress', 'Canva', 'Copywriting'], ['Xây dựng lịch biên tập theo tuần và tài liệu giọng điệu thương hiệu.', 'Viết bài website, email và nội dung mạng xã hội có kiểm tra nguồn thông tin.', 'Theo dõi hiệu quả bài viết và cập nhật nội dung theo phản hồi của người đọc.'], 'Thư viện nội dung chăm sóc khách hàng', 'Biên tập 40 bài viết chuyên đề và xây dựng 6 nhóm nội dung theo hành trình tìm hiểu sản phẩm.'],
    ['Chuyên viên SEO Website', '15-20tr', '2-nam', ['SEO', 'Google Search Console', 'GA4', 'Keyword Research', 'HTML'], ['Phân tích từ khóa và lập bản đồ nội dung cho website khách hàng.', 'Phối hợp kỹ thuật xử lý lỗi lập chỉ mục, liên kết và tốc độ trang.', 'Báo cáo thứ hạng, lưu lượng tự nhiên và chất lượng lượt truy cập hàng tháng.'], 'Dự án tối ưu website dịch vụ', 'Rà soát 250 trang, sửa 38 lỗi kỹ thuật và tăng 27% lượt truy cập tự nhiên trong dữ liệu mô phỏng.'],
    ['Graphic Designer thương hiệu', '10-15tr', '1-nam', ['Figma', 'Photoshop', 'Illustrator', 'Canva', 'Typography'], ['Thiết kế bộ nhận diện, ấn phẩm truyền thông và nội dung số nhất quán.', 'Chuẩn bị tệp xuất bản theo thông số của từng kênh và quản lý thư viện thiết kế.', 'Tiếp nhận phản hồi, trình bày phương án và kiểm tra chất lượng trước bàn giao.'], 'Bộ nhận diện chiến dịch Mùa Hè Xanh', 'Hoàn thành 45 ấn phẩm thuộc 5 nhóm định dạng và chuẩn hóa thư viện 30 thành phần thiết kế.'],
    ['Trưởng nhóm truyền thông thương hiệu', '20-30tr', '3nam', ['Brand Strategy', 'Project Management', 'Content Writing', 'Social Media', 'Excel'], ['Xây dựng kế hoạch truyền thông theo quý với mục tiêu và chỉ số cụ thể.', 'Phân công công việc cho nhóm nội dung, thiết kế và đối tác sản xuất.', 'Tổng hợp kết quả chiến dịch, kiểm soát ngân sách và xử lý phản hồi thương hiệu.'], 'Kế hoạch truyền thông ra mắt thương hiệu', 'Điều phối nhóm 6 thành viên, bàn giao 3 chiến dịch đúng hạn và duy trì ngân sách trong giới hạn kế hoạch.'],
    ['Video Editor nội dung ngắn', '10-15tr', '1-nam', ['Premiere Pro', 'After Effects', 'CapCut', 'Storytelling', 'Photoshop'], ['Dựng video ngắn từ kịch bản và tư liệu có sẵn cho các nền tảng mạng xã hội.', 'Xử lý âm thanh, phụ đề và đồ họa chuyển động phù hợp nhận diện thương hiệu.', 'Quản lý phiên bản, lưu trữ tư liệu và phân tích phản hồi để cải thiện nội dung.'], 'Chuỗi video hướng dẫn sử dụng sản phẩm', 'Sản xuất 24 video trong 8 tuần, chuẩn hóa 10 mẫu phụ đề và rút 25% thời gian xử lý hậu kỳ.'],
  ],
  [
    ['Chuyên viên phân tích tài chính', '20-30tr', '3nam', ['Excel', 'Financial Modeling', 'Power BI', 'SQL', 'Budgeting'], ['Lập mô hình ngân sách, dự báo dòng tiền và báo cáo chênh lệch theo tháng.', 'Đối chiếu dữ liệu bán hàng với chi phí vận hành và giải thích biến động.', 'Chuẩn bị tài liệu phân tích cho các phương án đầu tư nội bộ.'], 'Mô hình ngân sách theo kênh phân phối', 'Chuẩn hóa mô hình cho 8 đơn vị kinh doanh và rút 30% thời gian tổng hợp báo cáo tháng.'],
    ['Kế toán tổng hợp', '15-20tr', '2-nam', ['Excel', 'MISA', 'Accounting', 'Reconciliation', 'Financial Reporting'], ['Kiểm tra chứng từ, hạch toán nghiệp vụ và đối chiếu công nợ định kỳ.', 'Tổng hợp số liệu kế toán, quản lý lịch chốt sổ và theo dõi tài sản.', 'Phối hợp các bộ phận hoàn thiện hồ sơ và giải trình chênh lệch dữ liệu.'], 'Quy trình đối soát công nợ tự động', 'Đối chiếu 1.200 chứng từ mẫu mỗi tháng và giảm 35% thao tác nhập lại dữ liệu.'],
    ['Nhân viên kinh doanh B2B', '10-15tr', '1-nam', ['Sales', 'CRM', 'Negotiation', 'Presentation', 'Excel'], ['Tìm hiểu nhu cầu khách hàng doanh nghiệp và chuẩn bị phương án chào hàng.', 'Cập nhật tiến độ cơ hội trên CRM, phối hợp báo giá và theo dõi hợp đồng.', 'Chăm sóc khách hàng sau bàn giao và tổng hợp phản hồi dịch vụ.'], 'Phát triển danh mục khách hàng doanh nghiệp', 'Quản lý 60 cơ hội kinh doanh giả lập và xây dựng 15 bản đề xuất phù hợp từng nhóm nhu cầu.'],
    ['Business Analyst vận hành', '15-20tr', '2-nam', ['Business Analysis', 'BPMN', 'SQL', 'Jira', 'Excel'], ['Khảo sát quy trình bán hàng, mua hàng và ghi nhận yêu cầu của người sử dụng.', 'Mô tả quy trình, viết tiêu chí nghiệm thu và hỗ trợ kiểm thử nghiệp vụ.', 'Theo dõi tác động của thay đổi sau triển khai và cập nhật tài liệu hướng dẫn.'], 'Số hóa quy trình duyệt đơn hàng', 'Vẽ 14 quy trình nghiệp vụ và giảm 2 bước nhập thông tin trùng lặp trong quy trình đặt hàng.'],
    ['Chuyên viên chăm sóc khách hàng', '5-10tr', 'khong-yeu-cau', ['Customer Service', 'CRM', 'Communication', 'Excel', 'Problem Solving'], ['Tiếp nhận yêu cầu hỗ trợ qua kênh chat, điện thoại nội bộ và email.', 'Phân loại vấn đề, chuyển bộ phận phụ trách và cập nhật tình trạng xử lý.', 'Xây dựng câu trả lời chuẩn và theo dõi mức độ hài lòng sau hỗ trợ.'], 'Kho tri thức hỗ trợ khách hàng', 'Xây dựng 50 tình huống trả lời và xử lý 200 yêu cầu giả lập với thông tin theo dõi đầy đủ.'],
    ['Trưởng nhóm kinh doanh khu vực', 'tren-30tr', 'tren-5-nam', ['Sales', 'Team Management', 'Forecasting', 'CRM', 'Negotiation'], ['Lập kế hoạch doanh số và phân bổ địa bàn cho nhóm bán hàng.', 'Hướng dẫn nhân viên thực hiện quy trình tư vấn và quản lý cơ hội.', 'Phân tích chất lượng khách hàng, dự báo kết quả và điều chỉnh kế hoạch theo quý.'], 'Mô hình quản lý khu vực bán hàng', 'Huấn luyện 8 nhân viên, thiết kế báo cáo dự báo tuần và chuẩn hóa quy trình bàn giao khách hàng.'],
  ],
  [
    ['Talent Acquisition Specialist', '15-20tr', '2-nam', ['Recruitment', 'LinkedIn', 'Interviewing', 'ATS', 'Excel'], ['Tiếp nhận nhu cầu tuyển dụng và thống nhất tiêu chí đánh giá theo từng vị trí.', 'Tìm nguồn ứng viên, sàng lọc hồ sơ và điều phối lịch phỏng vấn.', 'Theo dõi tỷ lệ chuyển đổi tuyển dụng và cập nhật trải nghiệm ứng viên.'], 'Dự án chuẩn hóa tuyển dụng khối văn phòng', 'Điều phối 45 buổi phỏng vấn và rút thời gian phản hồi ứng viên từ 5 ngày xuống 2 ngày.'],
    ['Chuyên viên C&B', '15-20tr', '2-nam', ['Payroll', 'Excel', 'HRIS', 'Reconciliation', 'Labor Administration'], ['Tổng hợp dữ liệu chấm công, kiểm tra thay đổi nhân sự và tính lương nội bộ.', 'Đối chiếu bảng lương, theo dõi hồ sơ phúc lợi và giải đáp thắc mắc của nhân viên.', 'Chuẩn hóa quy trình kiểm soát dữ liệu và lưu trữ chứng từ nhân sự.'], 'Bộ kiểm tra dữ liệu chấm công và lương', 'Thiết kế 18 quy tắc kiểm tra cho 300 hồ sơ giả lập và giảm 40% thời gian đối chiếu.'],
    ['Chuyên viên đào tạo nội bộ', '10-15tr', '1-nam', ['Training', 'Presentation', 'LMS', 'Canva', 'Excel'], ['Khảo sát nhu cầu đào tạo và tổ chức chương trình hội nhập cho nhân viên mới.', 'Biên soạn tài liệu học tập, bài kiểm tra và hướng dẫn sử dụng nền tảng LMS.', 'Đánh giá phản hồi học viên và theo dõi mức độ áp dụng sau khóa học.'], 'Chương trình hội nhập nhân viên mới', 'Thiết kế 6 mô-đun đào tạo, tổ chức 8 buổi học và đạt 92% hoàn thành trên lớp học giả lập.'],
    ['HR Business Partner', '20-30tr', '3nam', ['HR Planning', 'Employee Relations', 'Performance Management', 'Excel', 'Communication'], ['Phối hợp quản lý đơn vị xây dựng kế hoạch nhân sự theo quý.', 'Hỗ trợ quản trị hiệu suất, trao đổi phản hồi và xử lý vấn đề trải nghiệm nhân viên.', 'Phân tích dữ liệu nhân sự và đề xuất hoạt động cải thiện gắn kết.'], 'Bộ báo cáo sức khỏe tổ chức', 'Xây dựng 9 chỉ số nhân sự, điều phối 4 buổi phản hồi và chuẩn hóa kế hoạch phát triển cá nhân.'],
    ['Nhân viên hành chính nhân sự', '5-10tr', 'khong-yeu-cau', ['Administration', 'Excel', 'Document Management', 'Communication', 'Scheduling'], ['Quản lý hồ sơ, cập nhật dữ liệu nhân viên và theo dõi văn phòng phẩm.', 'Điều phối lịch họp, hậu cần sự kiện và thủ tục nhận việc.', 'Tổng hợp đề nghị thanh toán, lưu trữ chứng từ và hỗ trợ các phòng ban.'], 'Sổ tay vận hành văn phòng', 'Chuẩn hóa 20 biểu mẫu và sắp xếp 350 tài liệu mẫu theo hệ thống thư mục thống nhất.'],
    ['HR Data Analyst', '15-20tr', '2-nam', ['SQL', 'Power BI', 'Excel', 'HRIS', 'Data Visualization'], ['Kết nối dữ liệu tuyển dụng, chấm công và biến động nhân sự để lập báo cáo.', 'Kiểm tra tính nhất quán của chỉ số, phân quyền dữ liệu và giải thích phương pháp tính.', 'Cung cấp phân tích phục vụ kế hoạch tuyển dụng và ngân sách nhân sự.'], 'Bảng điều khiển tuyển dụng và biến động nhân sự', 'Tự động hóa 7 báo cáo, mô tả 25 trường dữ liệu và giảm 5 giờ xử lý thủ công mỗi tuần.'],
  ],
  [
    ['Giáo viên tiếng Anh giao tiếp', '15-20tr', '2-nam', ['English', 'Lesson Planning', 'Teaching', 'Presentation', 'LMS'], ['Soạn giáo án theo năng lực người học và tổ chức hoạt động giao tiếp trên lớp.', 'Theo dõi tiến bộ, chấm bài và phản hồi cụ thể cho từng học viên.', 'Phối hợp điều phối viên hoàn thiện tài liệu học tập và lịch học.'], 'Khóa tiếng Anh giao tiếp theo tình huống', 'Biên soạn 24 giáo án, tổ chức 12 buổi thực hành và xây dựng bảng theo dõi tiến bộ cho 30 học viên mẫu.'],
    ['Giáo viên Tin học / STEM', '10-15tr', '1-nam', ['Python', 'Scratch', 'Teaching', 'Lesson Planning', 'Problem Solving'], ['Hướng dẫn học viên lập trình cơ bản và giải quyết bài toán qua dự án.', 'Chuẩn bị thiết bị, tài liệu và bài thực hành phù hợp với từng độ tuổi.', 'Đánh giá sản phẩm học tập và trao đổi tiến độ với điều phối viên.'], 'Câu lạc bộ lập trình dự án đầu tiên', 'Thiết kế 10 bài thực hành Scratch và hướng dẫn hoàn thiện 18 sản phẩm trò chơi mô phỏng.'],
    ['Chuyên viên phát triển học liệu', '15-20tr', '2-nam', ['Instructional Design', 'LMS', 'Canva', 'Content Writing', 'Assessment'], ['Phân tích mục tiêu học tập và xây dựng cấu trúc khóa học trực tuyến.', 'Biên tập bài giảng, bài tập và câu hỏi đánh giá có tiêu chí rõ ràng.', 'Thử nghiệm nội dung với nhóm học viên mẫu và cải tiến theo phản hồi.'], 'Bộ học liệu kỹ năng làm việc số', 'Phát triển 5 mô-đun, 80 câu hỏi đánh giá và 12 tài liệu hướng dẫn thực hành.'],
    ['Điều phối học vụ', '10-15tr', '1-nam', ['Scheduling', 'Excel', 'Communication', 'LMS', 'Customer Service'], ['Xếp lịch học, bố trí giáo viên và theo dõi tình trạng lớp học.', 'Hỗ trợ học viên đăng ký, chuyển lớp và sử dụng tài liệu học tập.', 'Tổng hợp chuyên cần, phản hồi và các vấn đề cần cải thiện chất lượng.'], 'Lịch vận hành lớp học tập trung', 'Điều phối 25 lớp mô phỏng, xây dựng cảnh báo lịch trùng và giảm 20% thời gian xếp lịch.'],
    ['Trợ giảng bán thời gian', '5-10tr', 'khong-yeu-cau', ['Teaching', 'Communication', 'PowerPoint', 'English', 'Scheduling'], ['Chuẩn bị học liệu và hỗ trợ giáo viên trong hoạt động nhóm.', 'Theo dõi chuyên cần, hướng dẫn bài tập và ghi nhận khó khăn của học viên.', 'Tổng hợp câu hỏi sau buổi học và bàn giao thông tin cho giáo viên phụ trách.'], 'Nhóm hỗ trợ học tập cuối tuần', 'Hỗ trợ 16 buổi học, chuẩn bị 20 bộ bài tập và xây dựng bảng theo dõi tiến độ học tập.'],
    ['Trưởng nhóm chuyên môn đào tạo', '20-30tr', '3nam', ['Curriculum Design', 'Team Management', 'Teaching', 'Assessment', 'Presentation'], ['Xây dựng chuẩn chuyên môn và kế hoạch phát triển chương trình học.', 'Dự giờ, phản hồi và hỗ trợ giáo viên cải thiện phương pháp giảng dạy.', 'Phân tích kết quả học tập để điều chỉnh giáo trình và cách đánh giá.'], 'Khung đánh giá chất lượng giảng dạy', 'Chuẩn hóa 12 tiêu chí dự giờ, hướng dẫn nhóm 7 giáo viên và rà soát 4 chương trình đào tạo.'],
  ],
  [
    ['Chuyên viên tư vấn mặt bằng thương mại', '10-15tr', '1-nam', ['Sales', 'CRM', 'Negotiation', 'Presentation', 'Customer Service'], ['Khảo sát nhu cầu diện tích, vị trí và ngân sách của khách thuê doanh nghiệp.', 'Chuẩn bị hồ sơ giới thiệu mặt bằng, tổ chức lịch khảo sát và theo dõi phản hồi.', 'Phối hợp pháp lý và vận hành để hoàn thiện phương án thuê.'], 'Danh mục tư vấn mặt bằng bán lẻ', 'Chuẩn bị 35 hồ sơ mặt bằng và điều phối 20 buổi khảo sát theo tiêu chí khách thuê mẫu.'],
    ['Chuyên viên nghiên cứu thị trường', '15-20tr', '2-nam', ['Market Research', 'Excel', 'Power BI', 'Presentation', 'Data Analysis'], ['Thu thập dữ liệu công khai về phân khúc văn phòng và mặt bằng thương mại.', 'Kiểm tra nguồn, phân tích xu hướng giá chào thuê và mức độ lấp đầy.', 'Biên soạn báo cáo so sánh và trình bày nhận định cho nhóm tư vấn.'], 'Báo cáo thị trường mặt bằng theo khu vực', 'Tổng hợp 180 mẫu khảo sát giả lập và xây dựng 6 biểu đồ so sánh theo phân khúc.'],
    ['Chuyên viên quản lý hợp đồng thuê', '15-20tr', '2-nam', ['Contract Management', 'Excel', 'Document Management', 'Negotiation', 'Communication'], ['Theo dõi điều khoản, lịch thanh toán và thời hạn gia hạn của hợp đồng thuê.', 'Đối chiếu thông tin hợp đồng với hồ sơ bàn giao và thay đổi đã được phê duyệt.', 'Chuẩn bị biểu mẫu, nhắc lịch và phối hợp giải quyết yêu cầu của khách thuê.'], 'Bộ theo dõi vòng đời hợp đồng thuê', 'Chuẩn hóa dữ liệu 120 hợp đồng mẫu và tạo lịch nhắc 4 mốc quan trọng cho từng hợp đồng.'],
    ['Điều phối vận hành tòa nhà', '10-15tr', '1-nam', ['Facility Management', 'Scheduling', 'Excel', 'Customer Service', 'Problem Solving'], ['Tiếp nhận yêu cầu dịch vụ và điều phối các nhóm bảo trì, an ninh, vệ sinh.', 'Theo dõi lịch bảo dưỡng, kiểm tra chất lượng và ghi nhận sự cố.', 'Tổng hợp báo cáo vận hành và phản hồi của khách thuê theo tuần.'], 'Quy trình tiếp nhận yêu cầu tại tòa nhà', 'Thiết kế 10 biểu mẫu kiểm tra và theo dõi 160 yêu cầu dịch vụ giả lập theo mức ưu tiên.'],
    ['Chuyên viên marketing dự án', '15-20tr', '2-nam', ['Content Writing', 'Meta Ads', 'Canva', 'CRM', 'Event Planning'], ['Xây dựng tài liệu giới thiệu dự án và nội dung cho từng nhóm khách hàng.', 'Triển khai chiến dịch thu thập nhu cầu, sự kiện khảo sát và chăm sóc khách quan tâm.', 'Đối chiếu dữ liệu truyền thông với phản hồi của bộ phận tư vấn.'], 'Chiến dịch giới thiệu tổ hợp thương mại', 'Thực hiện 3 sự kiện giả lập, 28 ấn phẩm nội dung và thiết kế quy trình bàn giao khách hàng quan tâm.'],
    ['Trưởng nhóm quản lý tài sản', 'tren-30tr', 'tren-5-nam', ['Asset Management', 'Budgeting', 'Team Management', 'Contract Management', 'Excel'], ['Lập ngân sách vận hành và kế hoạch bảo trì cho danh mục tài sản.', 'Theo dõi chất lượng nhà cung cấp, hợp đồng dịch vụ và chỉ số vận hành.', 'Điều phối nhóm quản lý, tổng hợp rủi ro và đề xuất phương án cải thiện.'], 'Kế hoạch quản trị danh mục tài sản', 'Lập ngân sách cho 4 tòa nhà mô phỏng, rà soát 22 hợp đồng dịch vụ và thiết lập báo cáo quý.'],
  ],
  [
    ['Chuyên viên pháp chế doanh nghiệp', '20-30tr', '3nam', ['Legal Research', 'Contract Review', 'Document Management', 'Communication', 'English'], ['Rà soát tài liệu giao dịch và hợp đồng theo quy trình phê duyệt nội bộ.', 'Tra cứu văn bản, tổng hợp vấn đề cần kiểm tra và đề xuất câu hỏi cho bên liên quan.', 'Quản lý hồ sơ pháp lý, phiên bản tài liệu và lịch hoàn thiện thủ tục.'], 'Thư viện điều khoản hợp đồng thương mại', 'Hệ thống hóa 60 điều khoản mẫu và tạo danh mục kiểm tra cho 8 loại hợp đồng.'],
    ['Trợ lý pháp lý', '10-15tr', '1-nam', ['Legal Research', 'Document Management', 'Word', 'Excel', 'Scheduling'], ['Thu thập, phân loại và kiểm tra tính đầy đủ của hồ sơ theo danh mục.', 'Hỗ trợ tra cứu, ghi biên bản và chuẩn bị tài liệu làm việc cho chuyên viên.', 'Theo dõi tiến độ công việc và bảo đảm tài liệu được lưu trữ đúng phiên bản.'], 'Hệ thống lập mục lục hồ sơ pháp lý', 'Sắp xếp 450 tài liệu mẫu, kiểm tra 70 bộ hồ sơ và giảm thời gian tìm tài liệu từ 8 xuống 3 phút.'],
    ['Chuyên viên quản trị hợp đồng', '15-20tr', '2-nam', ['Contract Management', 'Contract Review', 'Excel', 'Negotiation', 'English'], ['Quản lý quy trình đề xuất, rà soát, ký kết và lưu trữ hợp đồng.', 'Theo dõi các mốc thực hiện, đối chiếu phụ lục và ghi nhận yêu cầu thay đổi.', 'Phối hợp các bộ phận xử lý nội dung cần làm rõ trước khi phê duyệt.'], 'Theo dõi phê duyệt hợp đồng nhiều bước', 'Chuẩn hóa 9 biểu mẫu và lập bảng theo dõi 100 hợp đồng giả lập với lịch nhắc rõ ràng.'],
    ['Chuyên viên kiểm soát tuân thủ nội bộ', '15-20tr', '2-nam', ['Compliance', 'Risk Assessment', 'Excel', 'Report Writing', 'Document Management'], ['Lập danh mục kiểm tra tuân thủ quy trình nội bộ theo từng phòng ban.', 'Thu thập bằng chứng, ghi nhận điểm cần cải thiện và theo dõi hành động khắc phục.', 'Biên soạn báo cáo định kỳ và hỗ trợ đào tạo nhận thức về quy trình.'], 'Chương trình tự kiểm tra quy trình nội bộ', 'Xây dựng 35 tiêu chí kiểm tra và theo dõi 18 hành động cải thiện trong dữ liệu mô phỏng.'],
    ['Thực tập sinh pháp lý', '3-5tr', 'khong-yeu-cau', ['Legal Research', 'Word', 'Excel', 'Document Management', 'Communication'], ['Hỗ trợ tổng hợp tài liệu, định dạng văn bản và kiểm tra danh mục hồ sơ.', 'Tra cứu theo chủ đề được phân công và ghi rõ nguồn tham khảo.', 'Tham gia họp nghiệp vụ, ghi chú và báo cáo tiến độ cho người hướng dẫn.'], 'Sổ tay nghiên cứu pháp lý căn bản', 'Tổng hợp 25 bản ghi tra cứu, hoàn thiện 12 danh mục hồ sơ và thực hành kiểm tra phiên bản tài liệu.'],
    ['Chuyên viên hồ sơ sở hữu trí tuệ', 'thoa-thuan', '3nam', ['Intellectual Property', 'Legal Research', 'Document Management', 'English', 'Client Service'], ['Tiếp nhận thông tin nhãn hiệu, đối chiếu hồ sơ và tổng hợp câu hỏi cần bổ sung.', 'Quản lý lịch xử lý, tài liệu trao đổi và các phiên bản hồ sơ.', 'Hỗ trợ chuyên viên phụ trách tra cứu thông tin và chuẩn bị báo cáo khách hàng.'], 'Kho hồ sơ nhãn hiệu có lịch theo dõi', 'Chuẩn hóa 80 bộ hồ sơ mô phỏng và xây dựng bộ kiểm tra 16 trường dữ liệu bắt buộc.'],
  ],
  [
    ['Điều phối vận tải', '10-15tr', '1-nam', ['Logistics', 'Route Planning', 'Excel', 'TMS', 'Communication'], ['Lập lịch giao nhận, phân bổ phương tiện và xác nhận thông tin từng chuyến.', 'Theo dõi trạng thái giao hàng và phối hợp xử lý thay đổi lịch trình.', 'Đối chiếu chứng từ giao nhận, tổng hợp chi phí và báo cáo chất lượng dịch vụ.'], 'Bảng điều phối vận tải theo ca', 'Lập lịch 180 chuyến giả lập, giảm 14% quãng đường chạy rỗng và chuẩn hóa danh mục bàn giao.'],
    ['Chuyên viên quản lý tồn kho', '15-20tr', '2-nam', ['Inventory Management', 'WMS', 'Excel', 'SQL', 'Reconciliation'], ['Theo dõi nhập xuất tồn, phân loại hàng hóa và kiểm tra chênh lệch tồn kho.', 'Lập kế hoạch kiểm kê định kỳ, phân tích tuổi tồn và đề xuất bổ sung hàng.', 'Chuẩn hóa dữ liệu mã hàng, đơn vị tính và báo cáo vận hành kho.'], 'Báo cáo tuổi tồn và kế hoạch kiểm kê', 'Đối chiếu 2.400 mã hàng mẫu và xây dựng cảnh báo cho 5 nhóm chênh lệch dữ liệu.'],
    ['Nhân viên chứng từ xuất nhập khẩu', '10-15tr', '1-nam', ['Import Export', 'Incoterms', 'Excel', 'Document Management', 'English'], ['Kiểm tra tính đầy đủ và thống nhất của bộ chứng từ giao nhận.', 'Theo dõi lịch vận chuyển, phối hợp đối tác và cập nhật thông tin lô hàng.', 'Lưu trữ hồ sơ, đối chiếu chi phí dịch vụ và báo cáo các điểm chưa khớp.'], 'Danh mục kiểm tra chứng từ lô hàng', 'Rà soát 90 bộ hồ sơ mô phỏng, phát hiện 23 sai lệch và chuẩn hóa 14 trường thông tin.'],
    ['Chuyên viên mua hàng', '15-20tr', '2-nam', ['Procurement', 'Negotiation', 'Excel', 'Supplier Management', 'ERP'], ['Tiếp nhận nhu cầu, lấy báo giá và tổng hợp bảng so sánh nhà cung cấp.', 'Theo dõi đơn mua hàng, lịch giao và chất lượng bàn giao thực tế.', 'Đối chiếu chứng từ mua hàng, cập nhật danh mục và đánh giá nhà cung cấp.'], 'Bộ đánh giá nhà cung cấp theo quý', 'Xây dựng 12 tiêu chí đánh giá và đối chiếu 50 đơn mua hàng mẫu với kế hoạch giao nhận.'],
    ['Supply Chain Analyst', '20-30tr', '3nam', ['SQL', 'Power BI', 'Forecasting', 'Excel', 'Supply Chain'], ['Phân tích nhu cầu, năng lực cung ứng và hiệu quả tồn kho theo nhóm sản phẩm.', 'Xây dựng báo cáo giao hàng đúng hạn, vòng quay tồn kho và sai lệch dự báo.', 'Phối hợp bán hàng, kho và mua hàng để thống nhất kế hoạch cung ứng.'], 'Bảng điều khiển kế hoạch chuỗi cung ứng', 'Kết nối 5 nguồn dữ liệu mẫu và giảm 22% sai lệch dự báo trong bài thử nghiệm theo tháng.'],
    ['Trưởng ca vận hành kho', '15-20tr', '2-nam', ['Warehouse Operations', 'WMS', 'Team Management', 'Scheduling', 'Excel'], ['Phân công ca làm, kiểm tra điều kiện vận hành và theo dõi tiến độ xử lý đơn.', 'Hướng dẫn quy trình nhập xuất, kiểm đếm và ghi nhận bất thường.', 'Bàn giao cuối ca, kiểm tra chất lượng dữ liệu và đề xuất cải thiện năng suất.'], 'Quy trình bàn giao ca tại kho phân phối', 'Điều phối nhóm 12 người trong kịch bản kho mẫu và tăng 16% số đơn xử lý trên mỗi ca thử nghiệm.'],
  ],
];

const NAMES = [
  'Nguyễn Minh An', 'Trần Bảo Ngọc', 'Lê Quốc Huy', 'Phạm Thu Hà', 'Hoàng Đức Anh', 'Võ Khánh Linh', 'Đặng Gia Bảo', 'Bùi Ngọc Mai', 'Đỗ Tuấn Kiệt',
  'Nguyễn Hoài Thương', 'Trần Nhật Minh', 'Lê Phương Anh', 'Phạm Thanh Tùng', 'Hoàng Thảo Vy', 'Võ Hải Đăng', 'Đặng Mai Chi', 'Bùi Thành Đạt', 'Đỗ Ngọc Hân',
  'Nguyễn Quang Khải', 'Trần Diệu Linh', 'Lê Minh Khang', 'Phạm Ngọc Trâm', 'Hoàng Tuấn Anh', 'Võ Bảo Châu', 'Đặng Anh Tuấn', 'Bùi Hà My', 'Đỗ Đức Minh',
  'Nguyễn Khánh Hòa', 'Trần Hoàng Nam', 'Lê Thanh Hằng', 'Phạm Nhật Long', 'Hoàng Kim Ngân', 'Võ Minh Quân', 'Đặng Mỹ Duyên', 'Bùi Hải Nam', 'Đỗ Phương Thảo',
  'Nguyễn Thế Vinh', 'Trần Ngọc Ánh', 'Lê Đức Phúc', 'Phạm Bảo Trân', 'Hoàng Gia Huy', 'Võ Thùy Dương', 'Đặng Quốc Việt', 'Bùi Thanh Tâm', 'Đỗ Khánh Vân',
  'Nguyễn Hữu Phước', 'Trần Minh Thư', 'Lê Hoàng Phong', 'Phạm Bích Ngọc', 'Hoàng Tiến Dũng', 'Võ Nhã Uyên', 'Đặng Trung Hiếu', 'Bùi Tú Anh', 'Đỗ Anh Khoa',
  'Nguyễn Ngọc Diệp', 'Trần Việt Hoàng', 'Lê Khánh Ngân', 'Phạm Đức Hòa', 'Hoàng Ngọc Bích', 'Võ Quang Hưng', 'Đặng Bảo Anh', 'Bùi Minh Đức', 'Đỗ Thanh Vy',
  'Nguyễn Hồng Phúc', 'Trần Tuệ Nhi', 'Lê Anh Duy', 'Phạm Ngọc Quỳnh', 'Hoàng Bảo Long', 'Võ Yến Nhi', 'Đặng Minh Triết', 'Bùi Lan Anh', 'Đỗ Quốc Bảo',
];

function buildCatalog(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError('buildCatalog requires a valid date');
  const year = date.getUTCFullYear();
  const companies = COMPANIES.map(([domain, domainLabel, brand, slug, city, size, product, major, mission], index) => ({
    key: `demo-company-${pad(index + 1)}`, domain, domainLabel, major, slug, city,
    name: `${brand} (Demo)`, website: `https://${slug}.example.test`,
    address: `Tầng ${index + 2}, Tòa nhà Demo ${index + 1}, ${city} (địa chỉ giả lập)`,
    phonenumber: `091880${String(index + 1).padStart(4, '0')}`, taxnumber: `DEMO-${pad(index + 1)}-0000`,
    amountEmployer: size, statusCode: 'S1', censorCode: 'CS1',
    ...sections([
      ['Giới thiệu doanh nghiệp', [FICTION, `${brand} là doanh nghiệp giả lập hoạt động trong lĩnh vực ${product}.`, mission]],
      ['Văn hóa làm việc', ['Trao đổi mục tiêu rõ ràng; phản hồi theo từng chu kỳ công việc.', 'Hỗ trợ học tập liên tục, chia sẻ chuyên môn và làm việc theo nhóm.', `Quy mô minh họa ${size} nhân sự, văn phòng tại ${city}.`]],
      ['Quy trình tuyển dụng', ['Tiếp nhận hồ sơ → trao đổi chuyên môn → phỏng vấn → đề nghị nhận việc.', 'Thông tin ứng viên chỉ được dùng trong các tình huống trình diễn của dự án.']],
    ]),
    recruiter: {
      firstName: ['Nguyễn Thu', 'Trần Minh', 'Lê Bảo', 'Phạm Ngọc', 'Hoàng Hải', 'Võ Thanh', 'Đặng Thu', 'Bùi Quốc'][index],
      lastName: ['Trang', 'Tâm', 'Linh', 'Anh', 'Yến', 'Bình', 'Hiền', 'Hưng'][index],
      email: `recruiter.${slug}@example.test`, phone: `091880${String(index + 1).padStart(4, '0')}`,
    },
  }));
  const jobs = companies.flatMap((company, domainIndex) => ROLES[domainIndex].map((role, roleIndex) => {
    const [title, salaryJobCode, experienceJobCode, skills, responsibilities, project, achievement] = role;
    const experience = EXPERIENCES.find(entry => entry[0] === experienceJobCode);
    const worktype = title.includes('Thực tập') ? 'thuc-tap' : title.includes('bán thời gian') ? 'part-time' : domainIndex === 0 && roleIndex === 4 ? 'remote' : 'fulltime';
    const jobLevel = title.startsWith('Trưởng') ? 'truong-phong' : 'nhan-vien';
    const salaryLabel = SALARIES.find(entry => entry[0] === salaryJobCode)[1];
    const postedDaysAgo = 3 + (domainIndex * 7 + roleIndex * 3) % 26;
    const requirements = [
      experience[2] ? `Có tối thiểu ${experience[2]} năm kinh nghiệm liên quan; trình bày được vai trò và kết quả trong dự án đã tham gia.` : 'Chấp nhận ứng viên mới tốt nghiệp; có bài tập, dự án cá nhân hoặc trải nghiệm thực hành liên quan.',
      `Kỹ năng cần có: ${skills.join(', ')}.`,
      `Được đào tạo hoặc có trải nghiệm thực tế trong lĩnh vực ${company.domainLabel.toLowerCase()}; giao tiếp rõ ràng và chủ động phối hợp.`,
      'Cung cấp hồ sơ thể hiện rõ thời gian làm việc, phần công việc trực tiếp thực hiện và ví dụ sản phẩm hoặc kết quả.',
    ];
    const benefits = [
      `Mức lương minh họa: ${salaryLabel}/tháng${salaryJobCode === 'thoa-thuan' ? ', trao đổi theo phạm vi công việc' : ', xem xét theo năng lực và phạm vi công việc'}.`,
      worktype === 'part-time' ? 'Lịch làm việc linh hoạt theo ca đã thống nhất; có người hướng dẫn chuyên môn.' : 'Lịch làm việc từ thứ Hai đến thứ Sáu; trao đổi giờ làm linh hoạt theo từng nhóm.',
      'Có chương trình hướng dẫn hội nhập, chia sẻ chuyên môn hằng tháng và ngân sách học tập theo kế hoạch.',
      'Đánh giá mục tiêu theo quý; trao đổi lộ trình phát triển và phản hồi rõ ràng sau từng giai đoạn.',
    ];
    return {
      key: `demo-job-${pad(domainIndex + 1)}-${pad(roleIndex + 1)}`, companyKey: company.key,
      name: `${title} — ${company.name}`, title, categoryJobCode: company.domain,
      addressCode: company.city, salaryJobCode, experienceJobCode, categoryJoblevelCode: jobLevel,
      categoryWorktypeCode: worktype, genderPostCode: 'ca-hai', amount: roleIndex === 5 ? 3 : 1 + roleIndex % 3,
      statusCode: 'PS1', isHot: roleIndex < 2 ? 1 : 0, skills: [...skills], responsibilities, requirements, benefits,
      project, achievement, yearsExperience: experience[2], postedDaysAgo,
      timePost: String(date.getTime() - postedDaysAgo * DAY), timeEnd: String(date.getTime() + (35 + roleIndex * 4 + domainIndex) * DAY),
      ...sections([
        ['Thông tin vị trí', [FICTION, `${company.name} tìm ${title.toLowerCase()} tại ${company.city}.`, `Địa điểm làm việc: ${company.address}.`]],
        ['Trách nhiệm công việc', responsibilities], ['Yêu cầu ứng viên', requirements],
        ['Quyền lợi', benefits], ['Quy trình ứng tuyển', ['Gửi CV trên Job Finder kèm lời giới thiệu ngắn và ví dụ công việc phù hợp.', 'Trao đổi hồ sơ, thực hiện buổi phỏng vấn chuyên môn và nhận phản hồi qua hệ thống.']],
      ]),
    };
  }));
  const candidates = companies.flatMap((company, domainIndex) => Array.from({ length: 9 }, (_, localIndex) => {
    const index = domainIndex * 9 + localIndex;
    const job = jobs[domainIndex * 6 + localIndex % 6];
    const fullName = NAMES[index];
    const split = fullName.lastIndexOf(' ');
    const experienceYears = job.yearsExperience + (localIndex >= 6 ? 1 : 0);
    const graduationYear = year - Math.max(experienceYears, 0);
    const startYear = graduationYear - (experienceYears === 0 ? 1 : 0);
    // The six primary profiles match their target job fully. Three additional
    // profiles deliberately differ in one filter and a specialist skill so the
    // comparison screens have real partial matches instead of identical scores.
    const partial = localIndex >= 6;
    const skills = partial ? [...job.skills.slice(0, -1), 'Communication'] : [...job.skills];
    const distinctSkills = [...new Set(skills)];
    if (distinctSkills.length < 4) distinctSkills.push('Excel');
    const addressCode = localIndex === 7 ? (company.city === 'Hà Nội' ? 'Hồ Chí Minh' : 'Hà Nội') : company.city;
    const salaryJobCode = localIndex === 8 ? 'thoa-thuan' : job.salaryJobCode;
    const skillEvidence = distinctSkills.slice(0, 4).join(', ');
    const previousBrand = `Xưởng thực hành ${['Bình Minh', 'Ban Mai', 'Ánh Sao'][localIndex % 3]} (Demo)`;
    const summary = experienceYears
      ? `${fullName} có ${experienceYears} năm kinh nghiệm trong lĩnh vực ${company.domainLabel.toLowerCase()}, tập trung vào ${job.title.toLowerCase()}. Có trải nghiệm với ${skillEvidence}; tìm cơ hội tham gia nhóm có mục tiêu rõ ràng, được đóng góp vào cải tiến quy trình và chất lượng sản phẩm.`
      : `${fullName} mới hoàn thành chương trình ${company.major.toLowerCase()}, đã thực hành ${skillEvidence} qua đồ án và các bài tập nhóm. Mong muốn phát triển ở vị trí ${job.title.toLowerCase()}, có khả năng ghi chép, tiếp nhận phản hồi và hoàn thành nhiệm vụ theo hướng dẫn.`;
    return {
      key: `demo-candidate-${String(index + 1).padStart(3, '0')}`, companyKey: company.key, targetJobKey: job.key,
      fullName, firstName: fullName.slice(0, split), lastName: fullName.slice(split + 1),
      email: `candidate.${String(index + 1).padStart(3, '0')}@example.test`,
      phone: `092880${String(index + 1).padStart(4, '0')}`,
      address: `Khu dân cư Demo ${index + 1}, ${addressCode} (địa chỉ giả lập)`,
      genderCode: index % 2 ? 'FE' : 'M', dob: `${graduationYear - 22}-${pad(index % 12 + 1)}-${pad(index % 27 + 1)}`,
      headline: job.title, summary, yearsExperience: experienceYears,
      expectedSalary: SALARIES.find(entry => entry[0] === salaryJobCode)[2],
      setting: { categoryJobCode: company.domain, addressCode, salaryJobCode, experienceJobCode: job.experienceJobCode, isTakeMail: 0, isFindJob: 1 },
      skills: distinctSkills,
      experience: [{
        company: previousBrand, title: experienceYears ? job.title : `Học viên thực hành ${company.domainLabel.toLowerCase()}`,
        startDate: `${startYear}-06`, endDate: experienceYears ? 'Hiện tại' : `${year}-05`,
        description: [
          ...job.responsibilities.slice(0, 2).map(line => `Đã thực hiện: ${line.charAt(0).toLowerCase()}${line.slice(1)}`),
          `Sử dụng ${skillEvidence} trong công việc; phối hợp nhóm ${3 + localIndex % 4} người để theo dõi tiến độ và rà soát chất lượng.`,
          job.achievement,
        ],
      }],
      education: [{ institution: 'Đại học Thực Hành Job Finder (giả lập)', degree: `Cử nhân ${company.major}`, startDate: `${graduationYear - 4}-09`, endDate: `${graduationYear}-05`, details: `Đồ án: ${job.project}. Kết quả học tập minh họa: ${(3 + (index % 9) / 10).toFixed(1)}/4.0.` }],
      projects: [{ name: job.project, role: experienceYears > 2 ? 'Phụ trách nhóm thực hiện' : 'Thành viên trực tiếp thực hiện', startDate: `${year - 1}-09`, endDate: `${year}-04`, technologies: [...distinctSkills], description: [`Mục tiêu: tạo giải pháp minh họa trong lĩnh vực ${company.domainLabel.toLowerCase()} với dữ liệu tổng hợp, không dùng thông tin cá nhân thật.`, job.achievement, `Bàn giao tài liệu mô tả, bảng theo dõi kết quả và trình bày bài học kinh nghiệm cho nhóm ${3 + localIndex % 4} thành viên.`] }],
      certifications: [{ name: `Khóa thực hành ${distinctSkills[0]} (chứng nhận mô phỏng)`, issuer: 'Job Finder Demo Academy', date: `${year - 1}-08` }],
      languages: [{ language: 'Tiếng Việt', level: 'Bản ngữ' }, { language: 'Tiếng Anh', level: index % 3 ? 'B1 - đọc tài liệu và trao đổi công việc cơ bản' : 'B2 - thuyết trình và phối hợp dự án' }],
      availability: index % 3 ? 'Có thể bắt đầu sau 30 ngày' : 'Có thể bắt đầu sau 14 ngày',
      demoMatchScenario: partial ? 'partial-match' : 'strong-match', fictionNotice: FICTION,
    };
  }));
  const allcodes = [
    ...COMPANIES.map(company => ({ code: company[0], type: 'JOBTYPE', value: company[1], image: '' })),
    ...PROVINCES.map(({ code, value }) => ({ code, type: 'PROVINCE', value, image: '' })),
    ...PROVINCES.flatMap(province => province.previousNames.map(code => ({ code, type: 'PROVINCE_LEGACY', value: code, image: '' }))),
    ...SALARIES.map(([code, value]) => ({ code, type: 'SALARYTYPE', value, image: '' })),
    ...EXPERIENCES.map(([code, value]) => ({ code, type: 'EXPTYPE', value, image: '' })),
    ...JOB_LEVELS.map(({ code, value }) => ({ code, type: 'JOBLEVEL', value, image: '' })),
    ...[['fulltime', 'Toàn thời gian'], ['part-time', 'Bán thời gian'], ['thuc-tap', 'Thực tập'], ['remote', 'Remote']].map(([code, value]) => ({ code, type: 'WORKTYPE', value, image: '' })),
    { code: 'ca-hai', type: 'GENDERPOST', value: 'Cả hai', image: '' },
  ];
  return { version: VERSION, generatedAt: date.toISOString(), fictionNotice: FICTION, allcodes, companies, jobs, candidates };
}

/**
 * Build a real, selectable-text PDF. Standard Helvetica deliberately uses an
 * ASCII transliteration; Vietnamese accents remain intact in the app/catalog.
 * This avoids optional font libraries, machine fonts and network dependencies.
 */
async function createResume(candidate) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  if (!candidate?.fullName || !candidate?.skills?.length) throw new TypeError('A catalog candidate with name and skills is required');
  const document = await PDFDocument.create();
  document.setTitle(ascii(`CV - ${candidate.fullName} - ${candidate.headline}`));
  document.setAuthor('Job Finder Demo');
  document.setSubject('Fictional candidate resume for local product demonstration');
  // Stable metadata makes repeated PDFs byte-for-byte reproducible for one catalog.
  const fixedDate = new Date('2026-01-01T00:00:00.000Z');
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const palette = { text: rgb(0.12, 0.18, 0.25), muted: rgb(0.36, 0.42, 0.47), brand: rgb(0.04, 0.40, 0.37) };
  const width = 595.28, height = 841.89, margin = 44, available = width - margin * 2;
  let page, y;
  function newPage() {
    page = document.addPage([width, height]);
    y = height - margin;
    page.drawText('JOB FINDER  |  FICTIONAL DEMO CV', { x: margin, y: 23, size: 8, font: regular, color: palette.muted });
    page.drawText(String(document.getPageCount()), { x: width - margin, y: 23, size: 8, font: regular, color: palette.muted });
  }
  function wrap(text, font, size, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of ascii(text).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  function write(text, { size = 10, strong = false, color = palette.text, indent = 0, after = 5 } = {}) {
    const font = strong ? bold : regular;
    const lines = wrap(text, font, size, available - indent);
    for (const line of lines) {
      if (y < 55) newPage();
      page.drawText(line, { x: margin + indent, y, size, font, color });
      y -= size * 1.4;
    }
    y -= after;
  }
  function heading(text) {
    if (y < 100) newPage();
    y -= 5;
    page.drawLine({ start: { x: margin, y: y + 14 }, end: { x: width - margin, y: y + 14 }, thickness: 0.6, color: rgb(0.80, 0.88, 0.86) });
    write(text, { size: 11, strong: true, color: palette.brand, after: 6 });
  }
  newPage();
  write(candidate.fullName, { size: 23, strong: true, color: palette.brand });
  write(candidate.headline, { size: 13, strong: true, after: 8 });
  write(`${candidate.email} | ${candidate.phone} | ${candidate.setting.addressCode}`, { size: 9, color: palette.muted });
  write('HO SO GIA LAP - Toan bo danh tinh, don vi, thanh tich va lien he phuc vu demo.', { size: 8, color: palette.muted, after: 10 });
  heading('TOM TAT CHUYEN MON');
  write(candidate.summary);
  write(`Kinh nghiem: ${candidate.yearsExperience} nam | Luong mong muon: ${candidate.expectedSalary ? new Intl.NumberFormat('en-US').format(candidate.expectedSalary) + ' VND/thang' : 'Thoa thuan'} | ${candidate.availability}`, { size: 9 });
  heading('KY NANG');
  write(candidate.skills.join('  |  '), { strong: true });
  heading('KINH NGHIEM / THUC HANH');
  for (const item of candidate.experience) {
    write(`${item.title} | ${item.company}`, { strong: true });
    write(`${item.startDate} - ${item.endDate}`, { size: 9, color: palette.muted });
    item.description.forEach(line => write(`- ${line}`, { indent: 8 }));
  }
  heading('DU AN TIEU BIEU');
  for (const item of candidate.projects) {
    write(item.name, { strong: true });
    write(`${item.role} | ${item.startDate} - ${item.endDate}`, { size: 9, color: palette.muted });
    write(`Cong cu va ky nang: ${item.technologies.join(', ')}`, { size: 9 });
    item.description.forEach(line => write(`- ${line}`, { indent: 8 }));
  }
  heading('HOC VAN');
  for (const item of candidate.education) {
    write(`${item.degree} | ${item.institution}`, { strong: true });
    write(`${item.startDate} - ${item.endDate} | ${item.details}`, { size: 9 });
  }
  heading('DAO TAO BO SUNG / NGOAI NGU');
  candidate.certifications.forEach(item => write(`${item.name} | ${item.issuer} | ${item.date}`, { size: 9 }));
  candidate.languages.forEach(item => write(`${item.language}: ${item.level}`, { size: 9 }));
  return `data:application/pdf;base64,${Buffer.from(await document.save()).toString('base64')}`;
}

module.exports = { buildCatalog, createResume, VERSION, FICTION };
