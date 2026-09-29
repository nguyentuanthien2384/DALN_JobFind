# Verified northern jobs — 2026-09-29

All 15 requested northern provinces covered by 13 distinct vacancies/notices, with explicit employer location evidence. Grouped posts preserve all source locations. No employer contact, submission, account creation or application performed.

## Source verification

- VNPT PL/SQL jid5028: official detail page opened; heading, Hà Nội/Hải Phòng, deadline 05/10/2026, duties and requirements observed.
- VNPT Cao Bằng jid6426: official detail page opened; Cao Bằng, deadline 10/11/2026. Salary omitted because gated salary and related-post figures have suspect unit duplication.
- VNPT Tuyên Quang jid6414: official detail page opened; Tuyên Quang, deadline 15/10/2026.
- VNPT Ninh Bình jid6419: official detail page opened; Ninh Bình, deadline 12/10/2026.
- VNPT Bắc Ninh jid5301: official detail page opened; Bắc Ninh, deadline 30/09/2026.
- VNPT Hưng Yên jid6421: official employee listing https://tuyendung.vnpt.vn/viec-lam/nhan-vien-e18.html states Hưng Yên and 30/09/2026. Detail web fetch initially succeeded but later returned intermittent internal errors. Direct HTTPS GET through PowerShell succeeded and readable content confirmed job duties, Hưng Yên application location and requirements.
  A second direct GET also confirmed the detail header: Viễn thông Hưng Yên, Hưng Yên, deadline 30/09/2026.
- FPT Schools 79770: official detail page explicitly lists Điện Biên Phủ (Điện Biên), Vĩnh Yên (Phú Thọ), Thành Sen (Hà Tĩnh), Bình Dương (Hồ Chí Minh). Deadline 31/12/2026. Index metadata says Hà Nội, but actual detailed workplace list controls; Hà Nội not included.
- TokyoLife 772: official detail page gives Lai Châu street address, salary 6–9m VND, deadline 08/10/2026, duties and requirements.
- VNPAY Account Manager Lạng Sơn: official detail page specifies workplace Lạng Sơn and deadline 30/09/2026.
- Rohto GT leader: official detail page lists Bắc Ninh, Bắc Giang, Thái Nguyên, Cao Bằng, Bắc Kạn; deadline 30/09/2026 also verified on https://rohto.com.vn/tuyen-dung/co-hoi-nghe-nghiep/nhan-vien-kinh-nghiem/?p=2 . Normalize Bắc Giang to Bắc Ninh and Bắc Kạn to Thái Nguyên. URL slug says central-highland but heading/body clearly specifies Northeast; body used.
- Sun Group 12781: official detail specifies Hà Nội/Quảng Ninh, deadline 30/09/2026; null category because available categories do not include engineering/construction.
- Sun Group 10987: official detail specifies Sa Pa/Lào Cai, deadline 30/11/2026 and temporary work. Worktype left unspecified because app categories lack temporary contract.
- Agribank Sơn La: official central notice opened, deadline 30/09/2026. Its linked official 17-page PDF first page explicitly lists Sơn La branch's 5 credit + 5 accounting positions at Mai Sơn, Mường La, Thuận Châu, Sông Mã, Quỳnh Nhai. Same figures corroborated by bank-signed announcement published in Báo Sơn La on 23/09/2026. Do not infer other provinces solely from central national notice.

## Exclusions

- BAOVIET Bank Lào Cai GDVLC08.2026: expired 31/08/2026; excluded despite still accessible apply button.
- CANIFA store manager: header location list includes Quảng Ninh but detailed location list differs; use unambiguous Sun Group instead.
- Older Sun Group Fansipan listings: expired dates; excluded.
- No nationwide-to-all-province expansion.

Summaries, responsibilities and requirements are independently paraphrased and short (under 100 words per vacancy). Full conditions remain at original sources.

