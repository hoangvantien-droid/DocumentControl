# Design Document

## Overview

DCS_MCP_Server là một tầng mỏng nhúng vào ứng dụng Fastify hiện có của DCS, phơi
điểm cuối `/mcp` để tác nhân AI truy vấn kho tài liệu ở chế độ chỉ đọc. Toàn bộ
logic nghiệp vụ (tìm kiếm, lọc quyền, đọc nội dung) tái dùng đúng các hàm domain
đã có; module MCP chỉ làm ba việc: (1) phân giải danh tính từ phiên, (2) ánh xạ
yêu cầu MCP sang các hàm domain với `user_id` thật, và (3) định dạng kết quả theo
giao thức MCP.

Thiết kế tuân thủ ràng buộc vận hành của DCS: một tiến trình duy nhất, RAM khoảng
1 GB, không Docker, chạy sau nginx reverse proxy. Module mới nằm ở
`src/routes/mcp.ts` với hàm `registerMcpRoutes(app, sql, config)`, khớp khuôn mẫu
`register*Routes` của `src/server.ts`.

Nguyên tắc cốt lõi (từ requirements):

- **Lọc quyền trong truy vấn, không bao giờ bỏ qua.** Mọi lời gọi xuống tầng
  domain đều truyền `user_id` của Resolved_User; không có tài khoản dịch vụ, không
  có đường tắt bỏ phân quyền.
- **Chỉ đọc.** Chỉ gọi `fn_search_limited`, `v_current_documents`,
  `document_versions`, `canViewVersion`. Không write, không chạm lớp AI
  (embedding, `index_status`).
- **Không rò rỉ sự tồn tại.** Tài liệu ngoài phạm vi và tài liệu không tồn tại
  phản hồi giống hệt nhau.

## Architecture

### Vị trí trong hệ thống

```
MCP_Client (tác nhân AI)
   │  HTTP (Streamable HTTP, JSON-RPC over POST /mcp)
   ▼
nginx (reverse proxy nội bộ)
   │  location /mcp → 127.0.0.1:3100
   │  - xoá header danh tính do client gửi
   │  - chỉ forward cookie dcs_sid (đã ký)
   ▼
Fastify app (một tiến trình)
   │  registerMcpRoutes(app, sql, config)
   ▼
src/routes/mcp.ts
   ├─ Phân giải danh tính: unsignCookie(dcs_sid) → resolveSession(sql, sid)
   ├─ McpServer (SDK) + tools/resource
   └─ Gọi tầng domain với user_id của Resolved_User
        ├─ search(sql, userId, q, includeHistorical, limit)   [fn_search_limited]
        ├─ canViewVersion(sql, userId, versionId)             [permission query]
        └─ đọc markdown_content + v_current_documents         [document_versions]
            ▼
         postgres.js pool (tái dùng, truyền từ server.ts)
```

### Luồng một yêu cầu MCP

1. nginx nhận yêu cầu tại `location /mcp`, xoá mọi header danh tính do client đặt,
   forward cookie `dcs_sid` xuống Fastify `127.0.0.1:3100`.
2. Route `/mcp` đọc cookie `dcs_sid`, gọi `request.unsignCookie(raw)` (cùng
   `config.sessionSecret` đã đăng ký ở plugin `@fastify/cookie`).
3. Nếu thiếu cookie, chữ ký không hợp lệ, hoặc `resolveSession` trả `null` →
   trả HTTP 401 ngay, không khởi tạo phiên MCP.
4. Nếu hợp lệ → có `SessionUser { user_id, ... }`. Tạo một `McpServer` + một
   transport Streamable HTTP **cho riêng yêu cầu này** (stateless), đăng ký các
   tool/resource đã bind `userId`, rồi chuyển request/response cho transport xử lý.
5. Mỗi lần tool/resource được gọi, handler dùng `userId` đã bind để gọi tầng
   domain. Kết quả được định dạng theo MCP và trả về client.

### Vì sao transport tạo mới mỗi yêu cầu (stateless)

