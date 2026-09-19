import React, { useMemo } from 'react';
import MarkdownIt from 'markdown-it';

// Model output is untrusted. Raw HTML/images are disabled; links stay in JobFind.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });
markdown.disable('image');
markdown.validateLink = (url) => /^\/(?:detail-job\/[1-9]\d*|job|company|login|register|contact|chat|candidate(?:\/[a-z-]+)?)$/.test(url);

export default function SupportMarkdown({ text }) {
    const html = useMemo(() => markdown.render(text || ''), [text]);
    return <div className="jf-support__markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
