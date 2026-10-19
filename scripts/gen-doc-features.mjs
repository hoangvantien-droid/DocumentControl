import {
  Document, Packer, Paragraph, R, P, H1, H2, LI, TABLE, COVER, PageBreak,
  numbering, styles, pageMargin, writeFileSync, MUTED,
} from "./gen-uat-docs.mjs";

const children = [];
const add = (...x) => children.push(...x);

add(...COVER("Mô tả Phân quyền & Tính năng", "Tài liệu tóm tắt — bản dùng nội bộ"));
add(new Paragraph({ spacing: { before: 200 }, children: [R("Phiên bản mô hình: ban hành thẳng theo site (receipt). Cập nhật theo code hiện tại.", { italics: true, color: MUTED, size: 20 })] }));
add(new Paragraph({ children: [new PageBreak()] }));

add(H1("1. DCS là gì"));
add(P("DCS quản lý vòng đời tài liệu và phân phối có kiểm soát tới các nhà máy/site. Người biên soạn ban hành tài liệu thẳng tới các site; mỗi site xác nhận tiếp nhận hoặc từ chối khi phát hiện sai sót. Hệ thống lưu ghi vết không sửa, hỗ trợ tìm kiếm toàn văn, in bản sao có kiểm soát gắn mã QR, và xem xét định kỳ."));

add(H1("2. Bốn vai trò & phạm vi quyền"));
add(P("Hệ thống có 4 vai. Admin đứng NGOÀI luồng tài liệu (chỉ quản trị + dữ liệu gốc); ba vai còn lại tham gia luồng nghiệp vụ."));
add(TABLE(
  ["Vai trò", "Làm được gì", "Phạm vi"],
  [
    ["Quản trị hệ thống\n(DC_ADMIN)", "Quản lý tổ chức (BU/Site/Phòng ban), người dùng, vai trò; xem ghi vết. Không đăng ký/duyệt tài liệu.", "Toàn hệ thống (quản trị)"],
    ["Biên soạn tài liệu\n(DC_AUTHOR)", "Đăng ký & ban hành tài liệu; sửa/thu hồi/xóa bản của mình theo điều kiện; kết luận xem xét định kỳ (bộ phận sở hữu); tạo gói ban hành.", "Tài liệu mình đăng ký"],
    ["Kiểm soát tài liệu site\n(DC_SITE_DOC_CONTROL)", "Xác nhận tiếp nhận / từ chối tài liệu tới site mình phụ trách; thẩm định báo bất thường của người đọc.", "Theo site được gán"],
    ["Người đọc\n(DC_READER)", "Tra cứu & đọc tài liệu hiện hành trong phạm vi; báo bất thường; xác nhận đã đọc.", "Chỉ-xem theo phạm vi"],
  ],
  [22, 56, 22],
));
add(new Paragraph({ spacing: { before: 100 }, children: [R("Menu ẩn hẳn mục không có quyền; chặn cả ở route (gõ URL trực tiếp vẫn bị từ chối).", { italics: true, color: MUTED, size: 20 })] }));

add(new Paragraph({ children: [new PageBreak()] }));
add(H1("3. Tính năng chính theo vai"));

add(H2("Biên soạn (Author)"));
[
  "Đăng ký tài liệu: tải lên PDF, khai số hiệu/loại/phạm vi/ngày hiệu lực, chọn site nhận → ban hành thẳng (trạng thái Đã ban hành).",
  "Tài liệu của tôi: danh sách tài liệu mình đăng ký kèm trạng thái tổng hợp tiếp nhận theo site.",
  "Tình trạng ban hành: ma trận phản hồi từng site (chờ/chấp nhận/từ chối); sửa metadata, thu hồi, xóa theo điều kiện.",
  "Xem xét định kỳ: kết luận Giữ nguyên / Cần sửa / Hủy bỏ cho tài liệu bộ phận mình sở hữu.",
  "Gói ban hành: gom nhiều tài liệu ban hành đồng loạt.",
].forEach(t => add(LI(t)));

add(H2("Kiểm soát tài liệu site (DC Site)"));
[
  "Chờ site phản hồi: hàng chờ các tài liệu ban hành tới site mình; xem PDF trực tiếp trong trang rồi Xác nhận tiếp nhận hoặc Từ chối (chọn loại sai sót + lý do).",
  "Báo bất thường (site): thẩm định report của người đọc → chuyển thành từ chối receipt hoặc bác bỏ.",
].forEach(t => add(LI(t)));

add(H2("Người đọc (Reader)"));
[
  "Danh mục & tìm kiếm: tra cứu tài liệu hiện hành theo phạm vi; lọc đa chiều (loại, nguồn, phạm vi, BU/Site/Phòng ban, ngày hiệu lực, cấp khớp).",
  "Xem chi tiết: PDF hiển thị trực tiếp trong trang; xác nhận đã đọc; báo bất thường nếu phát hiện sai.",
].forEach(t => add(LI(t)));

add(H2("Dùng chung"));
[
  "Tìm kiếm toàn văn (chạy độc lập với lớp AI); gợi ý nhanh trên thanh điều hướng.",
  "In bản sao có kiểm soát: gắn mã QR theo site để tra cứu nguồn gốc; thu hồi bản in.",
  "Ghi vết (chỉ ghi thêm): ai làm gì, khi nào — không sửa, không xóa.",
].forEach(t => add(LI(t)));

add(new Paragraph({ children: [new PageBreak()] }));
add(H1("4. Vòng đời tài liệu & trạng thái"));
add(TABLE(
  ["Trạng thái", "Ý nghĩa"],
  [
    ["Chờ hoàn thiện", "Bản nháp, chưa ban hành."],
    ["Đã ban hành", "Đang hiện hành; đã gửi tới site để tiếp nhận."],
    ["Đã thu hồi", "Author thu hồi — không còn hiệu lực."],
    ["Hết hiệu lực", "Bị phiên bản mới thay thế."],
  ],
  [30, 70],
));
add(H2("Trạng thái tiếp nhận theo từng site (receipt)"));
add(TABLE(
  ["Receipt", "Ý nghĩa"],
  [
    ["Chờ phản hồi", "Site chưa phản hồi."],
    ["Đã chấp nhận", "Site tiếp nhận, ghi ngày áp dụng."],
    ["Đã từ chối", "Site trả lại: Sai thông tin đăng ký hoặc Sai nội dung tài liệu (kèm lý do)."],
  ],
  [30, 70],
));
add(H2("Trạng thái tổng hợp (suy từ các receipt)"));
add(P("Chưa phát hành → Đang chờ → Một phần (có site chấp nhận) → Toàn bộ (tất cả chấp nhận). Có bất kỳ từ chối nào → Tranh chấp (ưu tiên cảnh báo để Author xử lý)."));

const doc = new Document({ styles, numbering, sections: [{ properties: { page: pageMargin }, children }] });
const buf = await Packer.toBuffer(doc);
writeFileSync("docs/uat/DCS-MoTa-PhanQuyen-TinhNang.docx", buf);
console.log("WROTE features doc");
