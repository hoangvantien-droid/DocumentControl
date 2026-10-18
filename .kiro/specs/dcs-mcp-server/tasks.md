# Implementation Plan: DCS_MCP_Server

## Overview

Triển khai điểm cuối `/mcp` nhúng trong ứng dụng Fastify hiện có, phơi hai công cụ
chỉ đọc (`search_documents`, `get_document_markdown`) và một tài nguyên
(`dcs://document/{id}`), tất cả đều lọc quyền theo `user_id` thật của phiên. Thứ tự
triển khai tăng dần: thêm dependency và hàm thuần trước (dễ kiểm chứng, không cần
DB), rồi phân giải danh tính, dựng server/route, các tool, resource, đăng ký vào
`src/server.ts`, cập nhật nginx, và cuối cùng là integration test cần DB. Mỗi bước
xây trên bước trước và kết nối vào tổng thể, không để lại mã mồ côi.

Mọi handler và hàm phân giải danh tính nhận dependency qua tham số (dependency
injection) để unit test được bằng spy/stub mà không chạm DB, đúng theo Testing
Strategy của design.

## Tasks

- [x] 1. Thêm dependency MCP SDK, Zod và peer dep json-schema
  - Thêm `@modelcontextprotocol/sdk` ghim `1.25.0`, `zod` ghim `3.25.76` (thoả peer range `^3.25` của SDK; bản `3.23.8` KHÔNG thoả), và `@cfworker/json-schema` ghim `4.1.1` (peer dep của SDK, cài tường minh để tránh thiếu peer khi `npm install` không Docker) — tất cả không có `^` — vào `dependencies` của `package.json`
  - Chạy `npm install` để cập nhật `package-lock.json`
  - Xác minh import được bằng một script tạm hoặc lệnh `node --import tsx -e` import `@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/streamableHttp.js` và `zod`; chạy `npm ls zod` và `npm ls @cfworker/json-schema` để kiểm tra không lệch peer range
  - Xoá script tạm sau khi xác minh
  - _Requirements: 1.1, 1.2_

- [x] 2. Hàm thuần và hằng số giới hạn trong `src/routes/mcp.ts`
  - [x] 2.1 Tạo khung `src/routes/mcp.ts` với hằng số và hàm thuần
    - Khai báo `DEFAULT_RESULT_LIMIT = 20`, `MAXIMUM_RESULT_LIMIT = 50`, `SNIPPET_CAP = 300`
    - Export `clampLimit(limit: number | undefined): number` chuẩn hoá về `[1, MAXIMUM_RESULT_LIMIT]`, mặc định `DEFAULT_RESULT_LIMIT` khi `undefined`/không hữu hạn
    - Export `capSnippet(s: string | null): string` cắt về tối đa `SNIPPET_CAP` ký tự, trả tiền tố của chuỗi gốc, trả `''` khi `null`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x]* 2.2 Viết unit test thuần cho `clampLimit` tại `test/domain/mcp.test.ts`
    - **Feature: dcs-mcp-server, Property 7: Số kết quả luôn trong khoảng cho phép**
    - Sinh số nguyên ngẫu nhiên (âm, 0, >50, rất lớn) và `undefined`; khẳng định `1 ≤ clampLimit(n) ≤ 50`, `clampLimit(undefined) = 20`, `clampLimit(n>50) = 50` (tối thiểu 100 lần lặp)
    - **Validates: Requirements 6.1, 6.2**

  - [x]* 2.3 Viết unit test thuần cho `capSnippet` tại `test/domain/mcp.test.ts`
    - **Feature: dcs-mcp-server, Property 8: Snippet luôn bị cắt theo Snippet_Cap**
    - Sinh chuỗi ngẫu nhiên độ dài biến thiên; khẳng định `capSnippet(s).length ≤ 300` và `s.startsWith(capSnippet(s))` (tối thiểu 100 lần lặp)
    - **Validates: Requirements 6.3**

