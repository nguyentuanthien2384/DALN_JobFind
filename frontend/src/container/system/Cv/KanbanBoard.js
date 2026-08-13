import React, { useEffect, useState, useCallback } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import {
    getApplicationBoard,
    moveApplicationStage,
    sendApplicationDecision,
    rateApplication,
    addApplicationNote,
    getApplicationDetail,
    getFunnel,
    saveToTalentPool,
} from "../../../service/applicationService";
import { getAllPostByAdminService } from "../../../service/userService";
import "./KanbanBoard.scss";

// Bang Kanban quan ly ho so ung tuyen.
//
// Truoc day nha tuyen dung chi thay ho so "da doc / chua doc". Man hinh nay cho
// keo tha ho so qua tung buoc tuyen dung, cham sao, ghi chu noi bo, va nhin ngay
// duoc con bao nhieu nguoi dang o moi buoc.

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
    const [isLoading, setIsLoading] = useState(true);

    const user = JSON.parse(localStorage.getItem("userData") || "{}");

    const loadBoard = useCallback(async (selectedJobId) => {
        setIsLoading(true);
        const [board, funnelRes] = await Promise.all([
            getApplicationBoard(selectedJobId),
            getFunnel(selectedJobId),
        ]);
        if (board && board.errCode === 0) {
            setColumns(board.data.columns);
            setTotal(board.data.total);
        } else {
            toast.error((board && board.errMessage) || "Không tải được danh sách ứng viên");
        }
        if (funnelRes && funnelRes.errCode === 0) setFunnel(funnelRes.data);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        let mounted = true;
        const init = async () => {
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

    const openDetail = async (id) => {
        const res = await getApplicationDetail(id);
        if (res && res.errCode === 0) {
            setDetail(res.data);
            setNoteText("");
            setDecisionMessage("");
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

    const handleSendDecision = async (decision) => {
        const label = decision === "accepted" ? "trúng tuyển" : "không trúng tuyển";
        const destination = detail.candidate_email || "email đã đăng ký của ứng viên";
        if (!window.confirm(`Gửi email thông báo ${label} đến ${destination}?`)) return;

        setIsSendingDecision(true);
        const res = await sendApplicationDecision(detail.id, decision, decisionMessage.trim());
        setIsSendingDecision(false);

        if (res && res.errCode === 0) {
            toast.success(`Đã gửi email thông báo ${label}`);
            setDetail((d) => ({ ...d, ...res.data, timeline: d.timeline }));
            setDecisionMessage("");
            await loadBoard(jobId);
        } else {
            toast.error((res && res.errMessage) || "Không thể gửi email thông báo");
        }
    };

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
                                {col.items.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`kb-card ${item.is_read ? "" : "unread"}`}
                                        draggable
                                        onDragStart={() => setDragging(item)}
                                        onDragEnd={() => setDragging(null)}
                                        onClick={() => openDetail(item.id)}
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
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {detail && (
                <div className="kb-modal" onClick={() => setDetail(null)}>
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
                                <h5>Thông báo kết quả cho ứng viên</h5>
                                <p className="kb-hint">
                                    Email sẽ gửi đến: <b>{detail.candidate_email || "email đã đăng ký"}</b>
                                </p>
                                <textarea
                                    rows={3}
                                    value={decisionMessage}
                                    placeholder="Lời nhắn thêm cho ứng viên (không bắt buộc)"
                                    maxLength={3000}
                                    onChange={(e) => setDecisionMessage(e.target.value)}
                                />
                                <div className="kb-decision-actions">
                                    <button
                                        className="kb-btn success"
                                        disabled={isSendingDecision}
                                        onClick={() => handleSendDecision("accepted")}
                                    >
                                        {isSendingDecision ? "Đang gửi…" : "Gửi trúng tuyển"}
                                    </button>
                                    <button
                                        className="kb-btn danger"
                                        disabled={isSendingDecision}
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
                                            {t.from_stage ? `${t.from_stage} → ` : ""}<b>{t.to_stage}</b>
                                            {t.reason ? ` — ${t.reason}` : ""}
                                        </span>
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
