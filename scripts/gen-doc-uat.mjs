import {
  Document, Packer, Paragraph, R, P, H1, H2, LI, TABLE, COVER, PageBreak,
  numbering, styles, pageMargin, writeFileSync, MUTED, OK,
} from "./gen-uat-docs.mjs";

const children = [];
const add = (...x) => children.push(...x);

add(...COVER("Kich ban UAT", "Quy trinh Ban hanh - Tu choi - Soat xet"));
add(new Paragraph({ spacing: { before: 200 }, children: [R("Pham vi: kiem thu chap nhan nguoi dung cho luong tai lieu chinh. Thuc hien tren moi truong UAT sau khi migrate + seed.", { italics: true, color: MUTED, size: 20 })] }));
add(new Paragraph({ children: [new PageBreak()] }));

// Chuan bi
add(H1("A. Chuan bi & tai khoan"));
add(P("Truoc khi test: pull code moi, npm run build, npm run migrate, seed du lieu UAT, restart dich vu. Can it nhat 2 site de kiem lech pha tiep nhan."));
add(TABLE(
  ["Tai khoan", "Vai tro", "Dung cho"],
  [
    ["author@mml.io", "Bien soan", "Dang ky, ban hanh, sua/thu hoi/xoa, xem xet"],
    ["dc_mml@mml.io", "Kiem soat tai lieu site MML", "Tiep nhan / tu choi receipt site MML"],
    ["dc_hcm@mml.io", "Kiem soat tai lieu site HCM", "Tiep nhan / tu choi receipt site HCM"],
    ["reader@mml.io", "Nguoi doc", "Tra cuu, bao bat thuong, xac nhan doc"],
    ["admin@mml.io", "Quan tri", "Kiem chan route ngoai luong"],
  ],
  [30, 30, 40],
));
add(new Paragraph({ spacing: { before: 80 }, children: [R("Mat khau seed theo tai lieu trien khai. Ket qua moi buoc: ghi Dat / Khong dat + ghi chu.", { italics: true, color: MUTED, size: 20 })] }));

// Case builder
function caseBlock(id, title, pre, steps, expected) {
  add(H2(id + ". " + title));
  if (pre) add(P([R("Dieu kien: ", { bold: true }), R(pre)]));
  add(P([R("Cac buoc:", { bold: true })]));
  steps.forEach((s, i) => add(LI(s)));
  add(TABLE(["Ket qua mong doi", "Dat / Khong dat"], expected.map(e => [e, ""]), [78, 22]));
}

// B. Ban hanh
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("B. Quy trinh ban hanh"));

caseBlock("UAT-01", "Ban hanh tai lieu toi nhieu site",
  "Dang nhap author@mml.io. Co san site MML va HCM.",
  [
    "Mo Danh muc -> bam 'Dang ky tai lieu'.",
    "Tai len mot tep PDF; khai so hieu, loai, tieu de, pham vi, ngay hieu luc.",
    "Chon ca hai site MML va HCM lam site nhan.",
    "Bam nut dang ky (ban hanh).",
  ],
  [
    "Chuyen ve 'Tai lieu cua toi'; tai lieu trang thai 'Da ban hanh'.",
    "Moi site (MML, HCM) sinh mot receipt 'Cho phan hoi'.",
    "Trang thai tong hop hien 'Dang cho'.",
    "DC Site MML va HCM thay tai lieu trong hang cho cua minh.",
  ]);

caseBlock("UAT-02", "Khong chon site thi bao loi",
  "Dang nhap author@mml.io.",
  [
    "Mo form dang ky, dien du thong tin + tai PDF.",
    "KHONG tick site nhan nao.",
    "Bam dang ky.",
  ],
  [
    "He thong chan, bao phai chon it nhat mot site nhan.",
    "Khong tao tai lieu/receipt nao.",
  ]);

caseBlock("UAT-03", "Luu nhap roi hoan thien sau",
  "Dang nhap author@mml.io.",
  [
    "Mo form dang ky, dien mot phan thong tin.",
    "Bam 'Luu nhap'.",
    "Vao 'Tai lieu cua toi', mo lai ban nhap bang 'Sua nhap'.",
  ],
  [
    "Ban nhap luu voi trang thai 'Cho hoan thien'.",
    "Mo lai dien tiep duoc; chi khi ban hanh that moi validate day du.",
  ]);

// C. Tiep nhan / tu choi
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("C. Quy trinh tiep nhan & tu choi (DC Site)"));

caseBlock("UAT-04", "Site xac nhan tiep nhan",
  "Da co UAT-01. Dang nhap dc_mml@mml.io.",
  [
    "Mo 'Cho site phan hoi' -> chon tai lieu vua ban hanh.",
    "Doc noi dung PDF hien thi truc tiep trong trang.",
    "Bam 'Xac nhan tiep nhan'.",
  ],
  [
    "Receipt site MML chuyen 'Da chap nhan', ghi ngay ap dung.",
    "Ve lai hang cho; tai lieu da xu ly khong con trong hang cho MML.",
    "Ben Author: trang thai tong hop chuyen 'Mot phan' (MML xong, HCM con cho).",
  ]);

