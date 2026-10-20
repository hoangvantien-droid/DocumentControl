# Implementation Plan

## Overview

Bổ sung "Phát hành thêm site" cho Author trên trang Tình trạng ban hành. Tái dùng
`publishToSites` + `candidateSitesForScope`; thêm hàm domain gói quy tắc (chặn
sai nội dung, phát hành lại sai đăng ký). Không migration. Thứ tự: hàm phân loại
thuần (test được) → hàm domain ghi DB → route → view → kiểm chứng/build.

## Tasks

- [x] 1. Hàm phân loại site thuần (test không cần DB)
  - Trong `src/domain/receipt.ts`, thêm hàm thuần `classifySitesForRepublish(input)` nhận: danh sách `candidateSiteIds` (trong scope), danh sách receipt hiện có `[{site_id,status,response_type}]`, và `requestedSiteIds`.
  - Trả `{ newOnes: string[], republish: string[], skipped: string[], invalid: string[], blockedByContentReject: boolean }`:
    - `invalid` = requested không thuộc candidate (ngoài scope).
    - `blockedByContentReject` = true nếu bất kỳ receipt nào `tu_choi`+`sai_noi_dung`.
    - `newOnes` = requested hợp lệ chưa có receipt.
    - `republish` = requested hợp lệ có receipt `tu_choi`+`sai_dang_ky`.
    - `skipped` = requested hợp lệ nhưng `chap_nhan`/`cho_phan_hoi`/`tu_choi+sai_noi_dung`.
  - Thuần, không chạm DB; export để test trực tiếp.
  - _Requirements: 2.1, 2.2, 3.1, 4.1, 4.4_
  - _Properties: 1, 2, 3, 4_

- [x] 2. Hàm domain `publishAdditionalSites` (ghi DB)
  - Trong `src/domain/receipt.ts`, thêm `publishAdditionalSites(sql, { versionId, userId, siteIds })` chạy trong transaction.
  - Nạp version (khóa dòng) + scope từ `documents`; kiểm registrant (403 nếu sai) + `status==='da_ban_hanh'` (BusinessError nếu không).
  - `candidateSitesForScope(tx, scope)` -> dùng `classifySitesForRepublish` (Task 1) để phân loại.
  - Nếu `blockedByContentReject` -> BusinessError chặn, không ghi gì.
  - Nếu có `invalid` -> BusinessError (site ngoài scope).
  - `newOnes` -> `publishToSites(tx, {versionId, siteIds:newOnes, targetDeptId, actorUserId})`.
  - `republish` -> UPDATE receipt về `cho_phan_hoi` (response_type/note/responded_by/responded_at/apply_date = NULL, updated_at=now()).
  - Ghi audit `ban_hanh` với afterState phân biệt add vs re_publish. Trả `{added, republished}`.
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.3, 3.1, 4.1, 4.2, 4.3, 4.4, 6.1_
  - _Properties: 1, 2, 3, 4, 5, 6_

- [x] 3. Route GET issuance: bổ sung dữ liệu site có thể thêm
  - Trong `src/routes/documents.ts`, handler GET `/my-documents/:id/issuance`: đổi query version để JOIN `documents d` lấy `scope_level, scope_bu_id, scope_site_id, scope_dept_id`.
  - Tính `candidates = candidateSitesForScope(sql, scope)`; `addableNew` = candidate chưa có receipt; `republishable` = receipt `tu_choi`+`sai_dang_ky` (kèm site_code/name); `blockedByContentReject = hasContentReject`.
  - Truyền thêm `addableNew, republishable, blockedByContentReject` vào view. KHÔNG đổi kiểm registrant/403 hiện có.
  - _Requirements: 1.1, 5.1, 5.2, 5.3_

- [x] 4. Route POST `/my-documents/:id/publish-sites` (mới)
  - Trong `src/routes/documents.ts`: thêm handler POST; requireUser; đọc `site_ids` qua `normalizeSiteIds`.
  - Gọi `publishAdditionalSites(sql, { versionId: req.params.id, userId: user.user_id, siteIds })`.
  - try/catch BusinessError -> `sendBusinessError`; thành công -> redirect `/my-documents/:id/issuance`.
  - _Requirements: 1.2, 1.4, 2.2, 3.1, 4.1_

- [x] 5. View: khu "Phát hành thêm site" trên issuance-status.eta
  - Trong `src/views/issuance-status.eta`, thêm section "Phát hành thêm site".
  - IF `blockedByContentReject`: alert "Có site báo sai nội dung — phải thu hồi + ban hành bản mới", KHÔNG render form.
  - ELSE IF `addableNew` rỗng && `republishable` rỗng: ghi "Đã phát hành tới mọi site trong phạm vi".
  - ELSE: form `POST /my-documents/:id/publish-sites` với 2 nhóm checkbox: "Thêm site mới" (addableNew) và "Phát hành lại (đã từ chối sai đăng ký)" (republishable), nút "Phát hành".
  - Không đổi các hành động hiện có (Sửa/Thu hồi/Xóa). Không dùng `<%# %>`.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. Unit test hàm phân loại (Task 1)
  - Thêm test cho `classifySitesForRepublish` tại `test/domain/` (thuần, không DB), phủ: site ngoài scope -> invalid; có sai_noi_dung -> blocked; sai_dang_ky -> republish; chap_nhan/cho_phan_hoi -> skipped; chưa có receipt -> newOnes.
  - Chạy test pass.
  - _Properties: 1, 2, 3, 4_
  - _Requirements: 2.2, 3.1, 4.1, 4.4_

- [x] 7. Render test view (không cần DB)
  - Render `issuance-status.eta` 3 ca: blocked -> alert, không form; rỗng -> "đã phát hành tới mọi site"; có addableNew + republishable -> 2 nhóm checkbox, nhãn phân biệt.
  - _Properties: 3_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Build, chạy test, dọn dẹp
  - Compile toàn bộ `.eta` sạch; `npm run build` sạch; chạy test view hiện có + test mới (Task 6) pass.
  - Xác nhận không migration, không nới quyền (đọc lại route/domain). Dọn file tạm.
  - _Properties: 5, 6_
  - _Requirements: 6.1, 6.2, 6.3_

## Task Dependency Graph

Các "wave" chạy tuần tự; task trong cùng wave có thể làm song song.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "3"] },
    { "wave": 2, "tasks": ["2", "5", "6"] },
    { "wave": 3, "tasks": ["4", "7"] },
    { "wave": 4, "tasks": ["8"] }
  ],
  "dependencies": {
    "1": [],
    "2": ["1"],
    "3": [],
    "4": ["2", "3"],
    "5": ["3"],
    "6": ["1"],
    "7": ["5"],
    "8": ["4", "6", "7"]
  }
}
```

## Notes

- Không migration, không đổi schema/tên cột. Tái dùng `publishToSites`,
  `candidateSitesForScope`, event audit `ban_hanh` (không thêm enum).
- Kiểm quyền (registrant) đặt trong domain, nhất quán edit/recall/delete.
- Máy dev không có Postgres: verify compile + unit thuần + render + build; kiểm
  luồng ghi DB trên target.
- Deploy target: pull + build + restart. Không migrate.