Filter metadata added conservatively: no WORKTYPE assigned because no selected source directly states one of the app's exact four contract/work arrangements; Sun Group temporary work remains unspecified. Explicit salary negotiations map to thoa-thuan. TokyoLife 6–9m is not squeezed into an inexact salary bracket. Experience filters use source minimum one year (PL/SQL), minimum three years (VNPAY), minimum two years (Sun Group Sa Pa), or explicitly accepts inexperienced (TokyoLife); ambiguous ranges remain null. FPT and Sun Group posting dates are explicit on the source; Agribank central date is 22/09/2026. Other dates remain null. Job levels derive from clear titles; mixed BGH/management and banking bulk notice remain null.


# Verified central/southern vacancies — 2026-09-29

Scope: 19 post-merger provinces from Thanh Hóa southwards. All 19 covered by 17 distinct postings. Dates/deadlines are literal dates on source pages. No deadline extended or invented. SourceStatus open means the stated deadline had not passed on the check date; not a guarantee of unfilled headcount.

All south.json URLs were opened and read in web.run except south-017: web search indexed full employer detail, but web fetching timed out. Direct Invoke-WebRequest successfully retrieved HTTP 200 (75,777 characters). HTML and normalized text are preserved in quang-tri-source.html and quang-tri-source.txt.

- south-001: Sapo detail explicit Thanh Hóa and 68 Hà Huy Tập, deadline30/09/2026, income10–25m, fulltime, laptop. Homepage said31/10/2026 but detail30/09; conservative detail date retained.
- south-002: Sapo detail Nghệ An,127 Lý Thường Kiệt/Thành Vinh, deadline30/09/2026, income15–40m,2–3years sales including1year leadership. Worktype not explicit: null.
- south-003: Hà Tĩnh employment center names Aladdin,2 vacancies, fulltime,10–15m,deadline30/10/2026. Structured experience under1year while prose asks teaching/training management: no experience code.
- south-004: Hanwha detail explicitly GA Huế and GA Nha Trang with addresses; fulltime, outsourcing contract, negotiable,15/09–31/10/2026.
- south-005: Hanwha Senior Officer detail location Dak Lak; body says in charge Phú Yên area, now Đắk Lắk. Fulltime,24/09–24/10/2026. University and at least3years insurance.
- south-006: Hanwha job location section explicitly Lam Dong, Quang Ngai, Quang Ninh, Gia Lai. Fulltime,15/09–16/10/2026. Locations not inferred from office directory.
- south-007: VNPT jid5034 BA,12 openings,Hà Nội/Đồng Tháp,deadline05/10/2026; bachelor and minimum1year BA. Salary gated: null. Worktype not explicit: null.
- south-008: VNPT AI jid5190,1 opening,Hà Nội/TPHCM/Đà Nẵng,deadline24/10/2026. Python/deep learning required. Salary gated on detail: null.
- south-009: Jollibee detail explicitly SLP warehouse Long Hậu,Cần Giuộc,Tây Ninh(Long An old).15/09–15/10/2026,negotiable. Official alljobs labels fulltime.
- south-010: Jollibee title and Nơi làm:Bảo Lộc establish location despite generic Toàn Quốc filter. Map to Lâm Đồng only.10/06–31/12/2026; no experience,high school,fulltime.
- south-011: Jollibee Đồng Nai,deadline31/12/2026. Official alljobs published31/12/2025. No experience,high school,fulltime. Condensed detail31/12–31/12/2026 not interpreted as future posting.
- south-012: Jollibee Đà Nẵng,01/08–30/09/2026,up to28k/hour,no degree/experience. Official alljobs labels fulltime though body allows flexible shifts.
- south-013: Jollibee GO! Bến Tre detail explicitly Sơn Đông,Vĩnh Long(mới).22/08–30/11/2026,up to28k/hour+bonus,4–8h shifts. Worktype null.
- south-014: Jollibee63 Sương Nguyệt Anh,Châu Đốc,An Giang.20/08–31/12/2026,up to28k/hour+bonus,4–8h shifts. Worktype null.
- south-015: FPT Telecom International302 explicit1 Phan Văn Trị,Ninh Kiều,Cần Thơ;fulltime,2 vacancies,negotiable,deadline30/09/2026.
- south-016: Cần Thơ employment center28493,Tổng Công ty Xây dựng Trường Sơn,kế toán thống kê,structured Cà Mau;body says An Giang,Cà Mau.04/09–31/10/2026,fulltime,20–50m/month. Duties empty because source mostly lists requirements.100 reported vacancies not encoded because possibly campaign-level.
- south-017: Nam Miền Trung employer detail dated20/08/2026,deadline30/09/2026,10 sales specialists. Worksite Regal Legend Đồng Hới,Quảng Trị.Base8–18m/month+allowances/incentives. No experience,laptop required.Worktype not explicit:null.