SDK MCP TypeScript phiên bản 1.x có lỗ hổng rò rỉ trạng thái khi **tái dùng một
instance `StreamableHTTPServerTransport` cho nhiều yêu cầu từ nhiều client**:
ngữ cảnh xác thực và kết quả tool có thể lẫn giữa các phiên đồng thời
([GitHub Advisory GHSA-w2fm-25vw-vh7f](https://github.com/advisories/GHSA-w2fm-25vw-vh7f),
nội dung đã được tóm lược để tuân thủ giấy phép). DCS là đa người dùng nên thiết
kế **tạo một `McpServer` + transport mới cho mỗi yêu cầu** và đóng khi xong. Đây
cũng là lựa chọn an toàn nhất về cô lập danh tính: `userId` được "nướng" vào
closure của tool handler trong phạm vi một yêu cầu, không có trạng thái toàn cục
chia sẻ giữa người dùng.

Cấu hình transport dùng **stateless mode** (không quản lý `sessionId` của MCP, đặt
`sessionIdGenerator: undefined`), phù hợp mô hình "mỗi POST là một yêu cầu
JSON-RPC độc lập" và tránh phải giữ bản đồ transport theo phiên trong RAM.

### Cầu nối Fastify ↔ transport của SDK

`StreamableHTTPServerTransport.handleRequest(req, res, body)` của SDK nhận đối
tượng Node `IncomingMessage`/`ServerResponse` thô, không phải wrapper của Fastify.
Fastify phơi hai đối tượng này qua `request.raw` và `reply.raw`. Để tránh Fastify
tự gửi phản hồi song song với transport, route đánh dấu đã chiếm quyền gửi bằng
`reply.hijack()` trước khi trao `reply.raw` cho transport.

```typescript
// Phác thảo cầu nối (chi tiết đầy đủ ở phần Components).
app.post('/mcp', async (request, reply) => {
  const user = await resolveIdentity(sql, config, request); // 401 nếu null
  if (!user) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  const { server, transport } = buildMcpServer(sql, user.user_id);
  reply.hijack(); // Fastify nhả quyền; transport tự ghi vào reply.raw
  request.raw.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
});
```

Lưu ý: Fastify phải parse body JSON trước (mặc định đã bật cho
`application/json`), nên `request.body` đã sẵn sàng truyền làm tham số thứ ba.

### Stack & ràng buộc

- Node ≥ 20, TypeScript ESM. Dùng `node --import tsx` khi chạy test, `tsc` khi
  build (khớp `package.json` hiện có).
- Fastify 4.28, `@fastify/cookie` 9.4 (đã đăng ký với `secret: config.sessionSecret`).
- postgres.js 3.4 — **tái dùng** instance `sql` truyền vào, không mở pool mới.
- Bộ nhớ ~1 GB: tránh giữ trạng thái trong RAM; transport stateless, không cache.

## Components and Interfaces

### 1. `src/routes/mcp.ts` — `registerMcpRoutes`

Điểm vào duy nhất, khớp khuôn mẫu các `register*Routes` khác. Thêm vào
`src/server.ts` một dòng: `registerMcpRoutes(app, sql, config);`.

```typescript
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { Config } from '../config.js';

export function registerMcpRoutes(
  app: FastifyInstance,
  sql: Sql,
  config: Config,
): void;
```

Trách nhiệm: đăng ký route `POST /mcp` (và `GET /mcp` trả 405 hoặc 401 tuỳ chọn,
vì transport stateless không dùng kênh SSE server→client riêng), phân giải danh
tính, dựng `McpServer` theo yêu cầu, cầu nối transport.

### 2. Phân giải danh tính — `resolveIdentity`

Hàm nội bộ (không export ra ngoài module trừ khi cần test). Là nơi **duy nhất**
module MCP lấy người dùng; không có đường khác tạo `userId`.

```typescript
import { SESSION_COOKIE } from '../middleware/auth.js';   // 'dcs_sid'
import { resolveSession, type SessionUser } from '../domain/session.js';

async function resolveIdentity(
  sql: Sql,
  config: Config,
  request: FastifyRequest,
): Promise<SessionUser | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;                       // 2.3: thiếu identifier → 401
  const unsigned = request.unsignCookie(raw);  // cùng config.sessionSecret
  if (!unsigned.valid || !unsigned.value) return null;
  return resolveSession(sql, unsigned.value);  // 2.4: null → 401
}
```

Quyết định về cơ chế header tin cậy: **dùng chính cookie `dcs_sid` đã ký** làm
Session_Identifier, không thêm header danh tính mới. Lý do:

- Tái dùng nguyên lớp đã có: `@fastify/cookie` đã đăng ký với
  `config.sessionSecret`, nên `unsignCookie` dùng đúng secret mà không cần cấu
  hình thêm. `resolveSession` là đường phân giải phiên chuẩn của DCS.
- Giảm bề mặt tấn công: không phát sinh header `X-Dcs-Session` mới mà client có
  thể cố giả mạo. nginx chỉ cần forward cookie như hiện tại và **xoá** mọi header
  danh tính client tự đặt.

Cookie được ký HMAC bằng secret chỉ server biết; client không thể tự chế cookie
hợp lệ. Vì vậy cơ chế này đã đủ tin cậy mà không cần header riêng. (Nếu tương lai
muốn tách MCP sang host khác, có thể bổ sung header `X-Dcs-Session` mang
`session_id` do nginx đặt sau khi nó tự xác thực cookie — ghi nhận là hướng mở,
ngoài MVP.)

### 3. Dựng MCP server — `buildMcpServer`

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport }
  from '@modelcontextprotocol/sdk/server/streamableHttp.js';

