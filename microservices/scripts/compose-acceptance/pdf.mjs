// A complete, selectable-text PDF so the real worker's local extraction path is
// exercised before the synthetic model boundary responds.
export const fixturePdfBytes = () => {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const content = 'BT /F1 16 Tf 48 790 Td (Synthetic reviewed CV - Node developer) Tj ET';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const start = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return Buffer.from(pdf);
};
export const fixturePdf = () => `data:application/pdf;base64,${fixturePdfBytes().toString('base64')}`;
