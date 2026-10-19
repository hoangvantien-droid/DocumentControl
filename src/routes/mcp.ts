/**
 * src/routes/mcp.ts — máy chủ MCP nhúng (DCS_MCP_Server).
 *
 * Phơi điểm cuối `/mcp` (Streamable HTTP) cho tác nhân AI truy vấn kho tài liệu
 * ở chế độ CHỈ ĐỌC, luôn lọc quyền theo `user_id` thật của phiên. Toàn bộ logic
 * nghiệp vụ tái dùng các hàm domain đã có; module này chỉ phân giải danh tính,
 * ánh xạ yêu cầu MCP sang hàm domain, và định dạng kết quả theo giao thức MCP.
 *
 * File được xây dần theo các task: hiện tại mới có phần hằng số giới hạn và hai
 * hàm thuần (`clampLimit`, `capSnippet`) — tách riêng để unit test không cần DB.
 * Các phần `resolveIdentity`, `buildMcpServer`, `registerMcpRoutes` và các
 * tool/resource sẽ được bổ sung ở các task sau.
 */

// === Hằng số giới hạn khối lượng kết quả (Requirement 6) ===

/** Số kết quả trả về mặc định khi client không chỉ định `limit` (6.1). */
const DEFAULT_RESULT_LIMIT = 20; // Default_Result_Limit
/** Trần số kết quả tối đa trong một lần gọi (6.2). */
const MAXIMUM_RESULT_LIMIT = 50; // Maximum_Result_Limit
/** Giới hạn độ dài đoạn trích (snippet) của mỗi kết quả: 300 ký tự (6.3). */
const SNIPPET_CAP = 300; // Snippet_Cap

// === Hàm thuần (tách riêng để unit test không cần DB) ===

/**
 * Chuẩn hoá `limit` về khoảng `[1, MAXIMUM_RESULT_LIMIT]`.
 * - `undefined` hoặc giá trị không hữu hạn → `DEFAULT_RESULT_LIMIT`.
 * - Làm tròn xuống; dưới 1 → 1; vượt trần → `MAXIMUM_RESULT_LIMIT`.
 */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RESULT_LIMIT;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > MAXIMUM_RESULT_LIMIT) return MAXIMUM_RESULT_LIMIT;
  return n;
}

/**
 * Cắt snippet về tối đa `SNIPPET_CAP` ký tự; kết quả luôn là tiền tố của chuỗi
 * gốc. Trả `''` khi đầu vào là `null`.
 */
export function capSnippet(s: string | null): string {
  if (!s) return '';
  return s.length <= SNIPPET_CAP ? s : s.slice(0, SNIPPET_CAP);
}

// === Phân giải danh tính (Requirement 2) ===

