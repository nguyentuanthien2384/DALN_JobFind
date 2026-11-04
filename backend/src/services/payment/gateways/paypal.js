// ===== PAYPAL (paypal-rest-sdk, REST v1, sandbox mac dinh) =====
// Dung chung cau hinh voi luong mua goi PayPal da co (paymentIntegrityService).
// Don duoc quy doi VND -> USD theo PAYMENT_USD_VND_RATE; tien chi duoc thu khi
// server goi "execute" sau khi nguoi mua duyet tren PayPal.
const paypal = require('paypal-rest-sdk');
const { getPaymentReturnUrl } = require('./common');

paypal.configure({
    mode: process.env.PAYPAL_MODE || 'sandbox',
    client_id: process.env.PAYPAL_CLIENT_ID || process.env.CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET || process.env.CLIENT_SECRET
});

const isConfigured = () => Boolean((process.env.PAYPAL_CLIENT_ID || process.env.CLIENT_ID)
    && (process.env.PAYPAL_CLIENT_SECRET || process.env.CLIENT_SECRET));

const money = (value) => Number(value).toFixed(2);
const call = (fn, ...args) => new Promise((resolve) => fn(...args, (error, payment) => resolve({ error, payment })));

const createPayment = async ({ orderCode, providerAmount, orderInfo }) => {
    const returnUrl = `${getPaymentReturnUrl('PAYPAL')}&order=${encodeURIComponent(orderCode)}`;
    const { error, payment } = await call(paypal.payment.create.bind(paypal.payment), {
        intent: 'sale',
        payer: { payment_method: 'paypal' },
        redirect_urls: { return_url: returnUrl, cancel_url: `${returnUrl}&cancel=1` },
        transactions: [{
            amount: { currency: 'USD', total: money(providerAmount) },
            description: orderInfo,
            invoice_number: orderCode
        }]
    });
    if (error) return { error: error.response?.message || error.message || 'PayPal từ chối tạo giao dịch' };
    const approval = (payment?.links || []).find((link) => link.rel === 'approval_url');
    if (!payment?.id || !approval?.href) return { error: 'PayPal trả về giao dịch không đầy đủ' };
    return { checkoutUrl: approval.href, providerRef: String(payment.id) };
};

// Chi chap nhan khi PayPal xac nhan dung ma giao dich, trang thai approved va dung so tien.
const paymentMatches = (payment, order) => {
    if (!payment || String(payment.id) !== String(order.providerRef)) return false;
    if (String(payment.state || '').toLowerCase() !== 'approved') return false;
    const amount = payment.transactions?.[0]?.amount;
    if (!amount || String(amount.currency).toUpperCase() !== 'USD') return false;
    if (money(amount.total) !== money(order.providerAmount)) return false;
    const sale = (payment.transactions?.[0]?.related_resources || []).find((item) => item && item.sale)?.sale;
    return !sale || String(sale.state || '').toLowerCase() === 'completed';
};

const executePayment = async (order, payerId) => {
    const executed = await call(paypal.payment.execute.bind(paypal.payment), order.providerRef, {
        payer_id: payerId,
        transactions: [{ amount: { currency: 'USD', total: money(order.providerAmount) } }]
    });
    if (!executed.error && paymentMatches(executed.payment, order)) {
        return { success: true, transId: executed.payment.transactions?.[0]?.related_resources?.[0]?.sale?.id || order.providerRef };
    }
    // Co the da execute o lan truoc (tien da tru) nhung chua ghi nhan: hoi lai PayPal.
    const fetched = await call(paypal.payment.get.bind(paypal.payment), order.providerRef);
    if (!fetched.error && paymentMatches(fetched.payment, order)) return { success: true, transId: order.providerRef };
    return { success: false, message: 'PayPal chưa xác nhận giao dịch' };
};

module.exports = { name: 'PAYPAL', isConfigured, createPayment, executePayment, paymentMatches, money };
