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
import { registerPrint, verifyToken, auditQrLookup } from '../domain/printing.js';

export function registerPrintingRoutes(app: FastifyInstance, sql: Sql): void {
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
      const body = (req.body ?? {}) as { location?: string };
      try {
        const rec = await registerPrint(sql, {
          versionId: req.params.id, printedBy: user.user_id, intendedLocation: body.location || null,
        });
        return reply.view('print-result.eta', { rec });
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );

  // Tra cứu QR — KHÔNG yêu cầu đăng nhập. Chỉ trả tình trạng.
  app.get<{ Params: { token: string } }>('/verify/:token', async (req, reply) => {
    const result = await verifyToken(sql, req.params.token);
    await auditQrLookup(sql, req.params.token);
    reply.type('text/html; charset=utf-8');
    return reply.view('verify.eta', { result });
  });
}
