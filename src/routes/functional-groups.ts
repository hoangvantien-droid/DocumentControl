/**
 * src/routes/functional-groups.ts — nhóm chức năng (T-067, T-068).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import {
  listGroups, createGroup, addMember, removeMember, membersOf, staleMembers,
} from '../domain/functional-groups.js';
import { listUsers } from '../domain/users.js';
import { hasSystemAdminAccess } from '../domain/permissions.js';

async function requireSystemAdmin(req: FastifyRequest, reply: FastifyReply, sql: Sql): Promise<boolean> {
  const user = requireUser(req, reply);
  if (!user) return false;
  if (!await hasSystemAdminAccess(sql, user.user_id)) {
    reply.code(403);
    reply.send('Không đủ quyền quản trị nhóm chức năng');
    return false;
  }
  return true;
}

export function registerFunctionalGroupRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/functional-groups', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    const [groups, users, stale] = await Promise.all([
      listGroups(sql), listUsers(sql), staleMembers(sql),
    ]);
    const membersByGroup: Record<string, Awaited<ReturnType<typeof membersOf>>> = {};
    for (const g of groups) membersByGroup[g.group_id] = await membersOf(sql, g.group_id);
    return reply.view('functional-groups.eta', { groups, users, stale, membersByGroup, error: null });
  });

  app.post<{ Body: Record<string, string> }>('/functional-groups', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    try {
      await createGroup(sql, {
        code: (req.body.code ?? '').trim(),
        name: (req.body.name ?? '').trim(),
        ownerUserId: req.body.owner_user_id ?? '',
      });
      return reply.redirect('/functional-groups');
    } catch (err) {
      if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
      throw err;
    }
  });

  app.post<{ Body: Record<string, string> }>('/functional-groups/members/add', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await addMember(sql, req.body.group_id ?? '', req.body.user_id ?? '', user.user_id);
    return reply.redirect('/functional-groups');
  });

  app.post<{ Body: Record<string, string> }>('/functional-groups/members/remove', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    if (!await requireSystemAdmin(req, reply, sql)) return reply;
    await removeMember(sql, req.body.group_id ?? '', req.body.user_id ?? '');
    return reply.redirect('/functional-groups');
  });
}
