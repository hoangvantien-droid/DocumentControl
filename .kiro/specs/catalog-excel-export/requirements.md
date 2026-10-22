# Requirements Document

## Introduction

Tính năng này bổ sung khả năng xuất Excel (.xlsx) cho ứng dụng DCS tại `d:\Kiro\dcs`, gồm ba năng lực: (1) nút "Xuất danh mục Excel" trên trang danh mục tài liệu `/documents` tôn trọng bộ lọc đang áp dụng và chỉ hiện với vai Biên soạn và Kiểm soát tài liệu site; (2) nút "Xuất Excel" trên trang "Tài liệu của tôi" `/my-documents` cho vai Biên soạn xuất danh sách tài liệu của chính mình; (3) hợp nhất nguồn danh sách loại tài liệu thành một hằng số dùng chung giữa biểu mẫu đăng ký và bộ lọc danh mục để hai nơi không bị lệch. Việc kiểm quyền và giới hạn phạm vi dữ liệu được thực thi ở phía máy chủ, không tin giao diện.

## Glossary

- **DCS**: Hệ thống kiểm soát tài liệu đang triển khai tại `d:\Kiro\dcs`.
- **Catalog_Export**: Chức năng xuất Excel danh mục tài liệu trên trang `/documents`.
- **MyDocs_Export**: Chức năng xuất Excel danh sách tài liệu của người biên soạn trên trang `/my-documents`.
- **DocType_Source**: Nguồn duy nhất (hằng số tầng domain) định nghĩa danh sách loại tài liệu hợp lệ.
- **Author**: Người dùng giữ vai `DC_AUTHOR` (được đăng ký tài liệu; xác định qua `canRegisterDocuments`).
- **SiteDocControl**: Người dùng giữ vai `DC_SITE_DOC_CONTROL` (Kiểm soát tài liệu site).
- **Admin**: Người dùng giữ vai `DC_ADMIN`.
- **Reader**: Người dùng chỉ-xem (không giữ `DC_AUTHOR`, `DC_SITE_DOC_CONTROL`, hay `DC_ADMIN`; xác định qua `isReadOnlyUser`).
- **Applied_Filters**: Tập tham số lọc đang áp dụng trên trang danh mục gồm `status`, `q`, `doc_type`, `origin`, `eff_from`, `eff_to`, `preset`, `site_id`, `rollout_status`, `sort`.
- **Visible_Scope**: Tập tài liệu người dùng được phép thấy theo `listVisibleDocuments` (phạm vi tổ chức, tài liệu mình nộp, tài liệu mình release, hoặc quyền Admin).
- **XLSX_File**: Tệp định dạng Office Open XML Spreadsheet (`.xlsx`) tạo bằng thư viện `exceljs`.
- **DocType_Values**: Năm giá trị loại tài liệu hợp lệ: `SOP`, `WI`, `Form`, `Policy`, `External`.

## Requirements

### Requirement 1: Xuất danh mục Excel (Catalog_Export)

**User Story:** Là Author hoặc SiteDocControl, tôi muốn xuất danh mục tài liệu đang xem ra tệp Excel theo đúng bộ lọc hiện tại, để lưu trữ và chia sẻ danh mục ngoài hệ thống.

#### Acceptance Criteria

1. WHERE người dùng giữ vai Author hoặc vai SiteDocControl, THE DCS SHALL hiển thị nút "Xuất danh mục Excel" trên trang `/documents`.
2. WHERE người dùng là Admin hoặc Reader và không giữ vai Author hoặc SiteDocControl, THE DCS SHALL ẩn nút "Xuất danh mục Excel" trên trang `/documents`.
3. WHEN người dùng kích hoạt Catalog_Export, THE Catalog_Export SHALL tạo một XLSX_File chứa các tài liệu khớp với Applied_Filters tại thời điểm kích hoạt.
4. WHEN Catalog_Export tạo XLSX_File, THE Catalog_Export SHALL tạo các cột theo thứ tự: Số hiệu, Phiên bản, Tiêu đề, Loại, Phạm vi, Trạng thái, Nguồn, Ngày ban hành, Ngày hiệu lực, Ngày rà soát kế tiếp, Ngày hết hạn.
5. WHEN Catalog_Export tạo XLSX_File, THE Catalog_Export SHALL không bao gồm cột File PDF.
6. WHEN Catalog_Export truy vấn dữ liệu, THE Catalog_Export SHALL bao gồm trường Nguồn (origin) trong kết quả trả về từ `listVisibleDocuments`.
7. WHEN máy chủ nhận yêu cầu Catalog_Export, IF người dùng không giữ vai Author và không giữ vai SiteDocControl, THEN THE DCS SHALL từ chối yêu cầu và không trả về XLSX_File.
8. WHEN Catalog_Export chọn tập dữ liệu để xuất, THE Catalog_Export SHALL giới hạn kết quả trong Visible_Scope của người dùng yêu cầu.

