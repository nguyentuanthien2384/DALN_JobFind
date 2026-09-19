import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supportRequest } from '../../service/supportChatService';
import './SupportChat.css';

export default function SupportHelp() {
    const [articles, setArticles] = useState([]), [error, setError] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        supportRequest('/knowledge', { signal: controller.signal }).then(setArticles).catch(cause => { if (cause.name !== 'AbortError') setError(cause.message); });
        return () => controller.abort();
    }, []);
    useEffect(() => { if (articles.length) document.getElementById(window.location.hash.slice(1))?.scrollIntoView(); }, [articles]);
    return <main className="jf-support-help"><Link to="/">← Trang chủ JobFind</Link><h1>Hướng dẫn sử dụng JobFind</h1><p>Nguồn hướng dẫn công khai được chatbot tham khảo. Các trạng thái và hạn mức riêng được kiểm tra trực tiếp từ tài khoản của bạn.</p>{error && <p role="alert">{error}</p>}{!error && !articles.length && <p>Đang tải hướng dẫn...</p>}{articles.map(article => <section id={article.id} key={article.id}><h2>{article.title}</h2><p>{article.text}</p><small>Phiên bản {article.version}</small></section>)}</main>;
}