function buildMcpServer(sql: Sql, userId: string): {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
} {
  const server = new McpServer({ name: 'dcs-mcp', version: '0.1.0' });
  registerSearchTool(server, sql, userId);
  registerGetMarkdownTool(server, sql, userId);
  registerDocumentResource(server, sql, userId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: mỗi POST độc lập
  });
  return { server, transport };
}
```

`userId` được truyền xuống và bind vào closure từng tool/resource, không lưu ở
biến toàn cục. Đây là điểm cốt lõi đảm bảo mọi truy vấn trong một yêu cầu dùng
đúng danh tính người gọi.

### 4. Hằng số giới hạn

```typescript
const DEFAULT_RESULT_LIMIT = 20; // Default_Result_Limit (6.1)
const MAXIMUM_RESULT_LIMIT = 50; // Maximum_Result_Limit (6.2)
const SNIPPET_CAP = 300;         // Snippet_Cap: 300 ký tự (6.3)
```

Chốt `Snippet_Cap = 300` ký tự: đủ để tác nhân AI đánh giá độ liên quan, đủ nhỏ
để một lần trả 50 kết quả vẫn gọn (tối đa ~15 KB snippet), phù hợp RAM hạn chế.

### 5. Hàm thuần (tách riêng để unit test không cần DB)

```typescript
/** Chuẩn hoá limit về [1, MAXIMUM_RESULT_LIMIT]; mặc định DEFAULT_RESULT_LIMIT. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RESULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAXIMUM_RESULT_LIMIT) return MAXIMUM_RESULT_LIMIT;
  return n;
}

/** Cắt snippet về tối đa SNIPPET_CAP ký tự; trả tiền tố của chuỗi gốc. */
export function capSnippet(s: string | null): string {
  if (!s) return '';
  return s.length <= SNIPPET_CAP ? s : s.slice(0, SNIPPET_CAP);
}
```

Hai hàm này export để test thuần (không cần DB).

### 6. Tool `search_documents`

Input schema (Zod):

```typescript
import { z } from 'zod';

const searchInput = {
  q: z.string().min(1).describe('Từ khoá tìm kiếm'),
  include_historical: z.boolean().optional()
    .describe('Bao gồm cả bản không còn hiệu lực mà bạn được phép xem'),
  limit: z.number().int().optional()
    .describe('Số kết quả tối đa (mặc định 20, trần 50)'),
};
```

Handler:

```typescript
server.registerTool('search_documents', { inputSchema: searchInput },
  async ({ q, include_historical, limit }) => {
    const hits = await search(
      sql,
      userId,                        // 3.1: user_id của Resolved_User
      q,
      include_historical ?? false,   // 3.3/3.4: cờ nguyên vẹn, mặc định false
      clampLimit(limit),             // 6.1/6.2
    );
    const rows = hits.map((h) => ({
      doc_id: h.doc_id,
      version_id: h.version_id,
      version_no: h.version_no,
      title: h.title,
      status: h.status,
      section_code: h.section_code,
      section_title: h.section_title,
      match_level: h.match_level,    // 3.5: document | section | fulltext
      rank: h.rank,
      snippet: capSnippet(h.snippet),// 6.3
    }));
    return {
      content: [{ type: 'text', text: formatSearchText(rows) }],
      structuredContent: { results: rows },
    };
  });
