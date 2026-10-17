# Implementation Plan: document-markdown-fulltext

## Overview

Bổ sung một nguồn chỉ mục tìm kiếm MỚI cấp phiên bản phủ toàn bộ thân tài liệu. Thứ tự hiện thực tăng dần: trước tiên là nền tảng dữ liệu (migration) và hàm thuần `buildFulltextMarkdown`, rồi adapter OCR thay thế được qua cấu hình, sau đó tích hợp vào `processVersionContent` trong cùng transaction, cập nhật worker truyền engine, và cuối cùng là bộ integration test khớp toàn văn trên DB. Mỗi task bám đúng tên file và thành phần trong design: `src/db/migrations/016_fulltext_markdown.sql`, `src/domain/fulltext-markdown.ts`, `src/domain/ocr-engine.ts`, `src/domain/content.ts`, `src/jobs/ocr-worker.ts`, `src/config.ts`.

## Tasks

- [x] 1. Migration 016 — cột toàn văn, GIN index, mở rộng v_search_index
  - Tạo `src/db/migrations/016_fulltext_markdown.sql` theo trình chạy `src/db/migrate.ts` (mỗi file một transaction, chạy theo thứ tự số)
  - `ALTER TABLE document_versions ADD COLUMN markdown_content TEXT, ADD COLUMN fulltext_tsv tsvector` (mặc định NULL cho tương thích phiên bản cũ)
  - `CREATE INDEX idx_docver_fulltext_tsv ON document_versions USING GIN (fulltext_tsv)`
  - `CREATE OR REPLACE VIEW v_search_index` giữ nguyên hai nhánh `document` và `section`, thêm nhánh `UNION ALL` cấp phiên bản `match_level='fulltext'` dùng `v.fulltext_tsv AS search_tsv`, snippet `left(coalesce(v.markdown_content,''), 200)`, lọc `WHERE v.fulltext_tsv IS NOT NULL`
  - Giữ nguyên danh sách/kiểu cột của view để `fn_search`/`fn_search_limited` không cần sửa
  - _Requirements: 1.3, 4.1, 4.2, 4.3, 5.2, 5.4_

- [x] 2. Bộ_Sinh_Markdown thuần — buildFulltextMarkdown
  - [x] 2.1 Tạo `src/domain/fulltext-markdown.ts` với interface và hàm thuần
    - Khai báo `FulltextMeta` (docId, title, versionNo, scope, status, effectiveDate, docType) và `FulltextMarkdown` (markdown, fulltextSource)
    - Hiện thực `buildFulltextMarkdown(meta, sections, fullText, isForm)` thuần, tất định, KHÔNG nhận filePath và KHÔNG làm I/O
    - Non-Form: frontmatter YAML đủ bảy trường + thân heading `## {sectionCode} {sectionTitle}` kèm `rawText`; `fulltextSource = fullText` nối thêm các `sectionTitle`
    - Form: `markdown` chỉ gồm frontmatter tối giản + danh sách `- {sectionCode} {sectionTitle}` (KHÔNG `rawText`); `fulltextSource = null`
    - Giữ nguyên thứ tự `sections`, không dùng `Date.now()`/`randomUUID`
    - _Requirements: 2.1, 2.2, 6.1, 6.2, 6.3, 9.1, 9.2_

  - [ ]* 2.2 Property test: độ phủ toàn văn cho non-Form
    - **Feature: document-markdown-fulltext, Property 1: Độ phủ toàn văn cho non-Form**
    - Sinh `fullText` trộn dòng khớp và không khớp `HEADING_RE`; khẳng định token hoá `fullText` ⊆ token hoá `fulltextSource`, gồm cả phần dư ngoài mục; tối thiểu 100 vòng
    - File `test/domain/fulltext-markdown.test.ts`
    - **Validates: Requirements 1.2, 2.1, 6.3**

  - [ ]* 2.3 Property test: Bộ_Sinh_Markdown tất định
    - **Feature: document-markdown-fulltext, Property 2: Bộ_Sinh_Markdown tất định**
    - Sinh đầu vào ngẫu nhiên (Form và non-Form), gọi hai lần, `assert.equal` từng trường `markdown` và `fulltextSource`; tối thiểu 100 vòng
    - File `test/domain/fulltext-markdown.test.ts`
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 2.4 Property test: Form chỉ sinh tiêu đề, không chỉ mục thân
    - **Feature: document-markdown-fulltext, Property 3: Form chỉ sinh tiêu đề, không chỉ mục thân**
    - Sinh `sections` có `rawText` chứa token đánh dấu duy nhất; khẳng định `fulltextSource === null`, token đánh dấu vắng trong `markdown`, mọi `sectionTitle` có trong `markdown`; tối thiểu 100 vòng
    - File `test/domain/fulltext-markdown.test.ts`
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 2.5 Property test: Frontmatter đầy đủ trường ngữ cảnh
    - **Feature: document-markdown-fulltext, Property 4: Frontmatter đầy đủ trường ngữ cảnh**
    - Sinh `meta` non-Form ngẫu nhiên; khẳng định `markdown` chứa đủ bảy trường docId, title, versionNo, scope, status, effectiveDate, docType; tối thiểu 100 vòng
    - File `test/domain/fulltext-markdown.test.ts`
    - **Validates: Requirements 9.1, 9.2**

