# PENDING: Integration tests cần Postgres — document-markdown-fulltext

> Dành cho AI/kỹ sư tiếp theo. Phần cài đặt tính năng đã HOÀN TẤT và qua typecheck
> + test offline. Các hạng mục dưới đây KHÔNG chạy được trong môi trường hiện tại
> vì thiếu Postgres, nên để lại kèm yêu cầu rõ ràng để làm tiếp trên máy có DB.

## Trạng thái hiện tại

Đã xong (có thể tin cậy):
- Migration `src/db/migrations/016_fulltext_markdown.sql` — thêm `markdown_content`,
  `fulltext_tsv` + GIN index `idx_docver_fulltext_tsv`, mở rộng view `v_search_index`
  với nhánh `UNION ALL match_level='fulltext'`. ĐÃ kiểm tra tĩnh cú pháp + tính nhất
  quán danh sách cột view, CHƯA chạy `npm run migrate` thật.
- `src/domain/fulltext-markdown.ts`, `src/domain/ocr-engine.ts`,
  `src/domain/content.ts` (tích hợp), `src/config.ts`, `src/jobs/ocr-worker.ts`,
  `.env.example`.
- Test offline PASS: `test/domain/fulltext-markdown.test.ts` (4 property, mỗi
  property 100 vòng) và `test/domain/ocr-engine.test.ts` (3 ca factory).
- `npx tsc -p tsconfig.json --noEmit` sạch.

Chưa làm (cần DB):
- Chạy migration 016 thật trên DB test.
- Viết + chạy integration tests `test/domain/fulltext-search.test.ts` (task 7.1–7.3).

## Điều kiện tiên quyết môi trường

1. Postgres 16 chạy được, có extension `unaccent` và `pg_trgm` (schema gốc DCS-4 đã
   khai; migrate sẽ tạo nếu chưa có).
2. Biến môi trường `DATABASE_URL_TEST` trỏ tới một DB mà TÊN chứa chữ "test"
   (xem `.env.example`; `constraints.test.ts` tự chặn nếu tên không chứa "test").
3. Chạy toàn bộ migration lên DB test:
   ```
   # đặt DATABASE_URL = DATABASE_URL_TEST rồi:
   npm run migrate
   ```
   Xác nhận migration 016 chạy không lỗi và `document_versions` có cột
   `markdown_content`, `fulltext_tsv`; view `v_search_index` có nhánh `fulltext`.

## Cần viết: test/domain/fulltext-search.test.ts

Dùng `node:test` + `node:assert/strict`. Kết nối bằng `getSql({ databaseUrl:
process.env.DATABASE_URL_TEST, dbPoolMax: 1 })` (xem `src/db/client.ts`). Seed dữ
liệu tối thiểu rồi dọn sau mỗi test (theo mẫu các test cần DB hiện có). `vn_tsv` và
`vn_unaccent` là hàm SQL sẵn có.

### 7.1 — Khớp thân ngoài mục + không hồi quy (Requirements 1.1, 1.2, 1.3)
- Seed một `document_versions` với `markdown_content` + `fulltext_tsv = vn_tsv(<text>)`
  trong đó `<text>` chứa một cụm từ nằm ở đoạn KHÔNG thuộc bất kỳ mục nào.
- Gọi `fn_search` với cụm từ đó; khẳng định trả về đúng `version_id` với
  `match_level = 'fulltext'`.
- Khẳng định khớp theo số hiệu tài liệu và khớp theo tiêu đề mục VẪN trả về (nhánh
  fulltext là BỔ SUNG, không thay thế hai nhánh cũ).

### 7.2 — Tương thích phiên bản cũ NULL + không dấu khớp có dấu (Requirements 4.3, 5.1, 5.5)
- Seed một phiên bản có `fulltext_tsv = NULL`; khẳng định tìm theo số hiệu/tiêu đề
  mục vẫn ra, và KHÔNG có hàng `match_level='fulltext'` cho phiên bản đó.
- Seed thân tài liệu CÓ dấu tiếng Việt; tìm bằng truy vấn KHÔNG dấu; khẳng định vẫn
  trả về nhờ `vn_unaccent`.
- Khẳng định `fulltext_tsv` trong DB bằng đúng `vn_tsv(<nguồn>)` (nhất quán hàm sinh).

### 7.3 — Idempotent chạy lại + nhánh OCR dùng engine giả (Requirements 2.5, 3.1, 7.1, 7.2)
- Gọi `processVersionContent` HAI lần cho cùng một phiên bản với `extractPdf`/engine
  giả trả cùng dữ liệu; khẳng định `markdown_content`/`fulltext_tsv` cuối cùng KHÔNG
  đổi và `document_sections` KHÔNG nhân đôi.
- Engine OCR giả (implements `OcrEngine`): 
  - (a) khi `extractPdf` (giả) trả `thanh_cong` -> `engine.run` KHÔNG được gọi.
  - (b) khi trả `kem_tin_cay` + non-Form -> `engine.run` ĐƯỢC gọi và `markdown_content`
        chứa văn bản OCR.
  - Lưu ý: `processVersionContent` nhận `opts.ocrEngine` nên có thể tiêm engine giả
    trực tiếp. Để giả `extractPdf`, cân nhắc tách/tiêm hoặc seed file thật có/không có
    lớp text; nếu cần refactor nhỏ để tiêm được extract, ghi chú và giữ API cũ tương thích.

## Lệnh chạy sau khi viết

```
# toàn bộ test (cần DB chạy)
npm test
# hoặc chỉ file mới
node --import tsx --test test/domain/fulltext-search.test.ts
```

## Ghi chú — test có sẵn đang fail do môi trường (KHÔNG liên quan tính năng này)

`test/domain/skip-domain.test.ts` đọc cứng `/etc/dcs/.env` và kết nối Postgres ngay
khi load module, nên fail với ENOENT trên máy không có file đó + không có DB. Đây là
vấn đề môi trường có từ trước, không do thay đổi của tính năng document-markdown-fulltext.
Trên môi trường CI/DB thật (có `/etc/dcs/.env`) thì test này chạy bình thường.
