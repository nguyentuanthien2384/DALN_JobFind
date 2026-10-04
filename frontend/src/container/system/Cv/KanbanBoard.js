import React, { useEffect, useState, useCallback, useRef } from "react";
import OfferLetterForm, { OfferSummary } from './OfferLetterForm';
import InterviewInvitationForm, { InterviewSummary } from './InterviewInvitationForm';
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import {
    getApplicationBoard,
    moveApplicationStage,
    sendApplicationDecision,
    sendInterviewInvitation,
    rateApplication,
    addApplicationNote,
    getApplicationDetail,
    getFunnel,
    saveToTalentPool,
} from "../../../service/applicationService";
import { getAllPostByAdminService, getDetailCompanyById } from "../../../service/userService";
import { useScreenings, needsScreening, ScreeningBadge, ScreeningPanel, AiMessageDraft } from "./KanbanAi";
import { aiErrorMessage } from "../../../service/aiAssist";
import "./KanbanBoard.scss";

// Bang Kanban quan ly ho so ung tuyen.
//
// Truoc day nha tuyen dung chi thay ho so "da doc / chua doc". Man hinh nay cho
// keo tha ho so qua tung buoc tuyen dung, cham sao, ghi chu noi bo, va nhin ngay
// duoc con bao nhieu nguoi dang o moi buoc.

const isDemoRecipient = (value) => {
    const email = String(value || "").trim().toLowerCase();
    const domain = email.split("@")[1] || "";
    const reservedDomains = ["example.com", "example.net", "example.org"];
    return email === "example@gmail.com"
        || reservedDomains.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
        || [".example", ".invalid", ".test", ".local", ".localhost"]
            .some((suffix) => domain.endsWith(suffix));
};

const recipientLabel = (email) => (isDemoRecipient(email)
    ? "hộp thư demo (nếu đã cấu hình)"
    : (email || "email đã đăng ký của ứng viên"));

// Ung vien da duoc moi phong van (qua thu moi hoac keo vao cot) thi thu tu choi
// mac dinh cam on ho da tham gia buoi phong van.
const wasInvited = (detail) => detail.stage === "phong_van"
    || (detail.timeline || []).some((event) => event.to_stage === "phong_van");