- [x] 3. OcrEngine adapter thay thế được qua cấu hình
  - [x] 3.1 Thêm cấu hình OCR_ENGINE vào `src/config.ts`
    - Thêm `ocrEngine: string` đọc từ `env.OCR_ENGINE ?? 'tesseract'`; giữ nguyên `tesseractPath`
    - _Requirements: 8.3_

  - [x] 3.2 Tạo `src/domain/ocr-engine.ts` với interface, TesseractEngine, factory
    - Khai báo `OcrEngine` (`run(filePath, lang?)`), `OcrEngineConfig` (engine?, tesseractPath)
    - `TesseractEngine` bọc `runTesseract` hiện có trong `src/domain/ocr.ts` (giữ nguyên hàm đó), chạy cục bộ qua tiến trình con, không HTTP
    - `createOcrEngine(cfg)` chọn engine theo tên; rỗng/không nhận ra rơi vào `default` trả Tesseract, không ném
    - _Requirements: 7.3, 8.1, 8.2, 8.3_

  - [ ]* 3.3 Example tests cho OCR factory
    - `createOcrEngine({ tesseractPath })` trả `instanceof TesseractEngine`
    - `createOcrEngine({ engine: 'tesseract', tesseractPath })` trả đối tượng có phương thức `.run`
    - `createOcrEngine({ engine: 'khong-ton-tai', tesseractPath })` không ném, trả Tesseract mặc định
    - File `test/domain/ocr-engine.test.ts`
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Tích hợp vào processVersionContent — `src/domain/content.ts`
  - [x] 4.1 Mở rộng truy vấn meta cho frontmatter
    - Sửa truy vấn `meta` đầu hàm lấy thêm `v.title, v.version_no, v.scope, v.status, v.effective_date, v.doc_id, d.doc_type` qua `JOIN documents d ON d.doc_id = v.doc_id`
    - Giữ nguyên hành vi ném `'Không tìm thấy phiên bản để xử lý nội dung'` khi `meta` không tồn tại
    - _Requirements: 9.1_

  - [x] 4.2 Dùng OcrEngine thay gọi trực tiếp runTesseract
    - Mở rộng `opts` thêm `ocrEngine?: OcrEngine`; chọn `engine = opts.ocrEngine ?? (opts.tesseractPath ? new TesseractEngine(opts.tesseractPath) : null)`
    - Trong Nhánh_OCR, chỉ chạy khi `result.parseStatus === 'kem_tin_cay' && !isForm && engine`, gọi `engine.run(meta.file_path)` rồi giữ nguyên phần xây `ocrResult`
    - _Requirements: 2.5, 7.1, 7.2, 8.1_

  - [x] 4.3 Sinh và lưu markdown_content/fulltext_tsv trong cùng transaction
    - Trong `sql.begin`, sau vòng lặp INSERT sections/chunks, gọi `buildFulltextMarkdown(...)` từ `result.sections` và `result.fullText` (không parse lại PDF)
    - `UPDATE document_versions SET ... markdown_content = ${fm.markdown}, fulltext_tsv = CASE WHEN ${fm.fulltextSource}::text IS NULL THEN NULL ELSE vn_tsv(${fm.fulltextSource}) END WHERE version_id = ${versionId}`
    - Ghi đè giá trị cũ để chạy lại là thay thế (idempotent); nằm trong transaction nên rollback thì không lưu
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 5.1, 6.3_

