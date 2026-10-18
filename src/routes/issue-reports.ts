/**
 * src/routes/issue-reports.ts — report bất thường (Reader) + thẩm định (DC Site).
 *
 * Reader gửi report từ màn chi tiết tài liệu (POST /documents/:id/report).
 * DC Site xem hộp report của site (/issue-reports) và thẩm định từng report.
 */
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { requireUser } from '../middleware/auth.js';
import { isBusinessError } from '../lib/errors.js';
import { siteIdsWithDocControl } from '../domain/permissions.js';
import {
  createIssueReport, pendingReportsForSites,
  convertReportToRejection, dismissReport,
} from '../domain/issue-report.js';
import type { RejectType } from '../domain/receipt.js';

export function registerIssueReportRoutes(app: FastifyInstance, sql: Sql): void {
  // Reader gửi report bất thường về một phiên bản.
  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/documents/:id/report',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      try {
        await createIssueReport(sql, {
          versionId: req.params.id, userId: user.user_id, note: req.body.note ?? '',
        });
        return reply.redirect(`/documents/${req.params.id}`);
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );

  // Hộp report của site (DC Site).
  app.get('/issue-reports', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const siteIds = [...await siteIdsWithDocControl(sql, user.user_id)];
    if (siteIds.length === 0) {
      return reply.view('issue-reports.eta', { reports: [], notControl: true });
    }
    const reports = await pendingReportsForSites(sql, siteIds);
    return reply.view('issue-reports.eta', { reports, notControl: false });
  });

  // Chuyển report thành từ chối receipt.
  app.post<{ Params: { id: string }; Body: { reject_type?: string; note?: string } }>(
    '/issue-reports/:id/convert',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      const rejectType = req.body.reject_type as RejectType;
      if (rejectType !== 'sai_dang_ky' && rejectType !== 'sai_noi_dung') {
        reply.code(400); return reply.send('Loại từ chối không hợp lệ');
      }
      try {
        await convertReportToRejection(sql, {
          reportId: req.params.id, userId: user.user_id,
          rejectType, note: req.body.note ?? '',
        });
        return reply.redirect('/issue-reports');
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );

  // Bác bỏ report.
  app.post<{ Params: { id: string }; Body: { review_note?: string } }>(
    '/issue-reports/:id/dismiss',
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return reply;
      try {
        await dismissReport(sql, {
          reportId: req.params.id, userId: user.user_id, reviewNote: req.body.review_note ?? '',
        });
        return reply.redirect('/issue-reports');
      } catch (err) {
        if (isBusinessError(err)) { reply.code(err.httpStatus); return reply.send(err.message); }
        throw err;
      }
    },
  );
}
