# Implementation Plan: catalog-excel-export

## Overview

Kế hoạch triển khai tăng dần, ưu tiên kiểm thử, cho ba năng lực: Catalog_Export, MyDocs_Export và DocType_Source. Trình tự bắt đầu từ dependency và các khối thuần (doc-types, bộ dựng workbook, hàm quyền) — kiểm thử được không cần DB — rồi mở rộng `CatalogRow`, sau đó lắp hai route stream `.xlsx` và nút trên view, cuối cùng là bước xác minh biên dịch/build/test. Mỗi bước nối tiếp bước trước và kết thúc bằng việc nối dây vào route/view hiện có; không để lại mã rời rạc. Các test phụ thuộc Postgres (DCS-8) được đánh dấu tùy chọn để chạy thủ công khi có DB.

## Tasks

- [x] 1. Thêm dependency exceljs và cài đặt
  - Thêm `exceljs` vào `dependencies` của `package.json` với phiên bản ghim chính xác (không dùng `^`/`~`)
  - Chạy cài đặt để cập nhật `package-lock.json` và `node_modules`
  - _Requirements: 1.3, 2.3_

- [x] 2. Nguồn loại tài liệu dùng chung (DocType_Source)
  - [x] 2.1 Tạo `src/domain/doc-types.ts`
    - Khai báo interface `DocTypeOption` (`code: DocType`, `label: string`), tái dùng kiểu `DocType` từ `./registration.js`
    - Khai báo `DOC_TYPES: readonly DocTypeOption[]` gồm đúng `SOP`, `WI`, `Form`, `Policy`, `External`
    - Khai báo `DOC_TYPE_CODES: readonly DocType[]` dẫn xuất từ `DOC_TYPES`
    - Ghi chú quan hệ với ràng buộc CHECK trong `001_schema.sql` (phải khớp)
    - _Requirements: 3.1, 3.4_

  - [x]* 2.2 Viết unit test cho `doc-types.ts`
    - Khẳng định `DOC_TYPE_CODES` sâu-bằng `['SOP','WI','Form','Policy','External']`
    - Khẳng định mỗi `label` không rỗng
    - Test canh gác khớp với danh sách trong ràng buộc CHECK (hằng số kỳ vọng trong test)
    - _Requirements: 3.1_

  - [x] 2.3 Nối `register.eta` và `catalog.eta` vào DOC_TYPES
    - `register.eta`: thay mảng mã cứng bằng lặp `it.docTypes`
    - `catalog.eta`: thay 5 thẻ `<option>` cứng trong bộ lọc "Loại" bằng lặp `it.docTypes`, giữ trạng thái `selected` theo `ff.doc_type`
    - Truyền `docTypes: DOC_TYPES` từ các route `/register`, `/my-documents/:id/edit` và các nhánh re-render lỗi trong `src/routes/documents.ts`; truyền từ `/documents` trong `src/routes/catalog.ts`
    - _Requirements: 3.2, 3.3_

  - [x]* 2.4 Viết test render template cho bộ chọn "Loại"
    - Render `register.eta` và `catalog.eta` với `docTypes: DOC_TYPES`, khẳng định đúng 5 option với đúng `value`
    - _Requirements: 3.2, 3.3_

