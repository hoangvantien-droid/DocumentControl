/**
 * src/routes/packages.ts — gói ban hành (T-078→T-081).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { canRegisterDocuments } from '../domain/permissions.js';
import {
  listPackages, packageMembers, createPackage, attachToPackage, movePackageDate, detachMember,
} from '../domain/package.js';

export function registerPackageRoutes(app: FastifyInstance, sql: Sql): void {
  /**
   * Cổng chặn: gói ban hành là việc của người Biên soạn (DC_AUTHOR). Chặn sớm ở
   * route để không lộ trang/endpoint cho người chỉ-xem (phòng thủ sâu — domain
   * vẫn kiểm chủ sở hữu từng thao tác). Trả về user nếu hợp lệ, null nếu đã gửi
   * phản hồi (chuyển hướng đăng nhập hoặc 403).
   */
  async function requireRegistrar(req: FastifyRequest, reply: FastifyReply) {
    const user = requireUser(req, reply);
    if (!user) return null;
    if (!(await canRegisterDocuments(sql, user.user_id))) {
      reply.code(403);
      reply.send('Không đủ thẩm quyền truy cập gói ban hành');
      return null;
    }
    return user;
  }

  app.get('/packages', async (req, reply) => {
    const user = await requireRegistrar(req, reply);
    if (!user) return reply;
    const packages = await listPackages(sql);
    const membersByPkg: Record<string, Awaited<ReturnType<typeof packageMembers>>> = {};
    for (const p of packages) membersByPkg[p.package_id] = await packageMembers(sql, p.package_id);
    // Đăng ký của tôi chưa thuộc gói và có ngày riêng — để gắn vào gói.
    const attachable = await sql`
      SELECT version_id, doc_id, version_no, title
        FROM document_versions
       WHERE registrant_user_id = ${user.user_id}
         AND package_id IS NULL AND status IN ('cho_xac_nhan','da_dang_ky')
       ORDER BY doc_id`;
    return reply.view('packages.eta', { packages, membersByPkg, attachable, error: null });
  });

  app.post<{ Body: Record<string, string> }>('/packages', async (req, reply) => {
    const user = await requireRegistrar(req, reply);
    if (!user) return reply;
    try {
      await createPackage(sql, {
        code: ((req.body ?? {}).code ?? '').trim(),
        title: ((req.body ?? {}).title ?? '').trim(),
        effectiveDate: (req.body ?? {}).effective_date ?? '',
        createdBy: user.user_id,
      });
      return reply.redirect('/packages');
    } catch (err) {
      if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
      throw err;
    }
  });

  app.post<{ Body: Record<string, string> }>('/packages/attach', async (req, reply) => {
    const user = await requireRegistrar(req, reply);
    if (!user) return reply;
    try {
      await attachToPackage(sql, {
        versionId: (req.body ?? {}).version_id ?? '', packageId: (req.body ?? {}).package_id ?? '', userId: user.user_id,
      });
      return reply.redirect('/packages');
    } catch (err) {
      if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
      throw err;
    }
  });

  app.post<{ Body: Record<string, string> }>('/packages/move-date', async (req, reply) => {
    const user = await requireRegistrar(req, reply);
    if (!user) return reply;
    try {
      await movePackageDate(sql, {
        packageId: (req.body ?? {}).package_id ?? '', newDate: (req.body ?? {}).effective_date ?? '', userId: user.user_id,
      });
      return reply.redirect('/packages');
    } catch (err) {
      if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
      throw err;
    }
  });

  app.post<{ Body: Record<string, string> }>('/packages/detach', async (req, reply) => {
    const user = await requireRegistrar(req, reply);
    if (!user) return reply;
    try {
      await detachMember(sql, {
        versionId: (req.body ?? {}).version_id ?? '', reason: (req.body ?? {}).reason ?? '', userId: user.user_id,
      });
      return reply.redirect('/packages');
    } catch (err) {
      if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
      throw err;
    }
  });
}