- [x] 3. Phân giải danh tính `resolveIdentity`
  - [x] 3.1 Hiện thực `resolveIdentity` trong `src/routes/mcp.ts`
    - Đọc cookie `SESSION_COOKIE` (`'dcs_sid'`) từ `request.cookies`; thiếu cookie → trả `null`
    - Gọi `request.unsignCookie(raw)`; chữ ký không hợp lệ hoặc không có giá trị → trả `null`
    - Gọi `resolveSession(sql, unsigned.value)` và trả kết quả (có thể `null`)
    - Nhận `resolveSession` (hoặc các phụ thuộc) qua tham số/dependency injection để stub được trong test; caller sẽ trả HTTP 401 khi hàm trả `null`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6_

  - [x]* 3.2 Viết unit test thuần cho `resolveIdentity` tại `test/domain/mcp.test.ts`
    - **Feature: dcs-mcp-server, Property 9: Phân giải danh tính là điều kiện cần của mọi yêu cầu**
    - Stub `resolveSession`/`unsignCookie`: cookie vắng → `null`; chữ ký sai → `null`; `resolveSession` trả `null` → `null`; cookie hợp lệ + user → trả đúng `SessionUser`; khẳng định không tool/resource nào được gọi khi `null`
    - **Validates: Requirements 2.1, 2.3, 2.4**

- [x] 4. Dựng MCP server và route `/mcp`
  - [x] 4.1 Hiện thực `buildMcpServer(sql, userId)` trong `src/routes/mcp.ts`
    - Tạo `McpServer({ name: 'dcs-mcp', version: '0.1.0' })`
    - Tạo `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` (stateless)
    - Để chỗ gọi `registerSearchTool`, `registerGetMarkdownTool`, `registerDocumentResource` (sẽ nối ở task 5–7), tất cả bind `userId` vào closure
    - Trả `{ server, transport }`
    - _Requirements: 1.3, 2.2_

  - [x] 4.2 Hiện thực `registerMcpRoutes(app, sql, config)` và route `POST /mcp`
    - Đăng ký `POST /mcp`: gọi `resolveIdentity`; nếu `null` → `reply.code(401).send({ error: 'unauthorized' })` và dừng, không khởi tạo MCP
    - Nếu hợp lệ → `buildMcpServer(sql, user.user_id)`, `reply.hijack()`, nối `request.raw.on('close', ...)` để `transport.close()` + `server.close()`, `await server.connect(transport)`, `await transport.handleRequest(request.raw, reply.raw, request.body)`
    - Đăng ký `GET /mcp` trả 401/405 (stateless không dùng kênh SSE server→client)
    - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.4_

- [x] 5. Tool `search_documents`
  - [x] 5.1 Hiện thực `registerSearchTool` và nối vào `buildMcpServer`
    - Định nghĩa Zod input schema: `q` (string min 1), `include_historical` (boolean optional), `limit` (int optional)
    - Handler gọi `search(sql, userId, q, include_historical ?? false, clampLimit(limit))`
    - Ánh xạ mỗi hit sang DTO giữ nguyên `match_level`, các trường khác, và `snippet: capSnippet(h.snippet)`; **không** lọc lại sau truy vấn
    - Trả `content` dạng text và `structuredContent: { results }`
    - Nhận `search` qua tham số để test được
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3_

  - [x]* 5.2 Viết unit test tầng ánh xạ cho `search_documents` tại `test/domain/mcp.test.ts`
    - **Feature: dcs-mcp-server, Property 2: Tham số tìm kiếm truyền nguyên vẹn với mặc định đúng**
    - **Feature: dcs-mcp-server, Property 3: Không lọc lại kết quả sau truy vấn**
    - **Feature: dcs-mcp-server, Property 6: Giữ nguyên Match_Level của mỗi kết quả**
    - Inject `search` giả (spy) trả `SearchHit` ngẫu nhiên; khẳng định spy nhận `include_historical` nguyên vẹn và `false` khi vắng (P2); tập `doc_id` output = tập spy trả về sau clamp (P3); mỗi phần tử giữ đúng `match_level` (P6) (tối thiểu 100 lần lặp)
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

- [x] 6. Hàm dùng chung `readMarkdownIfAllowed` và tool `get_document_markdown`
  - [x] 6.1 Hiện thực `readMarkdownIfAllowed(sql, userId, docId)` và `registerGetMarkdownTool`
    - `readMarkdownIfAllowed`: tra `version_id` từ `v_current_documents` theo `doc_id`; không có → `null`; `canViewVersion(sql, userId, versionId)` false → `null`; đọc `markdown_content` từ `document_versions`; trả `markdown_content ?? null`
    - `registerGetMarkdownTool` với input `{ doc_id }` (Zod string min 1): gọi `readMarkdownIfAllowed`; `null` → `notFound()` (kết quả cố định, không chứa nội dung, không phân biệt tồn tại vs ngoài phạm vi); ngược lại trả `content` text là markdown
    - Hiện thực `notFound()` trả `{ isError: true, content: [{ type: 'text', text: '...không tìm thấy hoặc không có quyền...' }] }`
    - Nối `registerGetMarkdownTool` vào `buildMcpServer`; nhận `canViewVersion`/truy vấn qua tham số để test được
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 6.2 Viết unit test logic không-tìm-thấy cho `get_document_markdown` tại `test/domain/mcp.test.ts`
    - **Feature: dcs-mcp-server, Property 4: Không bao giờ trả nội dung khi không có quyền**
    - **Feature: dcs-mcp-server, Property 5: Không phân biệt được tồn tại với ngoài phạm vi**
    - Inject `canViewVersion`/truy vấn giả: `canViewVersion=false` hoặc không có bản hiệu lực → output không chứa markdown (P4); so output nhánh "không tồn tại" vs "ngoài phạm vi" → giống hệt (cùng nội dung, cùng `isError`) (P5)
    - **Validates: Requirements 4.2, 4.3, 5.3, 5.4**

