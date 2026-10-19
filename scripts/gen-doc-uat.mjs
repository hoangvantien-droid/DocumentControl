import {
  Document, Packer, Paragraph, R, P, H1, H2, LI, TABLE, COVER, PageBreak,
  numbering, styles, pageMargin, writeFileSync, MUTED,
} from "./gen-uat-docs.mjs";

const children = [];
const add = (...x) => children.push(...x);

add(...COVER("Kịch bản UAT", "Quy trình Ban hành — Từ chối — Soát xét"));
add(new Paragraph({ spacing: { before: 200 }, children: [R("Phạm vi: kiểm thử chấp nhận người dùng cho luồng tài liệu chính. Thực hiện trên môi trường UAT sau khi migrate + seed.", { italics: true, color: MUTED, size: 20 })] }));
add(new Paragraph({ children: [new PageBreak()] }));

add(H1("A. Chuẩn bị & tài khoản"));
add(P("Trước khi test: pull code mới, npm run build, npm run migrate, seed dữ liệu UAT, restart dịch vụ. Cần ít nhất 2 site để kiểm lệch pha tiếp nhận."));
add(TABLE(
  ["Tài khoản", "Vai trò", "Dùng cho"],
  [
    ["author@mml.io", "Biên soạn", "Đăng ký, ban hành, sửa/thu hồi/xóa, xem xét"],
    ["dc_mml@mml.io", "Kiểm soát tài liệu site MML", "Tiếp nhận / từ chối receipt site MML"],
    ["dc_hcm@mml.io", "Kiểm soát tài liệu site HCM", "Tiếp nhận / từ chối receipt site HCM"],
    ["reader@mml.io", "Người đọc", "Tra cứu, báo bất thường, xác nhận đọc"],
    ["admin@mml.io", "Quản trị", "Kiểm chặn route ngoài luồng"],
  ],
  [30, 30, 40],
));
add(new Paragraph({ spacing: { before: 80 }, children: [R("Mật khẩu seed theo tài liệu triển khai. Kết quả mỗi bước: ghi Đạt / Không đạt + ghi chú.", { italics: true, color: MUTED, size: 20 })] }));

function caseBlock(id, title, pre, steps, expected) {
  add(H2(id + ". " + title));
  if (pre) add(P([R("Điều kiện: ", { bold: true }), R(pre)]));
  add(P([R("Các bước:", { bold: true })]));
  steps.forEach((s) => add(LI(s)));
  add(TABLE(["Kết quả mong đợi", "Đạt / Không đạt"], expected.map(e => [e, ""]), [78, 22]));
}

add(new Paragraph({ children: [new PageBreak()] }));
add(H1("B. Quy trình ban hành"));

caseBlock("UAT-01", "Ban hành tài liệu tới nhiều site",
  "Đăng nhập author@mml.io. Có sẵn site MML và HCM.",
  [
    "Mở Danh mục → bấm 'Đăng ký tài liệu'.",
    "Tải lên một tệp PDF; khai số hiệu, loại, tiêu đề, phạm vi, ngày hiệu lực.",
    "Chọn cả hai site MML và HCM làm site nhận.",
    "Bấm nút đăng ký (ban hành).",
  ],
  [
    "Chuyển về 'Tài liệu của tôi'; tài liệu trạng thái 'Đã ban hành'.",
    "Mỗi site (MML, HCM) sinh một receipt 'Chờ phản hồi'.",
    "Trạng thái tổng hợp hiển thị 'Đang chờ'.",
    "DC Site MML và HCM thấy tài liệu trong hàng chờ của mình.",
  ]);

caseBlock("UAT-02", "Không chọn site thì báo lỗi",
  "Đăng nhập author@mml.io.",
  [
    "Mở form đăng ký, điền đủ thông tin + tải PDF.",
    "KHÔNG tick site nhận nào.",
    "Bấm đăng ký.",
  ],
  [
    "Hệ thống chặn, báo phải chọn ít nhất một site nhận.",
    "Không tạo tài liệu/receipt nào.",
  ]);

caseBlock("UAT-03", "Lưu nháp rồi hoàn thiện sau",
  "Đăng nhập author@mml.io.",
  [
    "Mở form đăng ký, điền một phần thông tin.",
    "Bấm 'Lưu nháp'.",
    "Vào 'Tài liệu của tôi', mở lại bản nháp bằng 'Sửa nháp'.",
  ],
  [
    "Bản nháp lưu với trạng thái 'Chờ hoàn thiện'.",
    "Mở lại điền tiếp được; chỉ khi ban hành thật mới validate đầy đủ.",
  ]);

add(new Paragraph({ children: [new PageBreak()] }));
add(H1("C. Quy trình tiếp nhận & từ chối (DC Site)"));

caseBlock("UAT-04", "Site xác nhận tiếp nhận",
  "Đã có UAT-01. Đăng nhập dc_mml@mml.io.",
  [
    "Mở 'Chờ site phản hồi' → chọn tài liệu vừa ban hành.",
    "Đọc nội dung PDF hiển thị trực tiếp trong trang.",
    "Bấm 'Xác nhận tiếp nhận'.",
  ],
  [
    "Receipt site MML chuyển 'Đã chấp nhận', ghi ngày áp dụng.",
    "Về lại hàng chờ; tài liệu đã xử lý không còn trong hàng chờ MML.",
    "Bên Author: trạng thái tổng hợp chuyển 'Một phần' (MML xong, HCM còn chờ).",
  ]);