```

- Truyền thẳng kết quả `search` trả về (chỉ ánh xạ trường + cắt snippet + clamp số
  lượng). **Không** thêm bất kỳ bước lọc quyền nào sau truy vấn (3.2) — lọc đã nằm
  trong `fn_search_limited`.
- Trả cả `content` dạng text (dễ đọc cho model) lẫn `structuredContent` (máy đọc).

### 7. Tool `get_document_markdown`

Input: `{ doc_id: z.string().min(1) }`.

```typescript
server.registerTool('get_document_markdown', { inputSchema: { doc_id } },
  async ({ doc_id }) => {
    // Tra bản hiệu lực của doc_id.
    const cur = await sql<{ version_id: string }[]>`
      SELECT version_id FROM v_current_documents WHERE doc_id = ${doc_id}`;
    const versionId = cur[0]?.version_id;

    // Không có bản hiệu lực HOẶC ngoài phạm vi → phản hồi GIỐNG HỆT (4.2/4.3).
    if (!versionId) return notFound();
    const allowed = await canViewVersion(sql, userId, versionId); // 4.4
    if (!allowed) return notFound();

    const rows = await sql<{ markdown_content: string | null }[]>`
      SELECT markdown_content FROM document_versions
       WHERE version_id = ${versionId}`;
    const md = rows[0]?.markdown_content;
    if (md == null) return notFound(); // bản chưa có markdown → cũng không phân biệt
    return { content: [{ type: 'text', text: md }] };  // 4.1
  });
```

`notFound()` trả một kết quả cố định, không chứa nội dung tài liệu và không tiết
lộ liệu `doc_id` có tồn tại hay không:

```typescript
function notFound() {
  return {
    isError: true,
    content: [{ type: 'text',
      text: 'Không tìm thấy tài liệu khớp định danh, hoặc bạn không có quyền xem.' }],
  };
}
```

Thông điệp cố ý gộp hai khả năng ("không tồn tại" và "ngoài phạm vi") làm một để
không rò rỉ sự tồn tại (4.3).

### 8. Resource `dcs://document/{id}`

Dùng `ResourceTemplate` của SDK, cùng logic kiểm quyền với tool markdown để tránh
lệch hành vi:

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

server.registerResource(
  'document',
  new ResourceTemplate('dcs://document/{id}', { list: undefined }),
  { description: 'Nội dung Markdown bản hiệu lực của một tài liệu' },
  async (uri, { id }) => {
    const md = await readMarkdownIfAllowed(sql, userId, String(id));
    if (md == null) {
      // 5.3/5.4: ngoài phạm vi hoặc không tồn tại → lỗi không phân biệt.
      throw new Error('Không tìm thấy tài liệu khớp định danh, hoặc bạn không có quyền xem.');
    }
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: md }] };
  });
```

`readMarkdownIfAllowed` là hàm dùng chung cho cả tool `get_document_markdown` và
resource, trả `string` khi được phép và `null` cho mọi trường hợp khác (không
tồn tại, ngoài phạm vi, chưa có markdown). Một đường quyết định duy nhất ⇒ hai lối
đọc markdown không thể lệch nhau.

```typescript
async function readMarkdownIfAllowed(
  sql: Sql, userId: string, docId: string,
): Promise<string | null> {
  const cur = await sql<{ version_id: string }[]>`
    SELECT version_id FROM v_current_documents WHERE doc_id = ${docId}`;
  const versionId = cur[0]?.version_id;
  if (!versionId) return null;
  if (!(await canViewVersion(sql, userId, versionId))) return null; // 4.4/5.2
  const rows = await sql<{ markdown_content: string | null }[]>`
    SELECT markdown_content FROM document_versions WHERE version_id = ${versionId}`;
  return rows[0]?.markdown_content ?? null;
}
```

## Data Models

Module MCP không định nghĩa bảng mới. Nó chỉ đọc các cấu trúc đã có:

| Nguồn | Kiểu | Dùng cho |
|-------|------|----------|
| `fn_search_limited(user_id, q, include_historical, limit)` | hàm | `search_documents` (qua `domain/search.ts`) |
| `v_current_documents` | view | tra `version_id` bản hiệu lực theo `doc_id` |
| `document_versions.markdown_content` | cột TEXT (nullable) | nội dung Markdown toàn văn |
| `canViewVersion(sql, userId, versionId)` | hàm domain | kiểm quyền xem (lọc phạm vi) |

Các DTO trả về client:

```typescript
interface SearchResultItem {
  doc_id: string;
  version_id: string;
  version_no: string;
  title: string;
  status: string;
  section_code: string | null;
  section_title: string | null;
  match_level: string;    // 'document' | 'section' | 'fulltext'
  rank: number;
  snippet: string;        // đã cắt theo SNIPPET_CAP
}
```

Không đọc bảng embedding, không đọc `index_status` (Requirement 8).

## Error Handling

| Tình huống | Phản hồi |
|-----------|----------|
| Thiếu cookie `dcs_sid` | HTTP 401 trước khi khởi tạo MCP (2.3) |
| Cookie sai chữ ký | HTTP 401 (coi như vô danh) |
| `resolveSession` trả `null` (hết hạn / user ngừng hoạt động) | HTTP 401 (2.4) |
| `doc_id`/`id` không tồn tại | Thông điệp không-tìm-thấy chuẩn (4.3/5.4) |
| Tài liệu ngoài phạm vi (`canViewVersion=false`) | Thông điệp **giống hệt** trường hợp không tồn tại (4.3/5.4) |
| Bản hiệu lực chưa có `markdown_content` | Thông điệp không-tìm-thấy chuẩn (không phân biệt) |
| Lỗi DB bất ngờ | Trả MCP error content chung chung, ghi log phía server, không lộ chi tiết nội bộ |

Nguyên tắc: lỗi ở tool trả về MCP tool-result với `isError: true` (hoặc `throw`
cho resource) thay vì làm sập cả yêu cầu; thông điệp hướng người dùng, không chứa
dấu vết nội bộ. Lỗi xác thực (401) xử lý ở tầng HTTP trước khi vào MCP.

### Cấu hình nginx tương ứng (Requirement 1.4, 2.5)

Thêm một `location /mcp` vào `deploy/nginx-dcs.conf`, trước `location /`:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Chặn client ngoài tự đặt header danh tính: xoá trước khi forward (2.5).
    proxy_set_header X-Dcs-Session "";
    proxy_read_timeout 120s;
}
```