- [x] 3. Bộ dựng workbook dùng chung
  - [x] 3.1 Tạo `src/lib/xlsx.ts`
    - Khai báo interface `ColumnDef<Row>` (`header`, `value`, `width?`)
    - `buildWorkbook(columns, rows, sheetName)` — luôn ghi hàng tiêu đề trước khi lặp rows
    - `normalizeCell(v)` — `null`/`undefined` → chuỗi rỗng
    - `exportFileName(prefix, at)` — `{prefix}-YYYYMMDD-HHmmss.xlsx` (giờ máy chủ)
    - `streamXlsx(reply, workbook, fileName)` — đặt Content-Type + Content-Disposition, ghi `workbook.xlsx.write(reply.raw)` rồi `reply.raw.end()`
    - _Requirements: 1.3, 1.4, 2.3, 4.3_

  - [x]* 3.2 Property test: bảo toàn số dòng và nội dung ô (danh mục)
    - **Feature: catalog-excel-export, Property 1: Bộ dựng workbook danh mục bảo toàn số dòng và nội dung ô**
    - Sinh mảng `CatalogRow` ngẫu nhiên bằng fast-check; đọc lại workbook qua API exceljs (buffer → `xlsx.load`) để khẳng định đúng `rows.length` hàng dữ liệu và từng ô bằng kết quả hàm trích (null/undefined → chuỗi rỗng); tối thiểu 100 vòng
    - **Validates: Requirements 1.3**

  - [x]* 3.3 Property test: bất biến hàng tiêu đề danh mục và loại trừ cột File PDF
    - **Feature: catalog-excel-export, Property 2: Bất biến hàng tiêu đề danh mục và loại trừ cột File PDF**
    - Với mọi tập `CatalogRow` kể cả rỗng, hàng tiêu đề bằng đúng chuỗi 11 tiêu đề theo thứ tự và không chứa 'File PDF'
    - **Validates: Requirements 1.4, 1.5**

  - [x]* 3.4 Property test: tiêu đề và nội dung workbook "tài liệu của tôi"
    - **Feature: catalog-excel-export, Property 3: Bộ dựng workbook "tài liệu của tôi" ánh xạ đúng tiêu đề và nội dung**
    - Với mọi mảng `MyDocRow` kể cả rỗng, hàng tiêu đề bằng đúng 7 tiêu đề theo thứ tự; ô "Tình trạng ban hành" phản ánh giá trị tổng hợp; ô "Lý do từ chối" bằng `rejection_reason` khi có, rỗng khi không
    - **Validates: Requirements 2.3, 2.5, 2.6**

  - [x]* 3.5 Property test: định dạng ô "Site xác nhận"
    - **Feature: catalog-excel-export, Property 4: Định dạng ô "Site xác nhận" theo số được chấp nhận trên tổng số**
    - Sinh `accepted`, `total` với `0 ≤ accepted ≤ total`; `total > 0` → `"{accepted}/{total}"`, `total = 0` → chuỗi rỗng
    - **Validates: Requirements 2.4**

  - [x]* 3.6 Property test: quy ước tên tệp xuất
    - **Feature: catalog-excel-export, Property 5: Quy ước tên tệp xuất nhận diện loại xuất và thời điểm**
    - Sinh `Date` ngẫu nhiên; khẳng định `exportFileName` khớp mẫu `{prefix}-YYYYMMDD-HHmmss.xlsx` và tiền tố `catalog` khác `my-documents`
    - **Validates: Requirements 4.3**

- [x] 4. Hàm quyền export danh mục
  - [x] 4.1 Thêm `canExportCatalog` vào `src/domain/permissions.ts`
    - Hàm thuần: trả `true` nếu `roleCodes.has('DC_AUTHOR')` HOẶC `isSiteDocControl(roleCodes)`
    - _Requirements: 1.7, 4.1_

  - [x]* 4.2 Viết unit test bảng vai cho `canExportCatalog`
    - `{DC_AUTHOR}`→true, `{DC_SITE_DOC_CONTROL}`→true, `{DC_ADMIN}`→false, `{}` (Reader)→false, `{DC_AUTHOR,DC_ADMIN}`→true
    - _Requirements: 1.7, 2.7, 4.1_

- [x] 5. Mở rộng CatalogRow và SELECT
  - [x] 5.1 Bổ sung `origin`/`issued_date`/`expiry_date` trong `src/domain/catalog.ts`
    - Thêm `origin: string`, `issued_date: string | null`, `expiry_date: string | null` vào interface `CatalogRow`
    - Thêm `d.origin` vào câu `SELECT` của `listVisibleDocuments` (các cột ngày đã có trong SELECT, chỉ cần khai báo interface)
    - _Requirements: 1.6_

  - [x]* 5.2 Viết integration test `origin` cho `listVisibleDocuments` (cần Postgres)
    - Khẳng định hàng trả về có trường `origin` đúng sau khi thêm vào SELECT
    - _Requirements: 1.6_