caseBlock("UAT-05", "Site từ chối — chọn loại sai sót",
  "Còn receipt 'Chờ phản hồi' của HCM (từ UAT-01). Đăng nhập dc_hcm@mml.io.",
  [
    "Mở 'Chờ site phản hồi' → chọn tài liệu.",
    "Trong khung bên phải, chọn 'Loại sai sót' (Sai thông tin đăng ký HOẶC Sai nội dung tài liệu).",
    "Nhập 'Mô tả sai sót' (bắt buộc).",
    "Bấm nút 'Từ chối tiếp nhận'.",
  ],
  [
    "Nút 'Từ chối tiếp nhận' hiện rõ ở cuối khung, ngay dưới ô mô tả.",
    "Nếu bỏ trống mô tả → bị chặn, báo phải nhập lý do.",
    "Receipt HCM chuyển 'Đã từ chối' kèm loại + lý do.",
    "Trạng thái tổng hợp chuyển 'Tranh chấp'; Author thấy cảnh báo.",
    "Site khác mở cùng phiên bản thấy cảnh báo 'có site báo sai ...'.",
  ]);

caseBlock("UAT-06", "Cảnh báo khi tự phản hồi tài liệu của mình",
  "Author đồng thời có vai DC Site (hiếm). Đăng nhập tài khoản đó.",
  [
    "Mở phản hồi một receipt của tài liệu CHÍNH MÌNH đăng ký.",
  ],
  [
    "Hiện cảnh báo tách vai ở đầu trang.",
    "Vẫn cho phản hồi nhưng ghi vết đậm trong nhật ký.",
  ]);

caseBlock("UAT-07", "Người đọc báo bất thường → DC Site thẩm định",
  "Reader có phạm vi thấy tài liệu. Đăng nhập reader@mml.io.",
  [
    "Mở chi tiết một tài liệu hiện hành → bấm 'Báo bất thường', nhập mô tả, gửi.",
    "Đăng nhập DC Site phụ trách → mở 'Báo bất thường (site)'.",
    "Chọn một report: Chuyển thành từ chối (chọn loại + lý do) HOẶC Bác bỏ.",
  ],
  [
    "Report của Reader vào hộp 'Báo bất thường (site)'.",
    "Chuyển → sinh từ chối receipt tương ứng; Bác bỏ → đóng report kèm ghi chú.",
  ]);

add(new Paragraph({ children: [new PageBreak()] }));
add(H1("D. Author xử lý sau phản hồi"));

caseBlock("UAT-08", "Sửa metadata khi chưa ai chấp nhận",
  "Tài liệu CHƯA có site nào chấp nhận. Đăng nhập author@mml.io.",
  [
    "Vào 'Tài liệu của tôi' → 'Tình trạng ban hành' của tài liệu.",
    "Bấm sửa metadata; đổi tiêu đề / ngày / bộ phận sở hữu; lưu.",
  ],
  [
    "Sửa được (số hiệu và tệp bị khóa).",
    "Nếu ĐÃ có site chấp nhận → bị khóa, báo phải ra phiên bản mới.",
  ]);

caseBlock("UAT-09", "Thu hồi tài liệu",
  "Tài liệu chưa ai chấp nhận HOẶC có ít nhất một từ chối. Đăng nhập author@mml.io.",
  [
    "Vào 'Tình trạng ban hành' → bấm thu hồi.",
    "Nhập lý do (bắt buộc) → xác nhận.",
  ],
  [
    "Tài liệu chuyển 'Đã thu hồi'.",
    "Nếu đã có site chấp nhận và KHÔNG có từ chối → không thuộc diện tự thu hồi (bị chặn).",
  ]);

caseBlock("UAT-10", "Xóa bản chưa ai chấp nhận",
  "Tài liệu chưa có chấp nhận nào. Đăng nhập author@mml.io.",
  [
    "Vào 'Tình trạng ban hành' → bấm xóa.",
  ],
  [
    "Xóa được khi chưa có chấp nhận nào.",
    "Nếu đã có chấp nhận → không xóa được, phải thu hồi.",
  ]);

add(new Paragraph({ children: [new PageBreak()] }));
add(H1("E. Xem xét định kỳ (soát xét)"));

caseBlock("UAT-11", "Kết luận xem xét định kỳ",
  "Có tài liệu tới hạn xem xét thuộc bộ phận Author sở hữu. Đăng nhập author@mml.io.",
  [
    "Mở 'Xem xét định kỳ'.",
    "Chọn một tài liệu đang xem xét, ghi kết luận: Giữ nguyên / Cần sửa / Hủy bỏ.",
    "Với Cần sửa / Hủy bỏ: nhập giải trình (bắt buộc).",
  ],
  [
    "Giữ nguyên → đặt lại đồng hồ chu kỳ, đóng bản ghi.",
    "Cần sửa → treo chờ bản mới (tự động đóng khi bản mới hiệu lực).",
    "Hủy bỏ → đóng bản ghi.",
    "Người NGOÀI bộ phận sở hữu → không kết luận được (403).",
  ]);

caseBlock("UAT-12", "Phân quyền menu & route (phòng thủ)",
  "Lần lượt đăng nhập từng vai.",
  [
    "Admin: gõ thẳng URL /documents và /reviews.",
    "DC Site: gõ thẳng URL /packages.",
    "Reader: kiểm menu chỉ có Trang chủ + Danh mục.",
  ],
  [
    "Admin bị từ chối (403) ở trang nghiệp vụ; chỉ thấy khu Quản trị + Ghi vết.",
    "DC Site bị từ chối (403) ở /packages.",
    "Menu ẩn hẳn mục không có quyền cho mọi vai.",
  ]);

const doc = new Document({ styles, numbering, sections: [{ properties: { page: pageMargin }, children }] });
const buf = await Packer.toBuffer(doc);
writeFileSync("docs/uat/DCS-UAT-BanHanh-TuChoi-SoatXet.docx", buf);
console.log("WROTE uat doc");