Rejected expired: FPT Retail Quảng Trị13317(Hết Hạn);VNPT Nghệ An June campaign(15/07/2026);FPT Hà Tĩnh25640(30/06/2026);FPT Quảng Ngãi26129(14/09/2026);Môi trường Á Châu Quảng Trị(21/09/2026). Generic nationwide Jollibee not used for geography. VIB snippets not used because detail fetching did not show job content.

Covered: Thanh Hóa,Nghệ An,Hà Tĩnh,Quảng Trị,Huế,Đà Nẵng,Quảng Ngãi,Gia Lai,Khánh Hòa,Đắk Lắk,Lâm Đồng,Đồng Nai,Hồ Chí Minh,Tây Ninh,Đồng Tháp,Vĩnh Long,An Giang,Cần Thơ,Cà Mau. Additional explicit coverage:Hà Nội,Quảng Ninh.


## Source links by catalog ID

- [external-a16a0d2c3e4e](https://tuyendung.vnpt.vn/tim-viec-lam/lap-trinh-plsql-jid5028.html) — Hà Nội, Hải Phòng
- [external-0642f260a509](https://tuyendung.vnpt.vn/tim-viec-lam/ky-su-lap-trinh-jid6426.html) — Cao Bằng
- [external-264b88282511](https://tuyendung.vnpt.vn/tim-viec-lam/nhan-vien-ky-thuat-dia-ban-jid6414.html) — Tuyên Quang
- [external-0907e63f6021](https://tuyendung.vnpt.vn/tim-viec-lam/nhan-vien-ky-thuat-dia-ban-jid6419.html) — Ninh Bình
- [external-3a75f8475725](https://tuyendung.vnpt.vn/tim-viec-lam/nhan-vien-ky-thuat-dia-ban-jid5301.html) — Bắc Ninh
- [external-ef5c7b7aaf17](https://tuyendung.vnpt.vn/tim-viec-lam/nhan-vien-ky-thuat-dia-ban-da-nhiem-jid6421.html) — Hưng Yên
- [external-bdcdb2d95c05](https://career.fpt.edu.vn/Job/Detail/79770) — Điện Biên, Phú Thọ, Hà Tĩnh, Hồ Chí Minh
- [external-9f6a7884628b](https://tuyendung.tokyolife.vn/jobs/772) — Lai Châu
- [external-bdc7033d1f49](https://tuyendung.vnpay.vn/tuyen-dung/chuyen-vien-quan-he-khach-hang-account-manager-lang-son.html) — Lạng Sơn
- [external-25739cac6534](https://rohto.com.vn/tuyen-dung/co-hoi-nghe-nghiep/nhan-vien-kinh-nghiem/truong-nhom-ban-hang-kenh-gt-central-highland.html) — Thái Nguyên, Bắc Ninh, Cao Bằng
- [external-a01272892fa1](https://tuyendung.sungroup.com.vn/job/ha-noiquang-ninh-chuyen-vien-cap-caochuyen-vien-chinh-quan-ly-thiet-ke-mang-dien-nang-12781) — Hà Nội, Quảng Ninh
- [external-5af55f24b66b](https://tuyendung.sungroup.com.vn/job/sa-pa-lao-cai-nhan-vien-ky-thuat-thoi-vu-10987) — Lào Cai
- [external-4c539d8dcdf8](https://www.agribank.com.vn/vn/tuyen-dung/dtl?current=true&urile=wcm:path:/agbank/tuyen-dung/chuong-trinh-tuyen-dung/2019/thong-bao-tuyen-dung-dot-1-nam-2026) — Sơn La
- [external-05a00fe2d943](https://tuyendung.sapo.vn/co-hoi-viec-lam/nhan-vien-kinh-doanh-thanh-hoa-a3597.html) — Thanh Hóa
- [external-99dd89818002](https://tuyendung.sapo.vn/co-hoi-viec-lam/truong-phong-kinh-doanh-kenh-thue-a3973.html) — Nghệ An
- [external-e2de04a99a43](https://vieclamhatinh.vn/job/details/Pho-phong-dao-tao-8764.html) — Hà Tĩnh
- [external-d25dde94432a](https://hanwhalifevietnam.talent.vn/job/customer-services-staff-outsourcing-contract-nhan-vien-dich-vu-khach-hang-hop-dong-qua-kenh-doi-tac-4912) — Huế, Khánh Hòa
- [external-15d6ba7dec46](https://hanwhalifevietnam.talent.vn/job/agency-training-senior-officer-chuyen-vien-cap-cao-huan-luyen-ho-tro-dai-ly-4932) — Đắk Lắk
- [external-2e05bbfdca46](https://hanwhalifevietnam.talent.vn/job/zone-director-giam-doc-kinh-doanh-khu-vuc-4880) — Lâm Đồng, Quảng Ngãi, Quảng Ninh, Gia Lai
- [external-79b2cf72845e](https://tuyendung.vnpt.vn/tim-viec-lam/chuyen-vien-phan-tich-nghiep-vu-ba-jid5034.html) — Hà Nội, Đồng Tháp
- [external-bf6dee807d97](https://tuyendung.vnpt.vn/tim-viec-lam/ky-su-hoc-sau-jid5190.html) — Hà Nội, Hồ Chí Minh, Đà Nẵng
- [external-229e5410b3eb](https://tuyendung.jollibee.com.vn/job/long-hau-tro-ly-kho-15561) — Tây Ninh
- [external-f55bf8104b7b](https://tuyendung.jollibee.com.vn/job/bao-loc-to-truong-cua-hang-ga-ran-jollibee-11950) — Lâm Đồng
- [external-96992334d10d](https://tuyendung.jollibee.com.vn/job/dong-nai-to-truong-cua-hang-10565) — Đồng Nai
- [external-97ac2000266d](https://tuyendung.jollibee.com.vn/job/da-nang-nhan-vien-cua-hang-7000) — Đà Nẵng
- [external-1f02d32dd4f2](https://tuyendung.jollibee.com.vn/job/ben-tre-nhan-vien-cua-hang-moi-jollibee-go-ben-tre-15798) — Vĩnh Long
- [external-f5e83859927c](https://tuyendung.jollibee.com.vn/job/an-giang-nhan-vien-cua-hang-jollibee-chau-doc-15772) — An Giang
- [external-dddb815461f3](https://fticareer.vn/chuyen-vien-kinh-doanh-du-an-can-tho-302) — Cần Thơ
- [external-ffde361b6c94](https://vieclamcantho.vn/thongtinTD.aspx?idTuyendung=MgAAADgAAAA0AAAAOQAAADMAAAA%3D) — Cà Mau, An Giang
- [external-f3202a58d8ce](https://bdsnammientrung.com/tuyen-dung/tin-tuc-tuyen-dung/quang-tri-nhan-vien-kinh-doanh/) — Quảng Trị
