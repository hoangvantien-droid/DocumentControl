/**
 * src/routes/printing.ts — in bản kiểm soát + tra cứu QR (T-085, T-086).
 *
 * /verify/:token là route DUY NHẤT không yêu cầu đăng nhập (DCS-7 §7.5) — người
 * ở chuyền quét bằng điện thoại. Chỉ trả tình trạng, thiết kế cho màn hình nhỏ.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { sendBusinessError } from '../lib/http-errors.js';
import { registerPrint, verifyToken, auditQrLookup, recallPrintedCopy } from '../domain/printing.js';

export function registerPrintingRoutes(app: FastifyInstance, sql: Sql, config: { basePath: string; publicUrl: string }): void {
  // In bản kiểm soát — cần đăng nhập.
  app.post<{ Params: { id: string }; Body: { location?: string } }>(
    '/documents/:id/print',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      // BUG-002: req.body có thể là undefined (POST không có body / content-type
      // không phải form hay multipart). Đọc req.body.location trực tiếp khi đó
      // ném "Cannot read properties of undefined" -> 500 trước cả khi vào
      // registerPrint. Đọc phòng thủ để mọi lần in đều đi đúng luồng nghiệp vụ.
      const body = (req.body ?? {}) as { location?: string; site_id?: string };
      try {
        const rec = await registerPrint(sql, {
          versionId: req.params.id, printedBy: user.user_id, intendedLocation: body.location || null,
          basePath: config.basePath, publicUrl: config.publicUrl,
        });
        return reply.view('print-result.eta', { rec });
      } catch (err) {
        if (isBusinessError(err)) return sendBusinessError(req, reply, err);
        throw err;
      }
    },
  );

  // Thu hồi một bản sao in cụ thể tại hiện trường (cần đăng nhập + quyền xem bản).
  app.post<{ Params: { id: string }; Body: { print_id?: string } }>(
    '/documents/:id/print/recall',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      const printId = ((req.body ?? {}) as { print_id?: string }).print_id ?? '';
      try {
        await recallPrintedCopy(sql, { printId, userId: user.user_id });
        return reply.redirect(`/documents/${req.params.id}`);
      } catch (err) {
        if (isBusinessError(err)) return sendBusinessError(req, reply, err);
        throw err;
      }
    },
  );

  // Tra cứu QR — KHÔNG yêu cầu đăng nhập. Chỉ trả tình trạng. Hỗ trợ ?site_id= để trả theo site.
  app.get<{ Params: { token: string }; Querystring: { site_id?: string } }>('/verify/:token', async (req, reply) => {
    const siteId = ((req.query as { site_id?: string }).site_id ?? '').trim() || null;
    const result = await verifyToken(sql, req.params.token, siteId);
    await auditQrLookup(sql, req.params.token);
    reply.type('text/html; charset=utf-8');
    return reply.view('verify.eta', { result });
  });
}
