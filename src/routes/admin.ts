/**
 * src/routes/admin.ts — quản trị tổ chức, người dùng, vai trò (giai đoạn 1).
 * Route MỎNG: gọi domain. Màn hình này CÓ HẠN SỬ DỤNG, gỡ khi L1 lên (DCS-7 §7.4).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError, BusinessError } from '../lib/errors.js';
import { sendBusinessError } from '../lib/http-errors.js';
import {
  listBu, listSites, listDepartments, createBu, createSite, addSiteBu, createDepartment,
} from '../domain/org.js';
import {
  listUsers, createUser, setUserActive, assignToDepartment, removeFromDepartment, departmentsOfUser,
} from '../domain/users.js';
import { grantRole, rolesOfUser, type RoleCode, type ScopeLevel } from '../domain/roles.js';
import { hasSystemAdminAccess } from '../domain/permissions.js';

/** Lấy field bắt buộc từ body, ném lỗi nếu thiếu — thoả noUncheckedIndexedAccess. */
function reqField(body: Record<string, string>, name: string): string {
  const v = (body ?? {})[name];
  if (v === undefined || v === '') {
    throw new BusinessError('form.missing', `Thiếu trường bắt buộc: ${name}`);
  }
  return v;
}

async function requireSystemAdmin(req: FastifyRequest, reply: FastifyReply, sql: Sql): Promise<boolean> {
  const user = requireUser(req, reply);
  if (!user) return false;
  if (!await hasSystemAdminAccess(sql, user.user_id)) {
    reply.code(403);
    reply.send('Không đủ quyền quản trị hệ thống');
    return false;
  }
  return true;
}

export function registerAdminRoutes(app: FastifyInstance, sql: Sql): void {
  // ---- Tổ chức (T-013) ----
  app.get('/admin/org', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    const [bus, sites, depts] = await Promise.all([
      listBu(sql), listSites(sql), listDepartments(sql),
    ]);
    return reply.view('admin/org.eta', { user: req.currentUser, bus, sites, depts, error: null });
  });

  app.post<{ Body: Record<string, string> }>('/admin/org/bu', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await createBu(sql, ((req.body ?? {}).code ?? '').trim(), ((req.body ?? {}).name ?? '').trim());
    return reply.redirect('/admin/org');
  });

  app.post<{ Body: Record<string, string> }>('/admin/org/site', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await createSite(sql, ((req.body ?? {}).code ?? '').trim(), ((req.body ?? {}).name ?? '').trim(), reqField(req.body, 'bu_id'));
    return reply.redirect('/admin/org');
  });

  app.post<{ Body: Record<string, string> }>('/admin/org/site-bu', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await addSiteBu(sql, reqField(req.body, 'site_id'), reqField(req.body, 'bu_id'));
    return reply.redirect('/admin/org');
  });

  app.post<{ Body: Record<string, string> }>('/admin/org/dept', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await createDepartment(sql, ((req.body ?? {}).code ?? '').trim(), ((req.body ?? {}).name ?? '').trim(), reqField(req.body, 'site_id'));
    return reply.redirect('/admin/org');
  });

  // ---- Người dùng (T-014) ----
  app.get('/admin/users', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    const [users, depts] = await Promise.all([listUsers(sql), listDepartments(sql)]);
    const deptsByUser: Record<string, string[]> = {};
    for (const u of users) deptsByUser[u.user_id] = await departmentsOfUser(sql, u.user_id);
    return reply.view('admin/users.eta', {
      user: req.currentUser, users, depts, deptsByUser, error: null,
    });
  });

  app.post<{ Body: Record<string, string> }>('/admin/users', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    try {
      await createUser(sql, {
        email: ((req.body ?? {}).email ?? '').trim(),
        fullName: ((req.body ?? {}).full_name ?? '').trim(),
        password: (req.body ?? {}).password ?? '',
      });
      return reply.redirect('/admin/users');
    } catch (err) {
      if (isBusinessError(err)) {
        const [users, depts] = await Promise.all([listUsers(sql), listDepartments(sql)]);
        reply.code(err.httpStatus);
        return reply.view('admin/users.eta', {
          user: req.currentUser, users, depts, deptsByUser: {}, error: err.message,
        });
      }
      throw err;
    }
  });

  app.post<{ Body: Record<string, string> }>('/admin/users/assign-dept', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await assignToDepartment(sql, reqField(req.body, 'user_id'), reqField(req.body, 'dept_id'));
    return reply.redirect('/admin/users');
  });

  // P1 #9: Xóa (soft) phòng ban của user — thêm nút × từng chip.
  app.post<{ Body: Record<string, string> }>('/admin/users/remove-dept', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await removeFromDepartment(sql, reqField(req.body, 'user_id'), reqField(req.body, 'dept_id'));
    return reply.redirect('/admin/users');
  });

  app.post<{ Body: Record<string, string> }>('/admin/users/active', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await setUserActive(sql, reqField(req.body, 'user_id'), (req.body ?? {}).active === 'true');
    return reply.redirect('/admin/users');
  });

  // Lỗi #10: xoá mềm user (is_active=false) — không xoá cứng để giữ audit.
  app.post<{ Body: Record<string, string> }>('/admin/users/delete', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    const userId = reqField(req.body, 'user_id');
    if (userId === req.currentUser?.user_id) {
      reply.code(422);
      reply.send('Không thể tự xoá tài khoản đang đăng nhập');
      return reply;
    }
    await setUserActive(sql, userId, false);
    return reply.redirect('/admin/users');
  });

  // ---- Vai trò theo phạm vi (T-015) ----
  app.get('/admin/roles', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    const [users, bus, sites, depts] = await Promise.all([
      listUsers(sql), listBu(sql), listSites(sql), listDepartments(sql),
    ]);
    const rolesByUser: Record<string, Awaited<ReturnType<typeof rolesOfUser>>> = {};
    for (const u of users) rolesByUser[u.user_id] = await rolesOfUser(sql, u.user_id);
    return reply.view('admin/roles.eta', {
      user: req.currentUser, users, bus, sites, depts, rolesByUser, error: null,
    });
  });

  app.post<{ Body: Record<string, string> }>('/admin/roles', async (req, reply) => {
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    try {
      await grantRole(sql, {
        userId: reqField(req.body, 'user_id'),
        role: reqField(req.body, 'role_code') as RoleCode,
        scope: {
          level: ((req.body ?? {}).scope_level ?? 'group') as ScopeLevel,
          buId: (req.body ?? {}).scope_bu_id || null,
          siteId: (req.body ?? {}).scope_site_id || null,
          deptId: (req.body ?? {}).scope_dept_id || null,
        },
        grantedBy: req.currentUser?.user_id,
      });
      return reply.redirect('/admin/roles');
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });
}
