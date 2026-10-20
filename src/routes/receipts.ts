/**
 * src/routes/receipts.ts — DC Site phản hồi receipt (Task 4).
 *
 * Hàng chờ phản hồi của site + màn phản hồi (chấp nhận / từ chối). Kiểm quyền
 * đặt ở domain (receipt.ts); route chỉ điều phối và bắt BusinessError.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { sendBusinessError, sendOk } from '../lib/http-errors.js';
import { siteIdsWithDocControl } from '../domain/permissions.js';
import {
  pendingReceiptsForSites, recalledDocsForSites, loadReceiptForView,
  acceptReceipt, rejectReceipt, type RejectType,
} from '../domain/receipt.js';
import { loadDetail, loadSections } from '../domain/catalog.js';

export function registerReceiptRoutes(app: FastifyInstance, sql: Sql): void {
  // Hàng chờ phản hồi của site (chỉ DC Site).
  app.get('/site-receipts', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const siteIds = [...await siteIdsWithDocControl(sql, user.user_id)];
    if (siteIds.length === 0) {
      return reply.view('site-receipts.eta', { rows: [], notControl: true, recalledDocs: [] });
    }
    const [rows, recalledDocs] = await Promise.all([
      pendingReceiptsForSites(sql, siteIds),
      recalledDocsForSites(sql, siteIds),
    ]);
    return reply.view('site-receipts.eta', { rows, notControl: false, recalledDocs });
  });

  // Màn phản hồi một receipt.
  app.get<{ Params: { id: string } }>('/site-receipts/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const r = await loadReceiptForView(sql, req.params.id);
    if (!r) { reply.code(404); return reply.send('Không tìm thấy receipt'); }
    const siteIds = await siteIdsWithDocControl(sql, user.user_id);
    if (!siteIds.has(r.site_id)) {
      reply.code(403); return reply.send('Không đủ thẩm quyền phản hồi receipt của site này');
    }
    const selfRegistered = r.registrant_user_id === user.user_id;
    const [detail, sections] = await Promise.all([
      loadDetail(sql, r.version_id), loadSections(sql, r.version_id),
    ]);
    return reply.view('receipt-respond.eta', { r, detail, sections, selfRegistered, error: null });
  });

  // Chấp nhận.
  app.post<{ Params: { id: string } }>('/site-receipts/:id/accept', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    try {
      await acceptReceipt(sql, { receiptId: req.params.id, userId: user.user_id });
      return sendOk(req, reply, '/site-receipts');
    } catch (err) {
      if (isBusinessError(err)) return sendBusinessError(req, reply, err);
      throw err;
    }
  });

  // Từ chối (loại sai_dang_ky | sai_noi_dung + lý do bắt buộc).
  app.post<{ Params: { id: string }; Body: { reject_type?: string; note?: string } }>(
    '/site-receipts/:id/reject',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      const rejectType = (req.body ?? {}).reject_type as RejectType;
      if (rejectType !== 'sai_dang_ky' && rejectType !== 'sai_noi_dung') {
        reply.code(400); return reply.send('Loại từ chối không hợp lệ');
      }
      try {
        await rejectReceipt(sql, {
          receiptId: req.params.id, userId: user.user_id,
          rejectType, note: (req.body ?? {}).note ?? '',
        });
        return sendOk(req, reply, '/site-receipts');
      } catch (err) {
        if (isBusinessError(err)) return sendBusinessError(req, reply, err);
        throw err;
      }
    },
  );
}