import type { FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import type { Config } from '../config.js';
import { SESSION_COOKIE } from '../middleware/auth.js'; // 'dcs_sid'
import { resolveSession, type SessionUser } from '../domain/session.js';

/**
 * Phụ thuộc có thể tiêm (dependency injection) cho `resolveIdentity`.
 *
 * Mặc định dùng `resolveSession` thật; unit test (Property 9, task 3.2) có thể
 * truyền một bản stub để kiểm chứng logic phân giải mà không chạm DB. Phần
 * `unsignCookie` không nằm ở đây vì nó là method của chính `request`, nên test
 * chỉ cần truyền một `request` giả có `.cookies` và `.unsignCookie`.
 */
export interface ResolveIdentityDeps {
  /** Tra phiên còn hạn và trả `SessionUser`, hoặc `null`. */
  resolveSession: (
    sql: Sql,
    sessionId: string,
  ) => Promise<SessionUser | null>;
}

/** Phụ thuộc thật mặc định. */
const defaultResolveIdentityDeps: ResolveIdentityDeps = { resolveSession };

/**
 * Phân giải danh tính người gọi từ cookie phiên đã ký — nơi DUY NHẤT module MCP
 * lấy `userId`. Không có đường nào khác tạo danh tính.
 *
 * Trả `null` (caller sẽ chuyển thành HTTP 401) trong mọi trường hợp không xác
 * thực được:
 * - Thiếu cookie `dcs_sid` (2.3: thiếu Session_Identifier).
 * - Chữ ký cookie không hợp lệ hoặc không có giá trị (coi như vô danh).
 * - `resolveSession` trả `null`: phiên hết hạn hoặc người dùng đã ngừng hoạt
 *   động (2.4).
 *
 * `request.unsignCookie` dùng đúng `config.sessionSecret` đã đăng ký ở plugin
 * `@fastify/cookie`, nên không cần tự xác minh HMAC. Tham số `config` giữ đúng
 * chữ ký thiết kế và sẵn sàng cho mở rộng tương lai (vd header danh tính riêng).
 *
 * @param deps Phụ thuộc tiêm được (mặc định `resolveSession` thật) để stub trong test.
 */
export async function resolveIdentity(
  sql: Sql,
  config: Config,
  request: FastifyRequest,
  deps: ResolveIdentityDeps = defaultResolveIdentityDeps,
): Promise<SessionUser | null> {
  void config; // Secret dùng ngầm qua request.unsignCookie; giữ tham số theo thiết kế.
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null; // 2.3: thiếu Session_Identifier → 401
  const unsigned = request.unsignCookie(raw); // cùng config.sessionSecret
  if (!unsigned.valid || !unsigned.value) return null; // chữ ký sai → vô danh → 401
  return deps.resolveSession(sql, unsigned.value); // 2.4: null → 401
}

// === Dựng MCP server, tool và resource (Requirement 1, 3, 4, 5) ===

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { search as defaultSearch, type SearchHit } from '../domain/search.js';
import { canViewVersion as defaultCanViewVersion } from '../domain/catalog.js';

/**
 * DTO một kết quả tìm kiếm trả về client MCP. Ánh xạ 1-1 từ `SearchHit`, chỉ
 * khác ở `snippet` đã được cắt theo `SNIPPET_CAP`.
 */
export interface SearchResultItem {
  doc_id: string;
  version_id: string;
  version_no: string;
  title: string;
  status: string;
  section_code: string | null;
  section_title: string | null;
  match_level: string; // 'document' | 'section' | 'fulltext'
  rank: number;
  snippet: string; // đã cắt theo SNIPPET_CAP
}

/**
 * Thông điệp cố định cho trường hợp "không tìm thấy HOẶC không có quyền". Cố ý
 * gộp hai khả năng (không tồn tại vs ngoài phạm vi) làm một để không rò rỉ sự
 * tồn tại của tài liệu (Requirement 4.3, 5.4).
 */
const NOT_FOUND_MESSAGE =
  'Không tìm thấy tài liệu khớp định danh, hoặc bạn không có quyền xem.';

/**
 * Kết quả tool chuẩn cho trường hợp không-tìm-thấy/không-có-quyền. Không chứa
 * nội dung tài liệu và không phân biệt tồn tại vs ngoài phạm vi (Requirement
 * 4.2, 4.3). Dùng chung cho `get_document_markdown` để mọi nhánh từ chối phản
 * hồi giống hệt nhau.
 */
export function notFound(): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: NOT_FOUND_MESSAGE }],
  };
}

/**
 * Ánh xạ danh sách `SearchHit` (do tầng domain trả về) sang danh sách DTO trả
 * cho client. CHỈ ánh xạ trường + cắt snippet; KHÔNG lọc lại, KHÔNG thêm/bớt
 * phần tử (Requirement 3.2) — lọc quyền đã nằm trong `fn_search_limited`. Giữ
 * nguyên `match_level` của từng kết quả (Requirement 3.5). Tách hàm riêng để
 * unit test tầng ánh xạ (task 5.2) không cần MCP server thật.
 */
export function mapSearchHits(hits: SearchHit[]): SearchResultItem[] {
  return hits.map((h) => ({
    doc_id: h.doc_id,
    version_id: h.version_id,
    version_no: h.version_no,
    title: h.title,
    status: h.status,
    section_code: h.section_code,
    section_title: h.section_title,
    match_level: h.match_level, // 3.5: giữ nguyên document | section | fulltext
    rank: h.rank,
    snippet: capSnippet(h.snippet), // 6.3
  }));
}

/**
 * Định dạng kết quả tìm kiếm thành văn bản dễ đọc cho mô hình. Trả cùng dữ liệu
 * với `structuredContent` nhưng ở dạng text gọn, mỗi kết quả một khối.
 */
