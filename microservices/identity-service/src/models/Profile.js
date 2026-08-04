import mongoose from 'mongoose';

// Ho so ung vien va CV Builder luu o MongoDB thay vi MySQL.
//
// Ly do: moi CV mot khac - nguoi co 5 muc kinh nghiem, nguoi co 1; nguoi them
// muc "du an", nguoi them "chung chi". Nhet cai do vao bang quan he se thanh
// mot dong bang phu va rat nhieu JOIN. Duoi dang tai lieu JSON thi ca CV la mot
// ban ghi, doc mot phat la du.

const experienceSchema = new mongoose.Schema({
    company: String,
    position: String,
    from: String,
    to: String,
    description: String
}, { _id: false });

const educationSchema = new mongoose.Schema({
    school: String,
    major: String,
    degree: String,
    year: String
}, { _id: false });

const cvSchema = new mongoose.Schema({
    title: { type: String, default: 'CV chưa đặt tên' },
    template: { type: String, default: 'basic' },
    fullName: String,
    email: String,
    phone: String,
    address: String,
    summary: String,
    skills: [String],
    languages: [String],
    experiences: [experienceSchema],
    educations: [educationSchema],
    // Ket qua boc tach tu AI Resume Parser duoc giu nguyen o day de doi chieu
    // khi ung vien sua tay.
    parsedFrom: {
        fileName: String,
        parsedAt: Date,
        raw: mongoose.Schema.Types.Mixed
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const profileSchema = new mongoose.Schema({
    // Tro nguoc ve tai khoan trong MySQL cua he thong cu. Mot khoa ngoai qua
    // ranh gioi service phai la gia tri sao chep, khong phai rang buoc CSDL.
    legacyUserId: { type: Number, index: true, unique: true, sparse: true },

    phonenumber: { type: String, index: true },
    email: String,
    firstName: String,
    lastName: String,
    roleCode: { type: String, default: 'CANDIDATE' },
    companyId: { type: Number, default: null },

    headline: String,
    about: String,
    skills: [String],
    // Cai dat tim viec: dung cho tinh nang goi y viec lam qua email.
    jobPreference: {
        categoryJobCode: String,
        addressCode: String,
        salaryJobCode: String,
        experienceJobCode: String,
        isFindJob: { type: Boolean, default: false },
        isTakeMail: { type: Boolean, default: false }
    },

    cvs: [cvSchema],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

profileSchema.pre('save', function preSave(next) {
    this.updatedAt = new Date();
    next();
});

export const Profile = mongoose.model('Profile', profileSchema);