Danh tính chỉ đến từ cookie `dcs_sid` đã ký (client không giả được). Dòng
`proxy_set_header X-Dcs-Session ""` phòng xa trường hợp sau này dùng header danh
tính — hiện MVP không đọc header đó, nhưng xoá sẵn để không bị giả mạo.

Giả định `location /mcp` ở trên là app chạy ở root; nếu deploy dưới path con
(`config.basePath = /dcs`) thì `location` phải là `/dcs/mcp`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Mọi truy vấn domain dùng đúng danh tính người gọi

*For any* yêu cầu MCP đã xác thực (Resolved_User `u`) và *for any* chuỗi lời gọi
tool/resource trong yêu cầu đó, mọi lần gọi tầng domain (`search`,
`canViewVersion`, truy vấn `v_current_documents`/`document_versions`) đều nhận
`u.user_id`, và không tồn tại đường nào tạo ra một `userId` khác hoặc bỏ qua phân
quyền.

**Validates: Requirements 2.2, 2.6, 3.1, 4.4, 5.2**

### Property 2: Tham số tìm kiếm truyền nguyên vẹn với mặc định đúng

*For any* đầu vào `search_documents` có `q` và `include_historical` tuỳ chọn, lời
gọi `search` nhận đúng `q` và nhận `include_historical` khi được cung cấp; khi
`include_historical` vắng mặt, `search` nhận `false` (chỉ bản hiệu lực).

**Validates: Requirements 3.3, 3.4**

### Property 3: Không lọc lại kết quả sau truy vấn

*For any* danh sách kết quả mà `fn_search_limited`/`search` trả về, tập `doc_id`
trong output của `search_documents` bằng đúng tập `doc_id` do `search` trả về
(sau khi áp clamp số lượng) — Search_Tool không loại bỏ hay thêm mục nào bằng lọc
quyền phía sau.

**Validates: Requirements 3.2**

### Property 4: Không bao giờ trả nội dung khi không có quyền

*For any* `doc_id`/`id` mà `canViewVersion` trả `false` (hoặc không có bản hiệu
lực, hoặc bản hiệu lực không có markdown), cả tool `get_document_markdown` lẫn
resource `dcs://document/{id}` đều không trả về `markdown_content`; kết quả luôn
là phản hồi không-tìm-thấy/không-có-quyền.

**Validates: Requirements 4.2, 5.3**

### Property 5: Không phân biệt được tồn tại với ngoài phạm vi

