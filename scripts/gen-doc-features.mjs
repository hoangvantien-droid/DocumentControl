import {
  Document, Packer, Paragraph, R, P, H1, H2, LI, TABLE, COVER, PageBreak,
  numbering, styles, pageMargin, writeFileSync, MUTED,
} from "./gen-uat-docs.mjs";

const children = [];
const add = (...x) => children.push(...x);

add(...COVER("Mo ta Phan quyen & Tinh nang", "Tai lieu tom tat - ban dung noi bo"));
add(new Paragraph({ spacing: { before: 200 }, children: [R("Phien ban mo hinh: ban hanh thang theo site (receipt). Cap nhat theo code hien tai.", { italics: true, color: MUTED, size: 20 })] }));
add(new Paragraph({ children: [new PageBreak()] }));

// 1. Tong quan
add(H1("1. DCS la gi"));
add(P("DCS quan ly vong doi tai lieu va phan phoi co kiem soat toi cac nha may/site. Nguoi bien soan ban hanh tai lieu thang toi cac site; moi site xac nhan tiep nhan hoac tu choi khi phat hien sai sot. He thong luu ghi vet khong sua, ho tro tim kiem toan van, in ban sao co kiem soat gan ma QR, va xem xet dinh ky."));

// 2. Bon vai tro
add(H1("2. Bon vai tro & pham vi quyen"));
add(P("He thong co 4 vai. Admin dung NGOAI luong tai lieu (chi quan tri + du lieu goc); ba vai con lai tham gia luong nghiep vu."));
add(TABLE(
  ["Vai tro", "Lam duoc gi", "Pham vi"],
  [
    ["Quan tri he thong\n(DC_ADMIN)", "Quan ly to chuc (BU/Site/Phong ban), nguoi dung, vai tro; xem ghi vet. Khong dang ky/duyet tai lieu.", "Toan he thong (quan tri)"],
    ["Bien soan tai lieu\n(DC_AUTHOR)", "Dang ky & ban hanh tai lieu; sua/thu hoi/xoa ban cua minh theo dieu kien; ket luan xem xet dinh ky (bo phan so huu); tao goi ban hanh.", "Tai lieu minh dang ky"],
    ["Kiem soat tai lieu site\n(DC_SITE_DOC_CONTROL)", "Xac nhan tiep nhan / tu choi tai lieu toi site minh phu trach; tham dinh bao bat thuong cua nguoi doc.", "Theo site duoc gan"],
    ["Nguoi doc\n(DC_READER)", "Tra cuu & doc tai lieu hien hanh trong pham vi; bao bat thuong; xac nhan da doc.", "Chi-xem theo pham vi"],
  ],
  [22, 56, 22],
));
add(new Paragraph({ spacing: { before: 100 }, children: [R("Menu an han muc khong co quyen; chan ca o route (go URL truc tiep van bi tu choi).", { italics: true, color: MUTED, size: 20 })] }));

// 3. Tinh nang chinh
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("3. Tinh nang chinh theo vai"));

add(H2("Bien soan (Author)"));
[
  "Dang ky tai lieu: tai len PDF, khai so hieu/loai/pham vi/ngay hieu luc, chon site nhan -> ban hanh thang (trang thai Da ban hanh).",
  "Tai lieu cua toi: danh sach tai lieu minh dang ky kem trang thai tong hop tiep nhan theo site.",
  "Tinh trang ban hanh: ma tran phan hoi tung site (cho/chap nhan/tu choi); sua metadata, thu hoi, xoa theo dieu kien.",
  "Xem xet dinh ky: ket luan Giu nguyen / Can sua / Huy bo cho tai lieu bo phan minh so huu.",
  "Goi ban hanh: gom nhieu tai lieu ban hanh dong loat.",
].forEach(t => add(LI(t)));

add(H2("Kiem soat tai lieu site (DC Site)"));
[
  "Cho site phan hoi: hang cho cac tai lieu ban hanh toi site minh; xem PDF inline roi Xac nhan tiep nhan hoac Tu choi (chon loai sai sot + ly do).",
  "Bao bat thuong (site): tham dinh report cua nguoi doc -> chuyen thanh tu choi receipt hoac bac bo.",
].forEach(t => add(LI(t)));

add(H2("Nguoi doc (Reader)"));
[
  "Danh muc & tim kiem: tra cuu tai lieu hien hanh theo pham vi; loc da chieu (loai, nguon, pham vi, BU/Site/Phong ban, ngay hieu luc, cap khop).",
  "Xem chi tiet: PDF hien thi truc tiep trong trang; xac nhan da doc; bao bat thuong neu phat hien sai.",
].forEach(t => add(LI(t)));

add(H2("Dung chung"));
[
  "Tim kiem toan van (chay doc lap voi lop AI); goi y nhanh tren thanh dieu huong.",
  "In ban sao co kiem soat: gan ma QR theo site de tra cuu nguon goc; thu hoi ban in.",
  "Ghi vet (append-only): ai lam gi, khi nao - khong sua, khong xoa.",
].forEach(t => add(LI(t)));

// 4. Vong doi
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("4. Vong doi tai lieu & trang thai"));
add(TABLE(
  ["Trang thai", "Y nghia"],
  [
    ["Cho hoan thien", "Ban nhap, chua ban hanh."],
    ["Da ban hanh", "Dang hien hanh; da gui toi site de tiep nhan."],
    ["Da thu hoi", "Author thu hoi - khong con hieu luc."],
    ["Het hieu luc", "Bi phien ban moi thay the."],
  ],
  [30, 70],
));
add(H2("Trang thai tiep nhan theo tung site (receipt)"));
add(TABLE(
  ["Receipt", "Y nghia"],
  [
    ["Cho phan hoi", "Site chua phan hoi."],
    ["Da chap nhan", "Site tiep nhan, ghi ngay ap dung."],
    ["Da tu choi", "Site tra lai: Sai thong tin dang ky hoac Sai noi dung tai lieu (kem ly do)."],
  ],
  [30, 70],
));
add(H2("Trang thai tong hop (suy tu cac receipt)"));
add(P("Chua phat hanh -> Dang cho -> Mot phan (co site chap nhan) -> Toan bo (tat ca chap nhan). Co bat ky tu choi nao -> Tranh chap (uu tien canh bao de Author xu ly)."));

const doc = new Document({ styles, numbering, sections: [{ properties: { page: pageMargin }, children }] });
const buf = await Packer.toBuffer(doc);
writeFileSync("docs/uat/DCS-MoTa-PhanQuyen-TinhNang.docx", buf);
console.log("WROTE docs/uat/DCS-MoTa-PhanQuyen-TinhNang.docx");