- [x] 7. Resource `dcs://document/{id}`
  - [x] 7.1 Hiện thực `registerDocumentResource` và nối vào `buildMcpServer`
    - Dùng `ResourceTemplate('dcs://document/{id}', { list: undefined })`
    - Handler gọi `readMarkdownIfAllowed(sql, userId, String(id))`; `null` → `throw new Error(...)` với thông điệp giống hệt tool (không phân biệt tồn tại vs ngoài phạm vi); ngược lại trả `contents` với `mimeType: 'text/markdown'`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Đăng ký route vào `src/server.ts`
  - Import `registerMcpRoutes` và thêm dòng `registerMcpRoutes(app, sql, config);` khớp khuôn mẫu `register*Routes` hiện có
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 9. Cập nhật cấu hình nginx
  - Thêm `location /mcp` vào `deploy/nginx-dcs.conf` (đặt trước `location /`): `proxy_pass http://127.0.0.1:3100`, forward cookie, `proxy_set_header X-Dcs-Session ""` để chặn header danh tính giả từ client, `proxy_read_timeout 120s`
  - Giả định app chạy ở root; nếu deploy dưới path con (`config.basePath = /dcs`) thì `location` phải là `/dcs/mcp`
  - _Requirements: 1.4, 2.5_

- [x] 10. Checkpoint - Đảm bảo build và test thuần pass
  - Chạy `tsc` (build) và `node --import tsx --test test/domain/mcp.test.ts`; đảm bảo pass. Ensure all tests pass, ask the user if questions arise.

- [x] 11. Integration test lọc quyền cần DB
  - [x]* 11.1 Viết integration test tại `test/domain/mcp-permission.test.ts` (CẦN DATABASE)
    - **Feature: dcs-mcp-server, Property 1: Mọi truy vấn domain dùng đúng danh tính người gọi**
    - Cần PostgreSQL có schema + seed; skip có điều kiện khi không có DB theo mẫu `skip-domain.test.ts`
    - Property 1 end-to-end: vài user seed phạm vi khác nhau, gọi `search_documents`/`get_document_markdown` → kết quả khớp quyền; đổi user → kết quả đổi theo
    - Đường thành công 4.1/5.1: user có quyền + doc có bản hiệu lực có `markdown_content` → trả đúng nội dung
    - Ngoài phạm vi vs không tồn tại 4.2–4.3/5.3–5.4 trên dữ liệu thật: user ngoài phạm vi của doc tồn tại → phản hồi giống hệt với `doc_id` bịa
    - **Validates: Requirements 2.2, 2.6, 3.1, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4**

- [x] 12. Final checkpoint - Đảm bảo toàn bộ test pass
  - Chạy `tsc` và toàn bộ suite `node --import tsx --test test/**/*.test.ts` (kèm integration khi có DB). Ensure all tests pass, ask the user if questions arise.

## Notes

- Các task gắn `*` là tùy chọn (unit/property/integration test) và có thể bỏ qua cho MVP nhanh; mã chính không gắn `*` và phải được hiện thực.
- Mỗi task tham chiếu requirement cụ thể để truy vết.
- Checkpoint đảm bảo kiểm chứng tăng dần.
- Property test gắn nhãn `Feature: dcs-mcp-server, Property N: ...`, tối thiểu 100 lần lặp, chạy bằng node:test theo Testing Strategy.
- Các task ghi vào cùng `src/routes/mcp.ts` (2.1, 3.1, 4.1, 4.2, 5.1, 6.1, 7.1) được xếp khác wave để tránh xung đột ghi cùng file.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1"] },
    { "id": 7, "tasks": ["8", "9"] },
    { "id": 8, "tasks": ["11.1"] }
  ]
}
```