### Requirement 2: Xuất Excel "Tài liệu của tôi" (MyDocs_Export)

**User Story:** Là Author, tôi muốn xuất danh sách tài liệu của chính mình ra tệp Excel, để theo dõi tiến độ ban hành và phản hồi của các site.

#### Acceptance Criteria

1. WHERE người dùng giữ vai Author, THE DCS SHALL hiển thị nút "Xuất Excel" trên trang `/my-documents`.
2. WHEN người dùng kích hoạt MyDocs_Export, THE MyDocs_Export SHALL tạo một XLSX_File chứa các tài liệu do chính người dùng yêu cầu nộp.
3. WHEN MyDocs_Export tạo XLSX_File, THE MyDocs_Export SHALL tạo các cột theo thứ tự: Số hiệu, Phiên bản, Tiêu đề, Trạng thái, Site xác nhận, Tình trạng ban hành, Lý do từ chối.
4. WHEN MyDocs_Export điền cột Site xác nhận, THE MyDocs_Export SHALL thể hiện số site đã chấp nhận trên tổng số site theo định dạng số được chấp nhận trên tổng số.
5. WHEN MyDocs_Export điền cột Tình trạng ban hành, THE MyDocs_Export SHALL thể hiện giá trị tổng hợp tình trạng ban hành của tài liệu.
6. IF một tài liệu có lý do từ chối, THEN THE MyDocs_Export SHALL điền giá trị lý do từ chối vào cột Lý do từ chối.
7. WHEN máy chủ nhận yêu cầu MyDocs_Export, IF người dùng không giữ vai Author, THEN THE DCS SHALL từ chối yêu cầu và không trả về XLSX_File.
8. WHEN MyDocs_Export chọn tập dữ liệu để xuất, THE MyDocs_Export SHALL giới hạn kết quả trong các tài liệu do chính người dùng yêu cầu nộp.

### Requirement 3: Nguồn loại tài liệu dùng chung (DocType_Source)

**User Story:** Là người bảo trì DCS, tôi muốn biểu mẫu đăng ký và bộ lọc danh mục dùng chung một nguồn loại tài liệu, để danh sách loại tài liệu không bị lệch giữa hai nơi.

#### Acceptance Criteria

1. THE DocType_Source SHALL định nghĩa đúng tập DocType_Values gồm `SOP`, `WI`, `Form`, `Policy`, `External` tại tầng domain.
2. WHEN biểu mẫu đăng ký (`register.eta`) dựng danh sách loại tài liệu, THE DCS SHALL lấy danh sách loại tài liệu từ DocType_Source.
3. WHEN bộ lọc loại tài liệu trên trang danh mục (`catalog.eta`) dựng danh sách loại tài liệu, THE DCS SHALL lấy danh sách loại tài liệu từ DocType_Source.
4. THE DCS SHALL áp ràng buộc CHECK ở cơ sở dữ liệu cho phép cột loại tài liệu chỉ nhận đúng tập DocType_Values.

### Requirement 4: Yêu cầu phi chức năng

**User Story:** Là người bảo trì DCS, tôi muốn các chức năng xuất Excel an toàn và nhất quán, để bảo vệ phạm vi dữ liệu và dễ nhận diện tệp kết quả.

#### Acceptance Criteria

1. WHEN máy chủ xử lý yêu cầu Catalog_Export hoặc MyDocs_Export, THE DCS SHALL kiểm quyền vai ở phía máy chủ độc lập với trạng thái hiển thị của giao diện.
2. WHEN Catalog_Export xây dựng tập dữ liệu, THE Catalog_Export SHALL áp dụng toàn bộ Applied_Filters giống như trang danh mục đang hiển thị.
3. WHEN DCS trả về một XLSX_File, THE DCS SHALL đặt tên tệp theo quy ước nhất quán nhận diện được loại xuất và thời điểm xuất.
4. WHEN DCS tạo XLSX_File, THE DCS SHALL không bao gồm tài liệu nằm ngoài phạm vi dữ liệu người dùng được phép thấy đối với loại xuất tương ứng.