export function formatSearchText(rows: SearchResultItem[]): string {
  if (rows.length === 0) return 'Không có kết quả nào khớp.';
  return rows
    .map((r, i) => {
      const section = r.section_code
        ? ` · mục ${r.section_code}${r.section_title ? ` (${r.section_title})` : ''}`
        : '';
      return [
        `${i + 1}. [${r.match_level}] ${r.title} — ${r.doc_id} v${r.version_no} (${r.status})${section}`,
        r.snippet ? `   ${r.snippet}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

/**
 * Hàm dùng chung cho cả tool `get_document_markdown` lẫn resource
 * `dcs://document/{id}`: trả nội dung Markdown bản hiệu lực của một tài liệu
 * KHI VÀ CHỈ KHI người gọi được phép xem; mọi trường hợp khác (không tồn tại,
 * ngoài phạm vi, chưa có markdown) đều trả `null`. Một đường quyết định duy
 * nhất ⇒ hai lối đọc markdown không thể lệch nhau (Requirement 4, 5).
 *
 * Chỉ thực hiện truy vấn ĐỌC: `v_current_documents`, `canViewVersion`,
 * `document_versions`. Không chạm write, không đọc embedding/index_status
 * (Requirement 8).
 *
 * Nhận `canViewVersion` qua tham số (mặc định hàm thật) để unit test (task 6.2)
 * stub được mà không cần DB.
 */
export async function readMarkdownIfAllowed(
  sql: Sql,
  userId: string,
  docId: string,
  canViewVersion: (
    sql: Sql,
    userId: string,
    versionId: string,
  ) => Promise<boolean> = defaultCanViewVersion,
): Promise<string | null> {
  // Tra bản hiệu lực của doc_id.
  const cur = await sql<{ version_id: string }[]>`
    SELECT version_id FROM v_current_documents WHERE doc_id = ${docId}`;
  const versionId = cur[0]?.version_id;
  if (!versionId) return null; // không có bản hiệu lực → null
  if (!(await canViewVersion(sql, userId, versionId))) return null; // 4.4/5.2: ngoài phạm vi → null
  const rows = await sql<{ markdown_content: string | null }[]>`
    SELECT markdown_content FROM document_versions WHERE version_id = ${versionId}`;
  return rows[0]?.markdown_content ?? null; // chưa có markdown → null
}

/**
 * Đăng ký tool `search_documents`. Lọc quyền hoàn toàn nằm trong tầng domain
 * (`fn_search_limited`); tool chỉ truyền tham số nguyên vẹn, clamp số lượng, ánh
 * xạ kết quả và cắt snippet.
 *
 * `userId` được bind vào closure của handler (không biến toàn cục). Nhận `search`
 * qua tham số (mặc định hàm thật) để unit test tầng ánh xạ (task 5.2).
 */
export function registerSearchTool(
  server: McpServer,
  sql: Sql,
  userId: string,
  search: (
    sql: Sql,
    userId: string,
    q: string,
    includeHistorical: boolean,
    filters?: import('../domain/search.js').SearchFilters,
    limit?: number,
  ) => Promise<SearchHit[]> = defaultSearch,
): void {
  const inputSchema = {
    q: z.string().min(1).describe('Từ khoá tìm kiếm'),
    include_historical: z
      .boolean()
      .optional()
      .describe('Bao gồm cả bản không còn hiệu lực mà bạn được phép xem'),
    limit: z
      .number()
      .int()
      .optional()
      .describe('Số kết quả tối đa (mặc định 20, trần 50)'),
  };

  server.registerTool(
    'search_documents',
    {
      title: 'Tìm kiếm tài liệu',
      description:
        'Tìm kiếm tài liệu trong phạm vi quyền của bạn (chỉ đọc). Trả về danh ' +
        'sách kết quả kèm đoạn trích.',
      inputSchema,
    },
    async ({ q, include_historical, limit }) => {
      const hits = await search(
        sql,
        userId, // 3.1: user_id của Resolved_User
        q,
        include_historical ?? false, // 3.3/3.4: cờ nguyên vẹn, mặc định false
        {}, // AI search không dùng bộ lọc đa chiều của UI
        clampLimit(limit), // 6.1/6.2
      );
      const results = mapSearchHits(hits); // 3.2/3.5/6.3: ánh xạ, không lọc lại
      return {
        content: [{ type: 'text', text: formatSearchText(results) }],
        structuredContent: { results },
      };
    },
  );
}

/**
 * Đăng ký tool `get_document_markdown`. Trả nội dung Markdown bản hiệu lực của
 * một tài liệu khi người gọi có quyền; mọi trường hợp khác trả `notFound()`
 * giống hệt nhau (không rò rỉ sự tồn tại).
 *
 * `userId` bind vào closure; nhận `canViewVersion` qua tham số để test được.
 */
export function registerGetMarkdownTool(
  server: McpServer,
  sql: Sql,
  userId: string,
  canViewVersion: (
    sql: Sql,
    userId: string,
    versionId: string,
  ) => Promise<boolean> = defaultCanViewVersion,
): void {
  const inputSchema = {
    doc_id: z.string().min(1).describe('Số hiệu / định danh tài liệu'),
  };

  server.registerTool(
    'get_document_markdown',
    {
      title: 'Lấy nội dung Markdown của tài liệu',
      description:
        'Trả nội dung Markdown bản hiệu lực của một tài liệu nếu bạn có quyền ' +
        'xem (chỉ đọc).',
      inputSchema,
    },
    async ({ doc_id }) => {
      const md = await readMarkdownIfAllowed(sql, userId, doc_id, canViewVersion);
      if (md == null) return notFound(); // 4.2/4.3: không phân biệt tồn tại vs ngoài phạm vi
      return { content: [{ type: 'text', text: md }] }; // 4.1
    },
  );
}

/**
 * Đăng ký resource `dcs://document/{id}`. Cùng đường quyết định với tool
 * markdown (qua `readMarkdownIfAllowed`) nên hai lối không thể lệch hành vi.
 * Khi không được phép → `throw` với thông điệp GIỐNG HỆT tool (Requirement
 * 5.3/5.4). `list: undefined` vì không liệt kê toàn bộ tài liệu qua resource.
 *
 * `userId` bind vào closure; nhận `canViewVersion` qua tham số để test được.
 */
export function registerDocumentResource(
  server: McpServer,
  sql: Sql,
  userId: string,
  canViewVersion: (
    sql: Sql,
    userId: string,
    versionId: string,
  ) => Promise<boolean> = defaultCanViewVersion,
): void {
  server.registerResource(
    'document',
    new ResourceTemplate('dcs://document/{id}', { list: undefined }),
    { description: 'Nội dung Markdown bản hiệu lực của một tài liệu' },
    async (uri, { id }) => {
      const md = await readMarkdownIfAllowed(sql, userId, String(id), canViewVersion);
      if (md == null) {
        // 5.3/5.4: ngoài phạm vi hoặc không tồn tại → lỗi không phân biệt.
        throw new Error(NOT_FOUND_MESSAGE);
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: md }],
      };
    },
  );
}

/**
 * Dựng một `McpServer` + transport Streamable HTTP MỚI cho riêng một yêu cầu
 * (stateless). `userId` được bind vào closure từng tool/resource, không lưu ở
 * biến toàn cục — đây là điểm cốt lõi đảm bảo mọi truy vấn trong một yêu cầu
 * dùng đúng danh tính người gọi (Requirement 1.3, 2.2).
 */
export function buildMcpServer(
  sql: Sql,
  userId: string,
): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = new McpServer({ name: 'dcs-mcp', version: '0.1.0' });
  registerSearchTool(server, sql, userId);
  registerGetMarkdownTool(server, sql, userId);
  registerDocumentResource(server, sql, userId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: mỗi POST là một yêu cầu độc lập
  });
  return { server, transport };
}

