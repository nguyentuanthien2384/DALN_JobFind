// So khop ten ky nang voi mo ta tin tuyen dung hoac noi dung CV.
//
// Cach cu bo moi ky tu khong phai chu cai roi tim chuoi con: "C++" va "C#" deu
// thanh "c" nen khop gan nhu moi CV, "Go" khop "Google". Ky nang ngan, co ky
// hieu (+, #) hoac bat dau bang dau cham (.NET) phai khop tron mot tu; ky nang
// dai hon giu cach cu de "React" van khop "ReactJS", "Node.js" khop "NodeJS".

const plain = (value) => String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

// Chi giu chu cai: "Kỹ năng giao tiếp" -> "kynanggiaotiep".
const flatText = (value) => plain(value).replace(/[^a-z]/g, '');

// Giu chu, so va ky hieu co nghia trong ten ky nang; moi ky tu khac la dau cach.
const tokenText = (value) => ` ${plain(value).replace(/[^a-z0-9+#]+/g, ' ').trim()} `;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Chuan hoa mot lan cho moi doan van ban, roi dung lai cho moi ky nang.
const prepareSkillText = (value) => ({ flat: flatText(value), token: tokenText(value) });

const createSkillMatcher = (name) => {
    const token = tokenText(name).trim();
    if (!token) return null;
    const flat = flatText(name);
    const exact = /[+#]/.test(token) || /^\s*\./.test(String(name ?? '')) || flat.length <= 2;
    if (!exact) return { matches: (text) => text.flat.includes(flat) };
    // Cho phep so dung sau ("C++17", "C#10") nhung khong cho chu hay ky hieu; ten
    // ket thuc bang chu so thi so dung sau la mot so khac ("123" khong khop "1234").
    const after = /[0-9]$/.test(token) ? 'a-z0-9+#' : 'a-z+#';
    const pattern = new RegExp(`(?<![a-z0-9+#])${escapeRegExp(token)}(?![${after}])`);
    return { matches: (text) => pattern.test(text.token) };
};

module.exports = { createSkillMatcher, prepareSkillText };
