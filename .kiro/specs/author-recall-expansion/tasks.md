# Implementation Plan

## Overview

Mở quyền thu hồi Author (bỏ chặn recall.locked) + kiểm soát: màn thu hồi hiện tác
động, ghi vết đậm, và nhắc in-app Mức A cho DC Site (mọi site có receipt). Không
migration, không kênh notification mới.

## Tasks

- [x] 1. Domain: bỏ chặn recall.locked + ghi vết đậm
  - `src/domain/receipt.ts` `recallByAuthor`: BỎ khối `if (accepted > 0 && rejected === 0) throw recall.locked`.
  - Mở rộng truy vấn đếm thành accepted/rejected/pending/total; lấy danh sách site_id có receipt.
  - writeAudit `thu_hoi` afterState kèm: reason, tally {accepted,rejected,pending,total}, affected_site_ids.
  - GIỮ: kiểm status==='da_ban_hanh', lý do bắt buộc, loadOwnedVersion (registrant/403).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2_
  - _Properties: 1, 2, 3_

- [x] 2. Domain: recalledDocsForSites
  - `src/domain/receipt.ts`: thêm `recalledDocsForSites(sql, siteIds: string[]): Promise<RecalledDocRow[]>`.
  - siteIds rỗng -> []. SELECT DISTINCT version_id/doc_id/version_no/title/recall_reason/updated_at FROM document_versions v JOIN document_receipt r ... WHERE v.status='thu_hoi' AND r.site_id = ANY(siteIds::uuid[]) ORDER BY v.updated_at DESC.
  - Export RecalledDocRow.
  - _Requirements: 4.1, 4.2, 4.5_
  - _Properties: 4_

- [x] 3. Route recall GET: truyền tally vào view
  - `src/routes/documents.ts` GET `/my-documents/:id/recall`: thêm `const tally = await receiptTally(sql, v.version_id);` truyền `{ v, tally, error: null }`. POST không đổi.
  - _Requirements: 2.1_

- [x] 4. Route /site-receipts: thêm recalledDocs
  - `src/routes/receipts.ts` GET `/site-receipts`: sau khi có siteIds, `const recalledDocs = await recalledDocsForSites(sql, siteIds);` truyền vào view; nhánh notControl -> recalledDocs: [].
  - Import recalledDocsForSites.
  - _Requirements: 4.1, 4.4_

- [x] 5. View author-recall.eta: hiển thị tác động
  - Thêm dòng số liệu tác động (accepted/rejected/pending/total) + banner cảnh báo khi tally.accepted>0 (gợi ý ra bản mới). Giữ banner hướng dẫn + form lý do.
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 6. View site-receipts.eta: mục "Tài liệu bị thu hồi"
  - Thêm section CHỈ-ĐỌC bảng recalledDocs (Số hiệu+phiên bản / Tiêu đề / Lý do thu hồi / Thu hồi lúc); rỗng -> thông báo. KHÔNG nút/form. Không `<%# %>`.
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Properties: 5_

- [x] 7. Render + SQL test (không DB)
  - Render author-recall.eta: accepted>0 -> banner; =0 -> không; luôn có dòng số liệu.
  - Render site-receipts.eta: recalledDocs có -> bảng (không nút); rỗng -> thông báo.
  - SQL tĩnh: recallByAuthor không còn 'recall.locked'; recalledDocsForSites chứa status='thu_hoi' + ANY(siteIds).
  - _Requirements: 2.1, 2.2, 4.1, 4.3_
  - _Properties: 1, 4, 5_

- [x] 8. Build, test, dọn dẹp
  - Compile .eta sạch; `npm run build` sạch; test view hiện có pass.
  - Đọc lại xác nhận: không migration; không hạ tầng notification; accept/reject/đăng ký/xem xét không đổi; quyền xem không nới.
  - Dọn file tạm.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Properties: 6_

## Task Dependency Graph

Các "wave" chạy tuần tự; task trong cùng wave có thể làm song song.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["4", "5"] },
    { "wave": 3, "tasks": ["6"] },
    { "wave": 4, "tasks": ["7"] },
    { "wave": 5, "tasks": ["8"] }
  ],
  "dependencies": {
    "1": [],
    "2": [],
    "3": [],
    "4": ["2"],
    "5": ["3"],
    "6": ["4"],
    "7": ["5", "6"],
    "8": ["7"]
  }
}
```

## Notes

- Không migration, không kênh notification mới; nhắc là hiển thị dẫn xuất.
- Tái dùng receiptTally, alert-banner.eta, trang site-receipts.
- Máy dev không có Postgres: verify compile + render + SQL tĩnh + build; kiểm
  luồng DB (thu hồi, nhắc) trên target.
