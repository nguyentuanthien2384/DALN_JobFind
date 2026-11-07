import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { SANDBOX_TEST_CARDS } from '../../service/rewardPaymentService';

const copyToClipboard = async (text, label) => {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(String(text));
        }
        toast.info(`Đã sao chép ${label}: ${text}`);
    } catch (_err) {
        toast.info(`${label}: ${text}`);
    }
};

const SandboxTestCardHint = ({ provider = 'VNPAY', compact = false }) => {
    const providerKey = String(provider || 'VNPAY').toUpperCase();
    const cards = SANDBOX_TEST_CARDS[providerKey] || SANDBOX_TEST_CARDS.VNPAY;
    const [activeIdx, setActiveIdx] = useState(0);

    useEffect(() => {
        setActiveIdx(0);
    }, [providerKey]);

    const currentCard = cards[activeIdx] || cards[0];
    if (!currentCard) return null;

    return (
        <div
            style={{
                marginTop: compact ? '10px' : '12px',
                padding: compact ? '10px 12px' : '12px 14px',
                borderRadius: '10px',
                background: '#f0f7ff',
                border: '1px dashed #60a5fa',
                fontSize: '12.5px',
                color: '#1e293b',
                lineHeight: 1.5,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginBottom: '8px',
                }}
            >
                <span style={{ fontWeight: 700, color: '#003d9b', fontSize: '12.5px' }}>
                    <i className="fas fa-credit-card" style={{ marginRight: '6px' }} />
                    Thẻ dùng thử cấp sẵn miễn phí ({providerKey} Sandbox)
                </span>
                {cards.length > 1 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {cards.map((card, idx) => (
                            <button
                                key={`${card.type}-${idx}`}
                                type="button"
                                onClick={() => setActiveIdx(idx)}
                                style={{
                                    border: idx === activeIdx ? '1px solid #003d9b' : '1px solid #cbd5e1',
                                    background: idx === activeIdx ? '#003d9b' : '#ffffff',
                                    color: idx === activeIdx ? '#ffffff' : '#334155',
                                    borderRadius: '6px',
                                    padding: '2px 8px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                {card.type === 'VISA' ? 'Thẻ VISA' : idx === 0 ? 'Thẻ ATM #1' : `Thẻ ATM #${idx + 1}`}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
                    gap: '6px 12px',
                    background: '#ffffff',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    border: '1px solid #dbeafe',
                }}
            >
                <div>
                    <span style={{ color: '#64748b', fontSize: '11.5px' }}>Ngân hàng / Loại: </span>
                    <strong style={{ color: '#0f172a' }}>{currentCard.bank}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#64748b', fontSize: '11.5px' }}>Số thẻ: </span>
                    <code
                        style={{
                            fontWeight: 800,
                            color: '#003d9b',
                            background: '#eff6ff',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '12.5px',
                        }}
                    >
                        {currentCard.cardNumber}
                    </code>
                    <button
                        type="button"
                        onClick={() => copyToClipboard(currentCard.cardNumber, 'số thẻ test')}
                        style={{
                            border: '1px solid #93c5fd',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            borderRadius: '5px',
                            padding: '1px 6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        Sao chép
                    </button>
                </div>
                <div>
                    <span style={{ color: '#64748b', fontSize: '11.5px' }}>Tên chủ thẻ: </span>
                    <strong>{currentCard.cardHolder}</strong>
                </div>
                <div>
                    <span style={{ color: '#64748b', fontSize: '11.5px' }}>
                        {currentCard.issueDate ? 'Ngày phát hành: ' : 'Hết hạn / CVV: '}
                    </span>
                    <strong>
                        {currentCard.issueDate
                            ? currentCard.issueDate
                            : `${currentCard.expiryDate}${currentCard.cvv ? ` • CVV ${currentCard.cvv}` : ''}`}
                    </strong>
                    {currentCard.otp && (
                        <span style={{ marginLeft: '8px', color: '#059669', fontWeight: 700 }}>
                            • OTP: {currentCard.otp}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SandboxTestCardHint;
