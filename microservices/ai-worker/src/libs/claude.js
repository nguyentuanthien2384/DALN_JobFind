import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../../../shared/logger.js";

const logger = createLogger("ai-worker");

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

// SDK tu doc ANTHROPIC_API_KEY tu bien moi truong.
export const client = new Anthropic();

export const isConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Lay phan van ban trong cau tra loi. Cau tra loi con chua khoi `thinking`
// (Opus 5 bat suy luan mac dinh) nen phai loc theo type, khong the lay content[0].
const extractText = (message) =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

// Goi Claude va bat buoc cau tra loi dung dung mot lọc JSON schema.
//
// Dung structured outputs thay vi dan "hay tra ve JSON" vao prompt roi tu parse:
// cach do thinh thoang van tra ve JSON kem loi giai thich, hoac thieu truong, va
// moi lan hong lai phai goi lai. Voi output_config.format, API bao dam ket qua
// dung schema.
export const askForJson = async ({
  system,
  prompt,
  schema,
  effort = "medium",
  maxTokens = 8000,
}) => {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // Fallback phia may chu: bo phan loai an toan cua Opus 5 co the tu choi
    // mot yeu cau lanh tinh (vi du CV nganh an ninh mang). Khai bao san thi
    // API tu chay lai tren model du phong ngay trong cung lan goi, thay vi
    // tra ve loi cho nguoi dung.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort,
      format: { type: "json_schema", schema },
    },
    system,
    messages: [{ role: "user", content: prompt }],
  });

  // Phai kiem tra stop_reason truoc khi doc noi dung: khi bi tu choi thi
  // content rong, doc thang se no.
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category || "không rõ";
    throw new Error(`Claude từ chối xử lý yêu cầu này (nhóm: ${category})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Kết quả bị cắt giữa chừng, cần tăng max_tokens");
  }

  const text = extractText(response);
  if (!text) throw new Error("Claude trả về nội dung rỗng");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Không đọc được JSON từ kết quả của Claude");
  }
};

// Goi Claude tra ve van ban thuong (thu ung tuyen). Dung streaming vi ket qua
// dai: request khong streaming voi max_tokens lon de bi qua han HTTP.
export const askForText = async ({
  system,
  prompt,
  effort = "medium",
  maxTokens = 16000,
}) => {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort },
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category || "không rõ";
    throw new Error(`Claude từ chối xử lý yêu cầu này (nhóm: ${category})`);
  }

  const text = extractText(response);
  if (!text) throw new Error("Claude trả về nội dung rỗng");
  return text;
};

// Doc file PDF truc tiep. Claude nhan PDF nguyen ban nen khong can thu vien boc
// tach chu o giua - nho vay giu duoc bo cuc, bang bieu va thu tu muc cua CV.
export const askAboutPdf = async ({
  system,
  prompt,
  base64Pdf,
  schema,
  effort = "medium",
  maxTokens = 8000,
}) => {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category || "không rõ";
    throw new Error(`Claude từ chối xử lý CV này (nhóm: ${category})`);
  }

  const text = extractText(response);
  if (!text) throw new Error("Claude trả về nội dung rỗng");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Không đọc được JSON từ kết quả của Claude");
  }
};

export const logModel = () =>
  logger.info("AI Worker dung model", { model: MODEL });
