# PENDING: Integration test cần Postgres — dcs-mcp-server

> Dành cho AI/kỹ sư tiếp theo. Phần cài đặt MCP server đã HOÀN TẤT, build sạch,
> và test thuần offline đã pass. Hạng mục dưới đây (task 11.1) KHÔNG chạy được ở
> môi trường hiện tại vì thiếu Postgres, để lại kèm yêu cầu rõ ràng.

## Trạng thái hiện tại

Đã xong (tin cậy):
- `package.json`: thêm `@modelcontextprotocol/sdk@1.25.0`, `zod@3.25.76`,
  `@cfworker/json-schema@4.1.1` (ghim tuyệt đối); `npm install` OK, không lệch peer.
- `src/routes/mcp.ts`: hằng số + `clampLimit`/`capSnippet`; `resolveIdentity`
  (DI); `buildMcpServer` (stateless per-request); `registerMcpRoutes` (POST /mcp
  401 khi vô danh + GET /mcp 405); tool `search_documents`; tool
  `get_document_markdown`; resource `dcs://document/{id}`; helper dùng chung
  `readMarkdownIfAllowed`, `mapSearchHits`, `notFound`.
- `src/server.ts`: đăng ký `registerMcpRoutes(app, sql, config)`.
- `deploy/nginx-dcs.conf`: `location /mcp` (forward cookie, xoá X-Dcs-Session,
  timeout 120s), đặt trước `location /`.
- Test offline PASS: `test/domain/mcp.test.ts` (Property 2,3,4,5,6,7,8,9).
- `npm run build` (tsc) sạch.

Chưa làm (cần DB): task 11.1 — integration test lọc quyền end-to-end.

## Điều kiện tiên quyết môi trường

1. Postgres 16 với schema DCS + seed người dùng nhiều phạm vi (giống các test
   quyền sẵn có: `viewer-permissions.test.ts`, `permission-matrix.uat.test.ts`).
2. `DATABASE_URL_TEST` trỏ DB mà tên chứa "test".
3. Đã chạy toàn bộ migration (gồm 016_fulltext_markdown) để có cột
   `markdown_content` và view `v_search_index` nhánh fulltext.
4. Kết nối test qua `getSql({ databaseUrl: process.env.DATABASE_URL_TEST, dbPoolMax: 1 })`.

## Cần viết: test/domain/mcp-permission.test.ts (CẦN DB)

Dùng `node:test` + `node:assert/strict`. Skip có điều kiện khi không có DB (theo
mẫu `skip-domain.test.ts`). Gọi TRỰC TIẾP các hàm domain/helper của MCP với các
user seed khác nhau — KHÔNG cần dựng HTTP server thật:
- `search(sql, userId, q, includeHistorical, limit)` từ `src/domain/search.ts`
- `readMarkdownIfAllowed(sql, userId, docId)` từ `src/routes/mcp.ts`
- `canViewVersion` thật (mặc định của readMarkdownIfAllowed)

### Property 1 — Mọi truy vấn dùng đúng danh tính người gọi (end-to-end)
- Seed >=2 user có phạm vi khác nhau (vd user QA và user Prod) + tài liệu thuộc
  từng phạm vi, có bản hiệu lực + `markdown_content`.
- Gọi `search` với userA và userB cho cùng truy vấn → tập kết quả KHÁC nhau đúng
  theo phạm vi mỗi người. Đổi user → kết quả đổi theo.
- Validates: 2.2, 2.6, 3.1.

### 4.1 / 5.1 — Đường thành công
- User có quyền + doc có bản hiệu lực có `markdown_content` →
  `readMarkdownIfAllowed(sql, userId, docId)` trả đúng nội dung markdown.

### 4.2–4.3 / 5.3–5.4 — Ngoài phạm vi vs không tồn tại (trên dữ liệu thật)
- User KHÔNG thuộc phạm vi của một doc TỒN TẠI → `readMarkdownIfAllowed` trả
  `null` (caller sinh `notFound`).
- `doc_id` bịa (không tồn tại) → cũng trả `null`.
- Khẳng định HAI trường hợp cho kết quả giống hệt (đều `null` → notFound giống
  hệt) → không rò rỉ sự tồn tại.

### (Tuỳ chọn) Smoke tool-list qua HTTP
- Nếu muốn kiểm end-to-end transport: khởi động app, POST /mcp một JSON-RPC
  `tools/list` kèm cookie `dcs_sid` hợp lệ (tạo session qua `createSession`), xác
  nhận trả về `search_documents`, `get_document_markdown` và resource
  `dcs://document/{id}`; POST không cookie → 401.

## Lệnh chạy sau khi viết

```
node --import tsx --test test/domain/mcp-permission.test.ts
# hoặc toàn bộ:
npm test
```

## Ghi chú môi trường (không liên quan tính năng này)

`test/domain/skip-domain.test.ts` đọc cứng `/etc/dcs/.env` nên fail trên máy
không có file + không có DB — vấn đề môi trường có từ trước, không do MCP server.
