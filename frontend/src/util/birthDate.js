import moment from "moment";

// Ngay sinh trong CSDL co ba dang: mili-giay (co the am neu truoc 1970), "YYYY-MM-DD" va "DD/MM/YYYY", hoac rong.
const BIRTH_FORMATS = [[/^-?\d+$/, value => moment(Number(value))], [/^\d{4}-\d{2}-\d{2}/, value => moment(value, "YYYY-MM-DD")],
    [/^\d{2}\/\d{2}\/\d{4}$/, value => moment(value, "DD/MM/YYYY", true)]];

const parseBirthMoment = (dob) => {
    const text = String(dob ?? "").trim();
    const parse = BIRTH_FORMATS.find(([pattern]) => pattern.test(text))?.[1];
    const date = parse ? parse(text) : null;
    return date && date.isValid() ? date : null;
};

// react-datepicker nem RangeError khi `selected` la Invalid Date, nen khong doc duoc thi tra ve null.
export const parseBirthDate = (dob) => parseBirthMoment(dob)?.toDate() ?? null;

export const formatBirthDate = (dob, fallback = "Không có thông tin") =>
    parseBirthMoment(dob)?.format("DD/MM/YYYY") ?? fallback;

// Ngay da xoa tren DatePicker luu thanh null, khong phai 0 (01/01/1970).
export const birthDateValue = (date) => (date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null);