- [x] 5. Cập nhật worker truyền ocrEngine — `src/jobs/ocr-worker.ts`
  - Truyền `ocrEngine: createOcrEngine({ engine: config.ocrEngine, tesseractPath: config.tesseractPath })` vào lời gọi `processVersionContent`
  - Giữ tính chất tiến trình rời (worker chạy mỗi lần một tệp rồi thoát)
  - _Requirements: 7.3, 8.1, 8.2, 8.3_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Integration tests tìm kiếm toàn văn — `test/domain/fulltext-search.test.ts`
  - [ ]* 7.1 Khớp thân ngoài mục và không hồi quy
    - Seed `document_versions` với `markdown_content` + `fulltext_tsv = vn_tsv(...)` chứa cụm từ ở đoạn KHÔNG thuộc mục; gọi `fn_search`; khẳng định trả về `version_id` với `match_level='fulltext'`
    - Khẳng định khớp số hiệu và khớp tiêu đề mục vẫn trả về (fulltext là bổ sung, không thay thế)
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 7.2 Tương thích phiên bản cũ NULL và không dấu khớp có dấu
    - Seed phiên bản có `fulltext_tsv = NULL`; khớp số hiệu/tiêu đề mục vẫn ra, không có hàng fulltext
    - Seed thân có dấu, tìm bằng truy vấn không dấu, khẳng định trả về nhờ `vn_unaccent`; khẳng định `fulltext_tsv = vn_tsv(...)` nhất quán trong DB
    - _Requirements: 4.3, 5.1, 5.5_

  - [ ]* 7.3 Idempotent chạy lại và nhánh OCR dùng engine giả
    - Gọi `processVersionContent` hai lần cho cùng phiên bản với extract/engine giả trả cùng dữ liệu; khẳng định `markdown_content`/`fulltext_tsv` cuối không đổi và `document_sections` không nhân đôi
    - Engine giả: khi `extractPdf` giả trả `thanh_cong`, `engine.run` KHÔNG được gọi; khi trả `kem_tin_cay` + non-Form, `engine.run` được gọi và `markdown_content` chứa văn bản OCR
    - _Requirements: 2.5, 3.1, 7.1, 7.2_

- [x] 8. Cập nhật `.env.example` thêm OCR_ENGINE
  - Thêm biến `OCR_ENGINE=tesseract` với chú thích engine nhận dạng ký tự mặc định
  - _Requirements: 8.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks đánh dấu `*` là tùy chọn (test) và có thể bỏ qua để chạy MVP nhanh; mã chính không bao giờ đánh dấu tùy chọn.
- Mỗi task tham chiếu requirement cụ thể để truy vết.
- Checkpoint đảm bảo kiểm chứng tăng dần.
- Property test kiểm chứng các property phổ quát trong design; integration test kiểm chứng phần DB và điểm tích hợp.
- Thứ tự: migration + hàm thuần trước, rồi adapter OCR, rồi tích hợp content.ts, rồi worker, rồi integration test cuối — không có mã mồ côi, mọi bước nối vào bước trước.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2"] },
    { "id": 2, "tasks": ["3.3", "4.1"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["4.3"] },
    { "id": 5, "tasks": ["5", "8"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3"] }
  ]
}
```