const KanbanBoard = () => {
    const navigate = useNavigate();
    const [columns, setColumns] = useState([]);
    const [total, setTotal] = useState(0);
    const [funnel, setFunnel] = useState(null);
    const [posts, setPosts] = useState([]);
    const [jobId, setJobId] = useState("");
    const [dragging, setDragging] = useState(null);
    const [dragOverStage, setDragOverStage] = useState(null);
    const [detail, setDetail] = useState(null);
    const [noteText, setNoteText] = useState("");
    const [decisionMessage, setDecisionMessage] = useState("");
    const [isSendingDecision, setIsSendingDecision] = useState(false);
    // null | "interview" | "offer": chi mo mot bieu mau soan thu tai mot thoi diem.
    const [composer, setComposer] = useState(null);
    const [attended, setAttended] = useState(true);
    const [company, setCompany] = useState(null);
    const sendingDecision = useRef(false);
    const currentDetail = useRef(null);
    currentDetail.current = detail?.id;
    const [isLoading, setIsLoading] = useState(true);

    const user = JSON.parse(localStorage.getItem("userData") || "{}");
    const boardRequest = useRef(0);
    // AI cham CV va soan thu chi danh cho tai khoan thuoc cong ty (khong cho ADMIN).
    const recruiterAi = ["COMPANY", "EMPLOYER"].includes(user.roleCode);
    const { byCv: screenings, refresh: refreshScreenings, screen: screenCv, markFailed } = useScreenings();
    const [sortByAi, setSortByAi] = useState(false);
    const [bulk, setBulk] = useState(null);

    const loadBoard = useCallback(async (selectedJobId) => {
        // Lan tai dau (tat ca tin) co the ve sau khi nguoi dung da chon loc: chi
        // ap ket qua cua lan tai moi nhat, neu khong bang hien sai tin dang chon.
        const request = ++boardRequest.current;
        setIsLoading(true);
        const [board, funnelRes] = await Promise.all([
            getApplicationBoard(selectedJobId),
            getFunnel(selectedJobId),
        ]);
        if (request !== boardRequest.current) return;
        if (board && board.errCode === 0) {
            setColumns(board.data.columns);
            setTotal(board.data.total);
            if (recruiterAi) {
                const jobIds = [selectedJobId, ...board.data.columns.flatMap((col) => col.items.map((item) => item.job_id))];
                refreshScreenings(jobIds).catch(() => {});
            }
        } else {
            toast.error((board && board.errMessage) || "Không tải được danh sách ứng viên");
        }
        if (funnelRes && funnelRes.errCode === 0) setFunnel(funnelRes.data);
        setIsLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let mounted = true;
        const init = async () => {
            // Ten va dia chi cong ty dien san vao thu moi; loi o day khong chan bang Kanban.
            if (user.companyId) {
                getDetailCompanyById(user.companyId).then((res) => {
                    if (mounted && res?.errCode === 0 && res.data) setCompany({ name: res.data.name || "", address: res.data.address || "" });
                }).catch(() => {});
            }
            const res = await getAllPostByAdminService({
                limit: 100, offset: 0, companyId: user.companyId, search: "", censorCode: "",
            });
            if (mounted && res && res.errCode === 0) setPosts(res.data || []);
            await loadBoard("");
        };
        init();
        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFilterJob = async (value) => {
        setJobId(value);
        await loadBoard(value);
    };

    // ===== Keo tha =====
    const handleDrop = async (targetStage) => {
        setDragOverStage(null);
        if (!dragging || dragging.stage === targetStage) {
            setDragging(null);
            return;
        }

        const moved = dragging;
        setDragging(null);

        // Moi phong van can ngay gio, hinh thuc va noi hen: mo thu moi thay vi gui
        // email chuyen buoc khong co thong tin. Ho so chi chuyen cot khi da gui thu.
        if (targetStage === "phong_van") {
            if (moved.stage === "nhan_viec") {
                toast.error("Ứng viên đã nhận việc nên không gửi thư mời phỏng vấn");
                return;
            }
            await openDetail(moved.id, { compose: "interview" });
            return;
        }

        // Keo vao cot Tu choi gui ngay email khong trung tuyen cho ung vien: phai hoi
        // lai nhu nut "Gui khong trung tuyen", tha nham cot thi khong rut lai duoc.
        if (targetStage === "tu_choi" && !window.confirm(
            `Chuyển ${moved.candidate_name || "ứng viên"} sang "Từ chối"? Ứng viên sẽ nhận email thông báo không trúng tuyển tại ${recipientLabel(moved.candidate_email)}.`
        )) return;

        // Cap nhat giao dien truoc, goi may chu sau. Neu cho may chu tra loi moi
        // ve lai the thi thao tac keo tha se giat, cam giac nhu bi treo.
        const previous = columns;
        setColumns((cols) =>
            cols.map((c) => {
                if (c.stage === moved.stage) {
                    const items = c.items.filter((i) => i.id !== moved.id);
                    return { ...c, items, count: items.length };
                }
                if (c.stage === targetStage) {
                    const items = [{ ...moved, stage: targetStage }, ...c.items];
                    return { ...c, items, count: items.length };
                }
                return c;
            })
        );

        const res = await moveApplicationStage(moved.id, targetStage);
        if (res && res.errCode === 0) {
            toast.success(`Đã chuyển ${moved.candidate_name || "ứng viên"} sang bước mới`);
            const funnelRes = await getFunnel(jobId);
            if (funnelRes && funnelRes.errCode === 0) setFunnel(funnelRes.data);
        } else {
            // May chu tu choi thi tra the ve cho cu, khong de giao dien noi doi.
            setColumns(previous);
            toast.error((res && res.errMessage) || "Không chuyển được trạng thái");
        }
    };

    const openDetail = async (id, { compose = null } = {}) => {
        if (sendingDecision.current) return;
        const res = await getApplicationDetail(id);
        if (res && res.errCode === 0) {
            setDetail(res.data);
            if (recruiterAi && res.data.job_id) refreshScreenings([res.data.job_id]).catch(() => {});
            setNoteText("");
            setDecisionMessage("");
            setAttended(true);
            setComposer(compose && res.data.stage !== "nhan_viec" ? compose : null);
        } else {
            toast.error("Không mở được hồ sơ");
        }
    };

    const handleRate = async (id, star) => {
        const res = await rateApplication(id, star);
        if (res && res.errCode === 0) {
            setDetail((d) => (d ? { ...d, rating: star } : d));
            setColumns((cols) =>
                cols.map((c) => ({
                    ...c,
                    items: c.items.map((i) => (i.id === id ? { ...i, rating: star } : i)),
                }))
            );
            toast.success(`Đã chấm ${star} sao`);
        } else {
            toast.error((res && res.errMessage) || "Không chấm được điểm");
        }
    };

    const handleAddNote = async () => {
        if (!noteText.trim()) return;
        const res = await addApplicationNote(detail.id, noteText.trim());
        if (res && res.errCode === 0) {
            setDetail((d) => ({ ...d, notes: [res.data, ...(d.notes || [])] }));
            setNoteText("");
            toast.success("Đã thêm ghi chú");
        } else {
            toast.error("Không thêm được ghi chú");
        }
    };

    const handleSaveTalent = async () => {
        const res = await saveToTalentPool({
            candidateId: detail.candidate_id,
            candidateName: detail.candidate_name,
            note: `Từ hồ sơ ứng tuyển "${detail.job_title || ""}"`,
        });
        if (res && res.errCode === 0) toast.success("Đã lưu vào kho ứng viên");
        else toast.error("Không lưu được");
    };

    // Moi email gui ung vien: xac nhan dia chi nhan, gui dung mot lan, roi tai lai
    // bang va lich su. Loi mang khong duoc coi la gui that bai (co the da vao hang doi).
    const queueCandidateEmail = async (label, send) => {
        if (sendingDecision.current || !detail) return;
        const applicationId = detail.id;
        if (!window.confirm(`Gửi email ${label} đến ${recipientLabel(detail.candidate_email)}?`)) return;

        sendingDecision.current = true;
        setIsSendingDecision(true);
        try {
            const res = await send(applicationId);
            if (res && res.errCode === 0) {
                toast.success(`Đã xếp hàng gửi email ${label}`);
                if (currentDetail.current === applicationId) {
                    setDetail((d) => d?.id === applicationId ? { ...d, ...res.data } : d);
                    setDecisionMessage("");
                    setComposer(null);
                }
                // A refresh failure must not imply the successful send failed.
                await Promise.allSettled([loadBoard(jobId), getApplicationDetail(applicationId).then((fresh) => {
                    if (fresh?.errCode === 0 && currentDetail.current === applicationId) setDetail(fresh.data);
                })]);
            } else if (!res || ['network', 'timeout', 'cancelled', 'unavailable'].includes(res.errorType)) {
                toast.error("Chưa xác định được kết quả gửi. Hãy tải lại hồ sơ và kiểm tra lịch sử trước khi gửi lại.");
            } else {
                toast.error(res.errMessage || "Không thể gửi email thông báo");
            }
        } catch {
            toast.error("Chưa xác định được kết quả gửi. Hãy tải lại hồ sơ và kiểm tra lịch sử trước khi gửi lại.");
        } finally {
            sendingDecision.current = false;
            setIsSendingDecision(false);
        }
    };

    const handleSendDecision = (decision, offer) => {
        const message = decisionMessage.trim();
        if (decision === "accepted") {
            return queueCandidateEmail("thông báo trúng tuyển", (id) => sendApplicationDecision(id, decision, message, offer));
        }
        if (!detail || !wasInvited(detail)) {
            return queueCandidateEmail("thông báo không trúng tuyển", (id) => sendApplicationDecision(id, decision, message));
        }
        return queueCandidateEmail(attended ? "cảm ơn đã tham gia phỏng vấn (không trúng tuyển)" : "thông báo không trúng tuyển",
            (id) => sendApplicationDecision(id, decision, message, undefined, attended));
    };

    const handleSendInterview = (interview) => queueCandidateEmail("thư mời phỏng vấn",
        (id) => sendInterviewInvitation(id, decisionMessage.trim(), interview));

    // AI cham lan luot cac ho so chua co ket qua cua tin dang chon (2 ho so cung luc).
    const handleBulkScreen = async () => {
        if (bulk || !jobId) return;
        const targets = columns.flatMap((col) => col.items)
            .filter((item) => item.legacy_cv_id && String(item.job_id) === String(jobId)
                && !["tu_choi", "nhan_viec"].includes(item.stage) && needsScreening(screenings[item.legacy_cv_id]))
            .slice(0, 50);
        if (!targets.length) {
            toast.success("Các hồ sơ đang xét của tin này đều đã có kết quả AI");
            return;
        }
        if (!window.confirm(`AI sẽ đọc và chấm ${targets.length} hồ sơ chưa có kết quả của tin này (mỗi hồ sơ là một lượt gọi AI, tối đa 50 hồ sơ mỗi lần). Kết quả chỉ để tham khảo. Tiếp tục?`)) return;
        const queue = [...targets];
        let sent = 0, failed = 0;
        setBulk({ total: targets.length, sent: 0, failed: 0 });
        const worker = async () => {
            while (queue.length) {
                const item = queue.shift();
                try { await screenCv(item.legacy_cv_id, item.job_id); sent += 1; }
                catch (error) { failed += 1; markFailed(item.legacy_cv_id, item.job_id, aiErrorMessage(error)); }
                setBulk({ total: targets.length, sent, failed });
            }
        };
        await Promise.all([worker(), worker()]);
        setBulk(null);
        if (failed) toast.error(`Đã gửi ${sent} hồ sơ cho AI; ${failed} hồ sơ chưa gửi được`);
        else toast.success(`Đã gửi ${sent} hồ sơ cho AI chấm. Điểm sẽ hiện trên từng thẻ khi có kết quả.`);
    };

    const aiScore = (item) => screenings[item.legacy_cv_id]?.result?.score ?? -1;
    const orderedItems = (items) => (sortByAi ? [...items].sort((a, b) => aiScore(b) - aiScore(a)) : items);

    const stageLabel = (stage) => columns.find((col) => col.stage === stage)?.label || stage;

    const renderStars = (id, current) => (
        <div className="kb-stars">
            {[1, 2, 3, 4, 5].map((s) => (
                <span
                    key={s}
                    className={s <= (current || 0) ? "on" : ""}
                    onClick={() => handleRate(id, s)}
                    title={`${s} sao`}
                >
                    ★
                </span>
            ))}
        </div>
    );

    return (
        <div className="kanban-board">
            <div className="kb-head">
                <div>
                    <h3>Quản lý hồ sơ ứng tuyển</h3>
                    <p className="kb-sub">
                        Kéo thả hồ sơ giữa các cột để chuyển bước tuyển dụng.
                        Tổng cộng <b>{total}</b> hồ sơ.
                    </p>
                </div>
                <div className="kb-head-actions">
                <button type="button" className="kb-btn" onClick={() => navigate('/admin/interviews')}>Lịch phỏng vấn</button>
                {recruiterAi && (
                    <div className="kb-ai-tools">
                        <button
                            type="button"
                            className="kb-btn ai"
                            disabled={!jobId || Boolean(bulk) || isLoading}
                            title={jobId ? undefined : "Chọn một tin tuyển dụng để AI sàng lọc hồ sơ"}
                            onClick={handleBulkScreen}
                        >
                            {bulk ? `AI đang nhận hồ sơ ${bulk.sent + bulk.failed}/${bulk.total}…` : "AI sàng lọc hồ sơ"}
                        </button>
                        <label className="kb-check">
                            <input type="checkbox" checked={sortByAi} onChange={(e) => setSortByAi(e.target.checked)} />
                            Sắp xếp theo điểm AI
                        </label>
                    </div>
                )}
                <select
                    className="kb-filter"
                    value={jobId}
                    onChange={(e) => handleFilterJob(e.target.value)}
                >
                    <option value="">Tất cả tin tuyển dụng</option>
                    {posts.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.postDetailData?.name || `Tin #${p.id}`}
                        </option>
                    ))}
                </select>
                </div>
            </div>

            {funnel && (
                <div className="kb-funnel">
                    {funnel.funnel.map((f) => (
                        <div className="kb-funnel-item" key={f.stage}>
                            <span className="num">{f.count}</span>
                            <span className="lbl">{f.label}</span>
                        </div>
                    ))}
                    <div className="kb-funnel-item rate">
                        <span className="num">{funnel.conversionRate}%</span>
                        <span className="lbl">Tỷ lệ tuyển thành công</span>
                    </div>
                </div>
            )}

            {isLoading ? (
                <div className="kb-empty">Đang tải…</div>
            ) : (
                <div className="kb-columns">
                    {columns.map((col) => (
                        <div
                            key={col.stage}
                            role="region"
                            aria-label={col.label}
                            className={`kb-col ${dragOverStage === col.stage ? "over" : ""}`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverStage(col.stage);
                            }}
                            onDragLeave={() => setDragOverStage(null)}
                            onDrop={() => handleDrop(col.stage)}
                        >
                            <div className={`kb-col-head stage-${col.stage}`}>
                                <span>{col.label}</span>
                                <span className="kb-count">{col.count}</span>
                            </div>

                            <div className="kb-col-body">
                                {col.items.length === 0 && (
                                    <div className="kb-col-empty">Chưa có hồ sơ</div>
                                )}
                                {orderedItems(col.items).map((item) => (
                                    <div
                                        key={item.id}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Hồ sơ ${item.candidate_name || `Ứng viên #${item.candidate_id}`}`}
                                        className={`kb-card ${item.is_read ? "" : "unread"}`}
                                        draggable
                                        onDragStart={() => setDragging(item)}
                                        onDragEnd={() => setDragging(null)}
                                        onClick={() => openDetail(item.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                openDetail(item.id);
                                            }
                                        }}
                                    >
                                        <div className="kb-card-name">
                                            {item.candidate_name || `Ứng viên #${item.candidate_id}`}
                                            {!item.is_read && <span className="kb-dot" title="Chưa xem" />}
                                        </div>
                                        <div className="kb-card-job">{item.job_title || "—"}</div>
                                        <div className="kb-card-foot">
                                            {renderStars(item.id, item.rating)}
                                            {item.match_score !== null && item.match_score !== undefined && (
                                                <span className="kb-match">{item.match_score}% khớp</span>
                                            )}
                                            {recruiterAi && <ScreeningBadge item={screenings[item.legacy_cv_id]} />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {detail && (
                <div
                    className="kb-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Chi tiết hồ sơ ${detail.candidate_name || `Ứng viên #${detail.candidate_id}`}`}
                    onClick={() => setDetail(null)}
                >
                    <div className="kb-modal-box" onClick={(e) => e.stopPropagation()}>
                        <div className="kb-modal-head">
                            <div>
                                <h4>{detail.candidate_name || `Ứng viên #${detail.candidate_id}`}</h4>
                                <p>{detail.job_title}</p>
                            </div>
                            <button className="kb-close" onClick={() => setDetail(null)}>×</button>
                        </div>

                        <div className="kb-modal-body">
                            <div className="kb-info">
                                <div><b>Email:</b> {detail.candidate_email || "—"}</div>
                                <div><b>Điện thoại:</b> {detail.candidate_phone || "—"}</div>
                                <div><b>Ngày nộp:</b> {new Date(detail.applied_at).toLocaleDateString("vi-VN")}</div>
                                <div><b>Đánh giá:</b> {renderStars(detail.id, detail.rating)}</div>
                            </div>

                            {recruiterAi && (
                                <ScreeningPanel detail={detail} item={screenings[detail.legacy_cv_id]} onScreen={screenCv} />
                            )}

                            {detail.cover_letter && (
                                <div className="kb-section">
                                    <h5>Thư ứng tuyển</h5>
                                    <p className="kb-cover">{detail.cover_letter}</p>
                                </div>
                            )}

                            <div className="kb-section">
                                <h5>Ghi chú nội bộ ({detail.notes?.length || 0})</h5>
                                <p className="kb-hint">Ứng viên không xem được phần này.</p>
                                <div className="kb-note-add">
                                    <textarea
                                        rows={2}
                                        value={noteText}
                                        placeholder="Nhận xét về ứng viên…"
                                        onChange={(e) => setNoteText(e.target.value)}
                                    />
                                    <button onClick={handleAddNote}>Thêm</button>
                                </div>
                                {(detail.notes || []).map((n) => (
                                    <div className="kb-note" key={n.id}>
                                        <div className="kb-note-body">{n.body}</div>
                                        <div className="kb-note-time">
                                            {new Date(n.created_at).toLocaleString("vi-VN")}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="kb-section kb-decision">
                                <h5>Gửi email cho ứng viên</h5>
                                <p className="kb-hint">
                                    Email sẽ gửi đến: <b>{detail.candidate_email || "email đã đăng ký"}</b>
                                    {isDemoRecipient(detail.candidate_email)
                                        ? " (dữ liệu mẫu — development sẽ chuyển nếu có hộp thư demo; production sẽ chặn)"
                                        : ""}
                                </p>
                                <textarea
                                    rows={3}
                                    value={decisionMessage}
                                    placeholder="Lời nhắn thêm cho ứng viên (không bắt buộc)"
                                    maxLength={3000}
                                    disabled={isSendingDecision}
                                    onChange={(e) => setDecisionMessage(e.target.value)}
                                />
                                {recruiterAi && (
                                    <AiMessageDraft key={`ai-draft-${detail.id}`} detail={detail} composer={composer}
                                        notes={decisionMessage} interviewed={wasInvited(detail) ? attended : false}
                                        disabled={isSendingDecision} onUse={(text) => setDecisionMessage(text.slice(0, 3000))} />
                                )}
                                {composer === "interview" && <InterviewInvitationForm key={`interview-${detail.id}`} detail={detail} user={user} company={company}
                                    message={decisionMessage.trim()} busy={isSendingDecision}
                                    onSend={handleSendInterview} onCancel={() => setComposer(null)} />}
                                {composer === "offer" && <OfferLetterForm key={`offer-${detail.id}`} detail={detail} user={user} company={company}
                                    message={decisionMessage.trim()} busy={isSendingDecision}
                                    onSend={(offer) => handleSendDecision('accepted', offer)} onCancel={() => setComposer(null)} />}
                                {wasInvited(detail) && !composer && (
                                    <label className="kb-check">
                                        <input type="checkbox" checked={attended} disabled={isSendingDecision}
                                            onChange={(e) => setAttended(e.target.checked)} />
                                        Ứng viên đã tham gia phỏng vấn — thư không trúng tuyển sẽ cảm ơn ứng viên đã tham gia buổi phỏng vấn
                                    </label>
                                )}
                                <div className="kb-decision-actions">
                                    <button
                                        className="kb-btn interview"
                                        disabled={isSendingDecision || detail.stage === "nhan_viec"}
                                        title={detail.stage === "nhan_viec" ? "Ứng viên đã nhận việc" : undefined}
                                        onClick={() => setComposer("interview")}
                                    >
                                        {isSendingDecision ? "Đang gửi…" : detail.stage === "phong_van" ? "Gửi lại / đổi lịch phỏng vấn" : "Mời phỏng vấn"}
                                    </button>
                                    <button
                                        className="kb-btn success"
                                        disabled={isSendingDecision}
                                        onClick={() => setComposer("offer")}
                                    >
                                        {isSendingDecision ? "Đang gửi…" : "Gửi trúng tuyển"}
                                    </button>
                                    <button
                                        className="kb-btn danger"
                                        disabled={isSendingDecision || Boolean(composer)}
                                        onClick={() => handleSendDecision("rejected")}
                                    >
                                        {isSendingDecision ? "Đang gửi…" : "Gửi không trúng tuyển"}
                                    </button>
                                </div>
                            </div>

                            <div className="kb-section">
                                <h5>Lịch sử tuyển dụng</h5>
                                {(detail.timeline || []).length === 0 && (
                                    <p className="kb-hint">Chưa có thay đổi nào.</p>
                                )}
                                {(detail.timeline || []).map((t) => (
                                    <div className="kb-time" key={t.id}>
                                        <span className="kb-time-dot" />
                                        <span>
                                            {t.from_stage ? `${stageLabel(t.from_stage)} → ` : ""}<b>{stageLabel(t.to_stage)}</b>
                                            {t.reason ? ` — ${t.reason}` : ""}
                                        </span>
                                        {t.decision_snapshot && <details className="kb-decision-history">
                                            <summary>Xem nội dung đã yêu cầu gửi</summary>
                                            {t.decision_snapshot.interview && <InterviewSummary interview={t.decision_snapshot.interview} />}
                                            {t.decision_snapshot.offer && <OfferSummary offer={t.decision_snapshot.offer} />}
                                            {t.decision_snapshot.decision === "rejected" && <p className="kb-hint">{t.decision_snapshot.interviewed
                                                ? "Thư cảm ơn ứng viên đã tham gia phỏng vấn (không trúng tuyển)."
                                                : "Thư thông báo không trúng tuyển."}</p>}
                                            {t.decision_snapshot.message && <p className="kb-cover">{t.decision_snapshot.message}</p>}
                                        </details>}
                                        <span className="kb-time-at">
                                            {new Date(t.created_at).toLocaleString("vi-VN")}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="kb-modal-foot">
                            <button className="kb-btn ghost" onClick={handleSaveTalent}>
                                Lưu vào kho ứng viên
                            </button>
                            {detail.legacy_cv_id && (
                                <button
                                    className="kb-btn"
                                    onClick={() => navigate(`/admin/user-cv/${detail.legacy_cv_id}`)}
                                >
                                    Xem file CV
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KanbanBoard;
