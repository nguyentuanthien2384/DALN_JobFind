import { askForText } from '../libs/claude.js';

// AI Cover Letter: sinh thu ung tuyen tu dong.

// Keep the instruction compact. The configured gateway has returned HTTP 502
// for the previous, longer instruction even when the same short candidate/job
// prompt succeeds with this wording.
const system = `Write a professional cover letter for a job applicant. Use only the candidate resume facts. Write 200 to 300 words in 3 to 4 paragraphs. No markdown, headings, bullet points, or placeholders. Open with the role and a concrete match. End with a direct invitation to interview. Return only the letter body.`;

const stripHtml = (html) =>
    String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export const generateCoverLetter = async ({
    resumeText, jobTitle, jobDescription, companyName, language = 'en'
}) => {
    const languageNote = language === 'vi'
        ? 'Write the letter in Vietnamese.'
        : 'Write the letter in English.';

    const prompt = `${languageNote}

# Job
Position: ${jobTitle}
Company: ${companyName}

Description:
${stripHtml(jobDescription).slice(0, 10000)}

# Candidate resume
${String(resumeText).slice(0, 10000)}

Write the cover letter.`;

    const letter = await askForText({
        system,
        prompt,
        effort: 'medium',
        maxTokens: 4096
    });

    return { letter, language, wordCount: letter.split(/\s+/).length };
};