*For any* hai trường hợp — (1) tài liệu không tồn tại và (2) tài liệu tồn tại
nhưng Resolved_User không có quyền xem — tool `get_document_markdown` sinh ra
phản hồi giống hệt nhau (cùng nội dung, cùng cờ `isError`), và resource
`dcs://document/{id}` sinh ra lỗi giống hệt nhau.

**Validates: Requirements 4.3, 5.4**

### Property 6: Giữ nguyên Match_Level của mỗi kết quả

*For any* kết quả tìm kiếm, `match_level` trong output bằng đúng `match_level` mà
`fn_search_limited` gán cho kết quả đó (giá trị thuộc `document`, `section`,
`fulltext`).

**Validates: Requirements 3.5**

### Property 7: Số kết quả luôn trong khoảng cho phép

*For any* giá trị `limit` do client truyền (kể cả vắng mặt, số âm, 0, hoặc lớn
hơn trần), số kết quả hiệu dụng `clampLimit(limit)` luôn nằm trong
`[1, Maximum_Result_Limit]`; khi `limit` vắng mặt nó bằng `Default_Result_Limit`;
khi `limit` vượt trần nó bằng `Maximum_Result_Limit`.

**Validates: Requirements 6.1, 6.2**

### Property 8: Snippet luôn bị cắt theo Snippet_Cap

*For any* chuỗi snippet đầu vào, kết quả `capSnippet` có độ dài không vượt quá
`Snippet_Cap` và là một tiền tố của chuỗi gốc.

**Validates: Requirements 6.3**

### Property 9: Phân giải danh tính là điều kiện cần của mọi yêu cầu

*For any* yêu cầu MCP không kèm Session_Identifier hợp lệ (thiếu cookie, sai chữ
ký, hoặc `resolveSession` trả `null`), hệ thống trả HTTP 401 và không gọi bất kỳ
tool/resource nào.

**Validates: Requirements 2.1, 2.3, 2.4**

## Testing Strategy

Dự án chạy test bằng `node --import tsx --test test/**/*.test.ts` (node:test +
`node:assert/strict`), không có framework PBT sẵn. Property test mô tả dưới đây
hiện thực bằng vòng lặp sinh đầu vào ngẫu nhiên trong node:test (tối thiểu 100 lần
lặp mỗi property), gắn nhãn theo định dạng
**Feature: dcs-mcp-server, Property {X}: {mô tả}**.

### Unit test thuần (không cần DB) — `test/domain/mcp.test.ts`

- **Property 7 — `clampLimit`**: sinh số nguyên ngẫu nhiên (bao gồm âm, 0, >50,
  rất lớn) và `undefined`; khẳng định `1 ≤ clampLimit(n) ≤ 50`, `clampLimit(undefined) = 20`,
  `clampLimit(n>50) = 50`.
- **Property 8 — `capSnippet`**: sinh chuỗi ngẫu nhiên độ dài biến thiên; khẳng
  định `capSnippet(s).length ≤ 300` và `s.startsWith(capSnippet(s))`.
- **Property 2, 3, 6 (tầng ánh xạ)**: inject một `search` giả (spy) trả danh sách
  `SearchHit` ngẫu nhiên; gọi handler `search_documents`:
  - Property 2: spy nhận `include_historical` nguyên vẹn, mặc định `false` khi vắng.
  - Property 3: tập `doc_id` output = tập `doc_id` spy trả về (sau clamp).
  - Property 6: mỗi phần tử giữ đúng `match_level`.
- **Property 4, 5 (logic không-tìm-thấy)**: inject `canViewVersion`/truy vấn giả;
  - Property 4: với `canViewVersion=false` hoặc không có bản hiệu lực → output
    không chứa markdown.
  - Property 5: so sánh output nhánh "không tồn tại" và nhánh "ngoài phạm vi" →
    giống hệt.
- **Property 9 / 401 (logic phân giải danh tính)**: `resolveIdentity` với
  `resolveSession` stub:
  - cookie vắng → `null` (→ 401), tool không được gọi.
  - `resolveSession` trả `null` → `null` (→ 401), tool không được gọi.
  - cookie ký hợp lệ + `resolveSession` trả user → trả đúng `SessionUser`.

  Để test thuần, `resolveIdentity`, `clampLimit`, `capSnippet` và các handler nhận
  dependency qua tham số (dependency injection) thay vì import cứng, giúp spy/stub
  mà không đụng DB.

### Integration test (cần DB) — `test/domain/mcp-permission.test.ts`