caseBlock("UAT-05", "Site tu choi - chon loai sai sot",
  "Con receipt 'Cho phan hoi' cua HCM (tu UAT-01). Dang nhap dc_hcm@mml.io.",
  [
    "Mo 'Cho site phan hoi' -> chon tai lieu.",
    "Trong o ben phai, chon 'Loai sai sot' (Sai thong tin dang ky HOAC Sai noi dung tai lieu).",
    "Nhap 'Mo ta sai sot' (bat buoc).",
    "Bam nut 'Tu choi tiep nhan'.",
  ],
  [
    "Nut 'Tu choi tiep nhan' hien ro o cuoi khung, ngay duoi o mo ta.",
    "Neu bo trong mo ta -> bi chan, bao phai nhap ly do.",
    "Receipt HCM chuyen 'Da tu choi' kem loai + ly do.",
    "Trang thai tong hop chuyen 'Tranh chap'; Author thay canh bao.",
    "Site khac mo cung phien ban thay canh bao 'co site bao sai ...'.",
  ]);

caseBlock("UAT-06", "Canh bao khi tu phan hoi tai lieu cua minh",
  "Author dong thoi co vai DC Site (hiem). Dang nhap tai khoan do.",
  [
    "Mo phan hoi mot receipt cua tai lieu CHINH MINH dang ky.",
  ],
  [
    "Hien canh bao tach vai o dau trang.",
    "Van cho phan hoi nhung ghi vet dam trong nhat ky.",
  ]);

caseBlock("UAT-07", "Nguoi doc bao bat thuong -> DC Site tham dinh",
  "Reader co pham vi thay tai lieu. Dang nhap reader@mml.io.",
  [
    "Mo chi tiet mot tai lieu hien hanh -> bam 'Bao bat thuong', nhap mo ta, gui.",
    "Dang nhap DC Site phu trach -> mo 'Bao bat thuong (site)'.",
    "Chon mot report: Chuyen thanh tu choi (chon loai + ly do) HOAC Bac bo.",
  ],
  [
    "Report cua Reader vao hop 'Bao bat thuong (site)'.",
    "Chuyen -> sinh tu choi receipt tuong ung; Bac bo -> dong report kem ghi chu.",
  ]);

// D. Author xu ly sau tu choi
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("D. Author xu ly sau phan hoi"));

caseBlock("UAT-08", "Sua metadata khi chua ai chap nhan",
  "Tai lieu CHUA co site nao chap nhan. Dang nhap author@mml.io.",
  [
    "Vao 'Tai lieu cua toi' -> 'Tinh trang ban hanh' cua tai lieu.",
    "Bam sua metadata; doi tieu de / ngay / bo phan so huu; luu.",
  ],
  [
    "Sua duoc (so hieu va tep bi khoa).",
    "Neu DA co site chap nhan -> bi khoa, bao phai ra phien ban moi.",
  ]);

caseBlock("UAT-09", "Thu hoi tai lieu",
  "Tai lieu chua ai chap nhan HOAC co it nhat mot tu choi. Dang nhap author@mml.io.",
  [
    "Vao 'Tinh trang ban hanh' -> bam thu hoi.",
    "Nhap ly do (bat buoc) -> xac nhan.",
  ],
  [
    "Tai lieu chuyen 'Da thu hoi'.",
    "Neu da co site chap nhan va KHONG co tu choi -> khong thuoc dien tu thu hoi (bi chan).",
  ]);

caseBlock("UAT-10", "Xoa ban chua ai chap nhan",
  "Tai lieu chua co chap nhan nao. Dang nhap author@mml.io.",
  [
    "Vao 'Tinh trang ban hanh' -> bam xoa.",
  ],
  [
    "Xoa duoc khi chua co chap nhan nao.",
    "Neu da co chap nhan -> khong xoa duoc, phai thu hoi.",
  ]);

// E. Soat xet
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("E. Xem xet dinh ky (soat xet)"));

caseBlock("UAT-11", "Ket luan xem xet dinh ky",
  "Co tai lieu toi han xem xet thuoc bo phan Author so huu. Dang nhap author@mml.io.",
  [
    "Mo 'Xem xet dinh ky'.",
    "Chon mot tai lieu dang xem xet, ghi ket luan: Giu nguyen / Can sua / Huy bo.",
    "Voi Can sua / Huy bo: nhap giai trinh (bat buoc).",
  ],
  [
    "Giu nguyen -> dat lai dong ho chu ky, dong ban ghi.",
    "Can sua -> treo cho ban moi (tu dong dong khi ban moi hieu luc).",
    "Huy bo -> dong ban ghi.",
    "Nguoi NGOAI bo phan so huu -> khong ket luan duoc (403).",
  ]);

caseBlock("UAT-12", "Phan quyen menu & route (phong thu)",
  "Lan luot dang nhap tung vai.",
  [
    "Admin: go thang URL /documents va /reviews.",
    "DC Site: go thang URL /packages.",
    "Reader: kiem menu chi co Trang chu + Danh muc.",
  ],
  [
    "Admin bi tu choi (403) o trang nghiep vu; chi thay khu Quan tri + Ghi vet.",
    "DC Site bi tu choi (403) o /packages.",
    "Menu an han muc khong co quyen cho moi vai.",
  ]);

const doc = new Document({ styles, numbering, sections: [{ properties: { page: pageMargin }, children }] });
const buf = await Packer.toBuffer(doc);
writeFileSync("docs/uat/DCS-UAT-BanHanh-TuChoi-SoatXet.docx", buf);
console.log("WROTE docs/uat/DCS-UAT-BanHanh-TuChoi-SoatXet.docx");
