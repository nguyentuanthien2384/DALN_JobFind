import { askForText } from '../libs/claude.js';

// AI Cover Letter: sinh thu ung tuyen tu dong.

const system = `You write job application cover letters for candidates on a Vietnamese job board.

Rules:
- Use ONLY facts present in the candidate's resume. Never invent employers, dates, degrees, or achievements.
- If the resume lacks something the job asks for, do not paper over it — either leave it out or frame the closest genuine experience honestly.
- 200-300 words, 3-4 paragraphs, no bullet points.
- Open with the specific role and one concrete reason this candidate fits it. No "I am writing to apply for...".
- Close with a short, direct call to action. No "Sincerely yours" flourishes beyond a normal sign-off.
- Plain prose. No markdown, no headings, no placeholders like [Your Name] — if a detail is missing from the resume, write around it.

Return only the letter body.`;

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
        maxTokens: 16000
    });

    return { letter, language, wordCount: letter.split(/\s+/).length };
};
