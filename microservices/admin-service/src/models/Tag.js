import mongoose from 'mongoose';

// Lop phan loai bo sung cho master data.
//
// Bang `allcodes` trong MySQL KHONG duoc chuyen sang day: cot `code` cua no dang
// bi khoa ngoai tu `posts` va `detailposts` tham chieu toi, bê di la backend cu
// gay lap tuc. Thay vao do, service nay giu mot lop phu ben tren: nhom danh muc
// lai voi nhau, va khai bao tu dong nghia de tim kiem khon hon.
//
// Vi du thuc te: nguoi dung go "IT" hoac "cong nghe thong tin" hoac "lap trinh"
// deu phai ra cung mot nhom viec. `allcodes` khong cho cho thu do.

const tagSchema = new mongoose.Schema({
    // Ma trong allcodes ma tag nay bo nghia them (neu co).
    code: { type: String, index: true },
    // Loai master data: JOBTYPE, PROVINCE, SALARYTYPE, SKILL...
    type: { type: String, required: true, index: true },

    name: { type: String, required: true },
    slug: { type: String, index: true },

    // Tu dong nghia. Search Service co the doc de mo rong truy van.
    aliases: { type: [String], default: [] },

    // Gom nhieu danh muc nho vao mot nhom lon: "Kinh doanh" gom ban hang,
    // marketing, cham soc khach hang.
    group: { type: String, index: true },

    // Do noi bat khi hien danh muc tren trang chu.
    weight: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    description: String,
    createdBy: Number,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Mot ma chi co mot tag trong cung mot loai.
tagSchema.index({ type: 1, code: 1 }, { unique: true, sparse: true });

tagSchema.pre('save', function preSave(next) {
    this.updatedAt = new Date();
    next();
});

export const Tag = mongoose.model('Tag', tagSchema);