- [x] 6. Checkpoint — Đảm bảo các test thuần đều xanh
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Catalog_Export: parse filter + route export + nút view
  - [x] 7.1 Tách `parseCatalogFilters` trong `src/routes/catalog.ts`
    - Trích logic parse querystring từ handler `/documents` thành hàm nội bộ trả `CatalogFilters` (status, q, doc_type, origin, eff_from, eff_to, preset, site_id, rollout_status, sort)
    - Chuyển handler `/documents` sang gọi `parseCatalogFilters` (đảm bảo Applied_Filters giống hệt)
    - _Requirements: 4.2_

  - [x] 7.2 Thêm route `GET /documents/export.xlsx`
    - `requireDocFlow` xác thực; nạp `roleCodesOf`; nếu `!canExportCatalog(roles)` → `reply.code(403)` + thông báo tiếng Việt, KHÔNG dựng workbook
    - `parseCatalogFilters(req.query)` → `listVisibleDocuments(sql, userId, filters, req.nav.isReadOnly)`
    - Định nghĩa `CATALOG_COLUMNS` (11 cột, KHÔNG có File PDF) dùng `scopeLabel`/`docStatusLabel`/`originLabel`
    - `buildWorkbook(CATALOG_COLUMNS, rows, 'Danh mục')` → `streamXlsx(reply, wb, exportFileName('catalog', new Date()))`
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 1.8, 4.1, 4.2, 4.4_

  - [x] 7.3 Thêm nút export + querystring lọc vào `catalog.eta`
    - Trong `.toolbar` của `page-header`, hiện nút "Xuất danh mục Excel" khi `it.nav.canRegister || it.nav.isSiteDocControl`
    - Liên kết tới `/documents/export.xlsx` kèm querystring lọc hiện tại (dùng `it.exportQuery` do route truyền sẵn, không dựng URL thủ công)
    - _Requirements: 1.1, 1.2_

  - [x]* 7.4 Viết integration test phạm vi + Applied_Filters cho Catalog_Export (cần Postgres)
    - Người dùng không thấy tài liệu ngoài Visible_Scope trong export
    - Với cùng querystring, tập dữ liệu `/documents/export.xlsx` bằng tập `/documents`
    - _Requirements: 1.8, 4.2, 4.4_

- [x] 8. MyDocs_Export: tách lắp dữ liệu + route export + nút view
  - [x] 8.1 Tách `assembleMyDocuments` trong `src/routes/documents.ts`
    - Trích khối lắp `docs` của handler `/my-documents` thành hàm dùng chung `assembleMyDocuments(sql, userId)` trả `MyDocRow[]` (giữ `aggregate` qua `aggregateStatusOf` + `hasContentReject`)
    - Chuyển handler `/my-documents` sang gọi `assembleMyDocuments`
    - _Requirements: 2.2, 2.8_

  - [x] 8.2 Thêm route `GET /my-documents/export.xlsx`
    - `requireUser` xác thực; nếu `!await canRegisterDocuments(sql, userId)` → `reply.code(403)` + thông báo tiếng Việt, KHÔNG dựng workbook
    - `assembleMyDocuments(sql, userId)` → định nghĩa `MY_DOCS_COLUMNS` (7 cột) dùng `docStatusLabel`/`aggregateLabel`
    - `buildWorkbook(MY_DOCS_COLUMNS, docs, 'Tài liệu của tôi')` → `streamXlsx(reply, wb, exportFileName('my-documents', new Date()))`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 4.4_

  - [x] 8.3 Thêm nút export vào `my-documents.eta`
    - Trong `.toolbar` của `page-header`, hiện nút "Xuất Excel" khi `it.nav.canRegister`, liên kết thuần tới `/my-documents/export.xlsx`
    - _Requirements: 2.1_

  - [x]* 8.4 Viết integration test phạm vi cho MyDocs_Export (cần Postgres)
    - Export chỉ gồm tài liệu `registrant_user_id` của chính người dùng
    - _Requirements: 2.2, 2.8_

- [x] 9. Checkpoint cuối — Xác minh biên dịch, build và test thuần
  - Chạy `npx tsc --noEmit` để kiểm tra kiểu
  - Chạy `npm run build`
  - Chạy `npm run test:unit`
  - Lưu ý: các test constraints/integration (nhiệm vụ 5.2, 7.4, 8.4) cần Postgres thật (DCS-8) — nếu không có DB sẵn, bỏ qua và chạy thủ công sau
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Các nhiệm vụ gắn `*` là tùy chọn; nhiệm vụ 5.2, 7.4, 8.4 phụ thuộc Postgres thật (DCS-8) nên đánh dấu tùy chọn/chạy thủ công khi có DB.
- Mỗi nhiệm vụ tham chiếu cụ thể các Yêu cầu để truy vết.
- Checkpoint (nhiệm vụ 6, 9) đảm bảo xác minh tăng dần.
- Property test (3.2–3.6) kiểm chứng các Property 1–5 trong design; unit test kiểm các ví dụ và trường hợp biên.
- Không thay đổi `src/server.ts` (hai route mới nằm trong hàm đăng ký đã được gọi sẵn).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.1", "4.2", "5.1"] },
    { "id": 2, "tasks": ["2.4", "3.2", "3.3", "3.4", "3.5", "3.6", "5.2"] },
    { "id": 3, "tasks": ["7.1", "8.1"] },
    { "id": 4, "tasks": ["7.2", "8.2"] },
    { "id": 5, "tasks": ["7.3", "8.3"] },
    { "id": 6, "tasks": ["7.4", "8.4"] }
  ]
}
```
