/**
 * src/routes/search.ts — ô tìm gợi ý (htmx) + trang kết quả + lọc đa chiều (T-056..T-058).
 *
 * /search        : trang kết quả đầy đủ (rail lọc + danh sách).
 * /search/results: mảnh htmx (danh sách + đếm) để lọc tức thì, không rời trang.
 * /search/suggest: gợi ý nhanh cho ô tìm trên thanh điều hướng.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { search, suggest, type SearchFilters } from '../domain/search.js';
import { listBu, listSites, listDepartments } from '../domain/org.js';
import { writeAudit } from '../lib/audit.js';

interface SearchQuery {
  q?: string;
  historical?: string;
  doc_type?: string | string[];
  origin?: string;
  scope_level?: string;
  eff_from?: string;
  eff_to?: string;
  match_level?: string | string[];
  sort?: string;
  bu_id?: string;
  site_id?: string;
  dept_id?: string;
}

function asArray(v?: string | string[]): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Gom querystring -> state dùng chung cho cả trang và mảnh htmx. */
function parseState(query: SearchQuery) {
  const q = (query.q ?? '').trim();
  const includeHistorical = query.historical === '1';
  const docTypes = asArray(query.doc_type);
  const matchLevels = asArray(query.match_level);
  const origin = (query.origin ?? '').trim();
  const scopeLevel = (query.scope_level ?? '').trim();
  const effFrom = (query.eff_from ?? '').trim();
  const effTo = (query.eff_to ?? '').trim();
  const sort = (query.sort ?? '').trim();
  const buId = (query.bu_id ?? '').trim();
  const siteId = (query.site_id ?? '').trim();
  const deptId = (query.dept_id ?? '').trim();
  const filters: SearchFilters = { docTypes, matchLevels, origin, scopeLevel, effFrom, effTo, sort, buId, siteId, deptId };
  // f: phản chiếu trạng thái về view (giữ trên URL, dựng chip).
  const f = { q, includeHistorical, docTypes, matchLevels, origin, scopeLevel, effFrom, effTo, sort, buId, siteId, deptId };
  return { q, includeHistorical, filters, f };
}

/** Nhãn người đọc cho BU/Site/Dept đang chọn (để dựng chip). Chỉ truy vấn khi
 *  có ít nhất một đơn vị được chọn — tránh 3 truy vấn thừa khi không lọc. */
async function resolveScopeNames(
  sql: Sql,
  f: { buId: string; siteId: string; deptId: string },
): Promise<{ bu: string | null; site: string | null; dept: string | null }> {
  const out = { bu: null as string | null, site: null as string | null, dept: null as string | null };
  if (!f.buId && !f.siteId && !f.deptId) return out;
  const [bus, sites, depts] = await Promise.all([listBu(sql), listSites(sql), listDepartments(sql)]);
  if (f.buId) { const b = bus.find((x) => x.bu_id === f.buId); if (b) out.bu = b.bu_code + ' — ' + b.name; }
  if (f.siteId) { const x = sites.find((y) => y.site_id === f.siteId); if (x) out.site = x.site_code + ' — ' + x.name; }
  if (f.deptId) { const d = depts.find((y) => y.dept_id === f.deptId); if (d) out.dept = d.dept_code + ' — ' + d.name; }
  return out;
}

export function registerSearchRoutes(app: FastifyInstance, sql: Sql): void {
  // Gợi ý nhanh cho ô tìm ở thanh trên — trả HTML mảnh cho htmx.
  app.get<{ Querystring: { q?: string } }>('/search/suggest', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const hits = await suggest(sql, user.user_id, req.query.q ?? '');
    return reply.view('search-suggest.eta', { hits });
  });

  // Mảnh kết quả cho lọc tức thì (htmx). Không ghi audit (tránh nhiễu nhật ký).
  app.get<{ Querystring: SearchQuery }>('/search/results', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { q, includeHistorical, filters, f } = parseState(req.query);
    const hits = q ? await search(sql, user.user_id, q, includeHistorical, filters) : [];
    const scopeNames = await resolveScopeNames(sql, f);
    return reply.view('search-results-list.eta', { q, hits, f, scopeNames });
  });

  // Trang kết quả đầy đủ. Công tắc bản lịch sử mặc định tắt (REQ-K06).
  app.get<{ Querystring: SearchQuery }>('/search', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { q, includeHistorical, filters, f } = parseState(req.query);
    const [hits, bus, sites, depts] = await Promise.all([
      q ? search(sql, user.user_id, q, includeHistorical, filters) : Promise.resolve([]),
      listBu(sql), listSites(sql), listDepartments(sql),
    ]);
    if (q) {
      await sql.begin(async (tx) => {
        await writeAudit(tx as never, {
          eventType: 'tim_kiem', actorUserId: user.user_id,
          objectType: 'search', objectId: q.slice(0, 64),
          context: { q, includeHistorical, filters, hits: hits.length },
        });
      });
    }
    const b = bus.find((x) => x.bu_id === f.buId);
    const st = sites.find((x) => x.site_id === f.siteId);
    const dp = depts.find((x) => x.dept_id === f.deptId);
    const scopeNames = {
      bu: b ? b.bu_code + ' — ' + b.name : null,
      site: st ? st.site_code + ' — ' + st.name : null,
      dept: dp ? dp.dept_code + ' — ' + dp.name : null,
    };
    return reply.view('search-results.eta', { q, hits, includeHistorical, f, bus, sites, depts, scopeNames });
  });
}