/**
 * Điểm vào duy nhất của module — khớp khuôn mẫu `register*Routes` khác. Đăng ký:
 * - `POST /mcp`: phân giải danh tính; `null` → HTTP 401 (không khởi tạo MCP).
 *   Hợp lệ → dựng server theo yêu cầu, cầu nối transport với `request.raw` /
 *   `reply.raw` sau khi `reply.hijack()`, đóng transport + server khi kết nối
 *   đóng.
 * - `GET /mcp`: transport stateless không dùng kênh SSE server→client, trả 405.
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  sql: Sql,
  config: Config,
): void {
  app.post('/mcp', async (request, reply) => {
    const user = await resolveIdentity(sql, config, request);
    if (!user) {
      // 2.3/2.4: thiếu/không hợp lệ danh tính → 401, không khởi tạo MCP.
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const { server, transport } = buildMcpServer(sql, user.user_id);
    // Fastify nhả quyền gửi; transport tự ghi thẳng vào reply.raw.
    reply.hijack();
    // Đóng transport + server khi kết nối đóng để không giữ trạng thái trong RAM.
    request.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // Stateless: không có kênh SSE server→client riêng → không hỗ trợ GET.
  app.get('/mcp', async (_request, reply) => {
    reply.code(405).send({ error: 'method_not_allowed' });
  });
}
