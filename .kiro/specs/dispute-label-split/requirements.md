# Requirements Document

## Introduction

Trạng thái tổng hợp `tranh_chap` (hàm `aggregateStatusOf` suy từ receipt) được
dùng chung cho MỌI trường hợp có từ chối — bất kể loại. Nhưng hai loại từ chối có
bản chất và cách xử lý khác hẳn:
- "sai đăng ký" (`sai_dang_ky`): chỉ sai metadata → Author sửa rồi phát hành lại.
- "sai nội dung" (`sai_noi_dung`): nghi sai nội dung → phải thu hồi + ban hành bản mới.

Gộp cả hai thành một nhãn làm mất thông tin Author cần để biết phải làm gì, và
nhãn "có site báo sai sót" nghe nặng như nhau cho cả trường hợp chỉ sai một cái
ngày/số hiệu.

Hướng (đã chốt — phương án a): TÁCH Ở TẦNG NHÃN/MÀU HIỂN THỊ, GIỮ NGUYÊN enum
`AggregateStatus` và hàm `aggregateStatusOf` (nguồn sự thật cho logic/luồng).
Chỉ khi `aggregate === 'tranh_chap'` thì hiển thị phân nhánh theo dữ liệu đã có
(`hasContentReject` / `hasMetaReject`).

Phạm vi hiển thị: hai nơi render trạng thái tổng hợp:
- `src/views/issuance-status.eta` (trang Tình trạng ban hành của Author).
- `src/views/my-documents.eta` (danh sách Tài liệu của tôi).

Không đổi: enum, `aggregateStatusOf`, logic chặn/luồng, schema, quyền.

## Requirements

### Requirement 1: Phân biệt nhãn khi tranh chấp

**User Story:** Là Author, khi tài liệu có từ chối, tôi muốn nhãn trạng thái nói
rõ là "sai nội dung" (nặng) hay "sai đăng ký" (nhẹ), để biết ngay phải thu hồi
hay chỉ cần sửa.

#### Acceptance Criteria
1. WHEN trạng thái tổng hợp là `tranh_chap` AND có ít nhất một receipt từ chối
   loại `sai_noi_dung` THEN hệ thống SHALL hiển thị nhãn thể hiện "sai nội dung"
   (ví dụ "Có site báo sai nội dung") với màu mức lỗi nặng (đỏ).
2. WHEN trạng thái tổng hợp là `tranh_chap` AND chỉ có từ chối loại `sai_dang_ky`
   (KHÔNG có `sai_noi_dung`) THEN hệ thống SHALL hiển thị nhãn thể hiện "sai đăng
   ký / cần sửa" với màu mức cảnh báo nhẹ (amber/vàng).
3. WHERE ưu tiên: nếu có cả hai loại từ chối THE system SHALL ưu tiên nhãn "sai
   nội dung" (nặng hơn).
4. The system SHALL áp quy tắc nhãn này nhất quán ở cả `issuance-status.eta` và
   `my-documents.eta`.

### Requirement 2: Giữ nguyên các trạng thái khác

**User Story:** Là người dùng, tôi muốn các nhãn trạng thái khác không đổi để
tránh xáo trộn.

#### Acceptance Criteria
1. The system SHALL giữ nguyên nhãn + màu cho `chua_phat_hanh`, `dang_cho`,
   `mot_phan`, `toan_bo`.
2. The system SHALL chỉ thay đổi cách hiển thị khi `aggregate === 'tranh_chap'`.

### Requirement 3: Không đổi mô hình dữ liệu / logic

**User Story:** Là người bảo trì, tôi muốn thay đổi chỉ ở tầng hiển thị để an
toàn.

#### Acceptance Criteria
1. The system SHALL NOT thêm/đổi giá trị enum `AggregateStatus`.
2. The system SHALL NOT đổi hàm `aggregateStatusOf` (vẫn trả `tranh_chap`).
3. The system SHALL NOT đổi logic chặn phát hành thêm, thu hồi, hay bất kỳ luồng
   nghiệp vụ nào.
4. The system SHALL NOT thêm migration / đổi schema / nới quyền.
5. The system SHALL dùng dữ liệu đã có (`hasContentReject`, `hasMetaReject` ở
   issuance; suy tương đương từ receipt ở my-documents) — không thêm truy vấn
   nặng.

### Requirement 4: Dữ liệu phân biệt sẵn có ở cả hai trang

**User Story:** Là người bảo trì, tôi muốn cả hai trang đều có đủ dữ liệu để
phân biệt loại từ chối mà không trùng lặp logic.

#### Acceptance Criteria
1. WHERE `issuance-status.eta` THE system SHALL dùng `hasContentReject` /
   `hasMetaReject` route đã truyền.
2. WHERE `my-documents.eta` THE system SHALL có cờ tương đương cho mỗi dòng (vd
   thêm `hasContentReject` theo từng version trong truy vấn danh sách đã có, hoặc
   suy từ số liệu receipt sẵn tính) — KHÔNG thêm vòng truy vấn cho mỗi dòng.
3. The system SHALL trình bày nhãn qua một điểm dùng chung nếu hợp lý (vd một
   helper nhãn nhận thêm cờ), tránh lặp chuỗi ở nhiều view.

## Glossary

- **Trạng thái tổng hợp (`AggregateStatus`):** suy từ tập receipt của một phiên
  bản: chua_phat_hanh | dang_cho | mot_phan | tranh_chap | toan_bo.
- **tranh_chap:** có ít nhất một receipt bị từ chối (bất kể loại).
- **sai đăng ký (`sai_dang_ky`):** từ chối do sai metadata; sửa là đủ.
- **sai nội dung (`sai_noi_dung`):** từ chối do nghi sai nội dung; phải thu hồi +
  bản mới.