Phần phụ thuộc lọc quyền thực tế của `canViewVersion`, `v_current_documents`, và
`fn_search_limited` **cần một PostgreSQL có schema + seed** (giống các test quyền
hiện có như `viewer-permissions.test.ts`, `permission-matrix.uat.test.ts`). Ghi rõ
đây là phần cần DB:

- **Property 1 (end-to-end danh tính)**: với vài người dùng seed có phạm vi khác
  nhau, gọi `search_documents` và `get_document_markdown` → kết quả khớp đúng
  những gì người đó được phép thấy; đổi người dùng → kết quả đổi theo.
- **4.1 / 5.1 (đường thành công)**: user có quyền + doc có bản hiệu lực có
  `markdown_content` → tool/resource trả đúng nội dung.
- **4.2–4.3 / 5.3–5.4 (ngoài phạm vi vs không tồn tại trên dữ liệu thật)**: user
  không thuộc phạm vi của một doc tồn tại → phản hồi giống hệt với `doc_id` bịa.

Nếu môi trường CI không có DB, nhóm integration này skip có điều kiện (theo mẫu
`skip-domain.test.ts`), còn nhóm unit thuần luôn chạy.

### Smoke / review (ràng buộc kiến trúc)

- **1.1–1.4, 7.1**: khởi động app, gửi một yêu cầu `initialize` + `tools/list`
  tới `/mcp`; xác nhận đúng ba khả năng chỉ đọc (`search_documents`,
  `get_document_markdown`, resource `dcs://document/{id}`).
- **7.2, 8.1, 8.2**: review mã `src/routes/mcp.ts` — chỉ gọi hàm đọc, không câu
  lệnh write; không import/tham chiếu embedding hoặc `index_status` (có thể bổ
  sung một test `grep` khẳng định không có chuỗi `embedding`/`index_status` trong
  module).

## Dependencies

Thêm vào `package.json`:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.25.0",
    "@cfworker/json-schema": "4.1.1",
    "zod": "3.25.76"
  }
}
```

Ghi chú pin version:

- **`@modelcontextprotocol/sdk` ghim `1.25.0`** (dòng 1.x — hiện là bản khuyến
  nghị cho production; dòng v2 là bản ổn định mới nhưng đổi cấu trúc gói
  `@modelcontextprotocol/server` + `@modelcontextprotocol/node`). Dùng đường import
  `@modelcontextprotocol/sdk/server/mcp.js` và
  `@modelcontextprotocol/sdk/server/streamableHttp.js`. Ghim bản cụ thể để tránh
  kéo bản vá có thay đổi hành vi ngoài ý muốn; khi nâng cấp phải kiểm lại lỗ hổng
  rò rỉ trạng thái đã nêu ở phần Architecture. Trước khi chốt số phiên bản cuối
  trong `package.json`, xác nhận bản 1.x mới nhất còn nhận bản vá bảo mật.
- **`zod` ghim `3.25.76`** — SDK 1.x dùng Zod 3 cho schema công cụ. SDK `1.25.0`
  khai `peerDependencies` của `zod` là `"^3.25 || ^4.0"`, nên phải thoả range
  `^3.25`; bản `3.23.8` KHÔNG thoả. Ghim tuyệt đối `3.25.76` (một bản trong dòng
  `^3.25`) để vừa khớp peer range của SDK vừa tránh lệch kiểu. (SDK là peer của
  Zod; nếu `npm ls zod` báo lệch range thì khớp lại theo yêu cầu của SDK.)
- **`@cfworker/json-schema` ghim `4.1.1`** — đây là `peerDependencies` của MCP SDK
  `1.25.0` (`"@cfworker/json-schema": "^4.1.1"`). Cần cài tường minh để tránh cảnh
  báo/thiếu peer khi `npm install` trên máy đích (không Docker). Ghim `4.1.1` (nằm
  trong range `^4.1.1` của SDK).

Cân nhắc RAM ~1 GB: cả hai gói nhỏ, thuần JS, không có binary nặng; transport
stateless không giữ trạng thái theo phiên nên dấu chân bộ nhớ gần như không đổi so
với trước. Không dùng Docker nên cài trực tiếp qua `npm install` trên máy đích.

Lưu ý khớp quy ước hiện có: một số dependency trong `package.json` ghim tuyệt đối
(không có `^`), một số dùng `^`. Để an toàn với lỗ hổng đã nêu, ghim tuyệt đối hai
gói MCP/Zod.
