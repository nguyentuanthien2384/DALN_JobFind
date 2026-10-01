import React, { useMemo } from 'react';
import MarkdownIt from 'markdown-it';

// Model output is untrusted. Raw HTML/images are disabled; links stay in JobFind.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });
markdown.disable('image');
markdown.validateLink = (url) => /^\/(?:detail-job\/[1-9]\d*|job|company|login|register|contact|chat|candidate(?:\/[a-z-]+)?)$/.test(url);
// The configured AI gateway sometimes drops one asterisk of a bold route
// ("tại */candidate/info**"), which would render as italics plus a stray "*".
const repairBoldRoutes = (text) => text.replace(/(^|\s)\*(\/[^\s*]+)\*\*(?!\*)/g, '$1**$2**');

export default function SupportMarkdown({ text }) {
    const html = useMemo(() => markdown.render(repairBoldRoutes(text || '')), [text]);
    return <div className="jf-support__markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
