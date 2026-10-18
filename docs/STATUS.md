# DCS — Trạng thái deploy & task còn treo

Ngày: 2026-10-18 (giờ VN). Production: `/opt/dcs`. Source: `/home/tao/webserver-tienhv/www/DocumentControl`.
Repo: `git@github.com:hoangvantien-droid/DocumentControl.git`, branch `main`.

## 1. Trạng thái hiện tại

- Commit production: `91fb6ed` — "feat: embedded read-only MCP server for AI document access"
- Source repo: `91fb6ed`, `behind=0 ahead=0` so với `origin/main`
- Production: `behind=0 ahead=0` (vừa pull xong)
- Service `dcs.service`: `active`, `healthz` 200
- DB `dcs_prod`: 16 migration đã chạy (001 → 016, gồm `016_fulltext_markdown.sql`)
- `package.json` version `0.2.0`
- `npm run test:unit`: 105 pass, 0 fail (chạy 2026-10-18)
- UAT final report đã có trong repo: `docs/DCS_UAT_Final_Report.pdf` (414 pass, 0 fail, 56 skip)

## 2. Việc đã xong ngày 2026-10-18

1. Pull `/opt/dcs` từ `55c4deb` lên `91fb6ed` (9 commit), khớp GitHub.
2. `npm install` + `npm run build` OK.
3. Sửa DB user `dcs`: `rolpassword` trong postgres bị set thành literal `********`
   (8 ký tự) nên mọi kết nối password đều `28P01`. Đã `ALTER USER dcs WITH PASSWORD`
   đúng password trong `/etc/dcs/.env` → auth OK. Nguyên nhân ai set literal còn
   chưa rõ — cần theo dõi, nếu tái diễn phải tìm script nào ghi đè.
4. Chạy migration `016_fulltext_markdown.sql` (thêm `markdown_content`,
   `fulltext_tsv` + GIN index + viết lại view `v_search_index`).
5. Restart `dcs.service` → active, healthz 200.

## 3. Task còn treo

### T1. Ba cột approval_* "thiếu" — cần chốt chủ trương (không phải bug chắc chắn)
- Hiện tượng: `document_versions` trong prod KHÔNG có `approval_method`,
  `approver_name`, `approval_reference`, dù migration 001 có định nghĩa.
- Nguyên nhân: migration `010_drop_approval_fields.sql` đã DROP 4 cột
  (`approver_name`, `approval_reference`, `approval_url`, `approval_method`) một
  cách có chủ ý, kèm viết lại trigger `fn_validate_version` (bỏ ép
  `approval_reference`) và view `v_current_documents`. Code
  `src/domain/registration.ts` (C.2.1) cũng ghi rõ "đã bỏ quản lý phê duyệt".
- Việc cần làm: chốt một trong hai — (a) công nhận đã bỏ phê duyệt, đóng task;
  (b) nếu vẫn cần 3 cột thì viết migration 017 add-back + sửa trigger/view/code.
- File liên quan: `src/db/migrations/001_schema.sql`,
  `src/db/migrations/010_drop_approval_fields.sql`, `src/domain/registration.ts`.

### T2. `npm test` full — 4 fail AI-01/02/03/14 cần tái hiện
- Ghi nhận cũ (memory 2026-10-17): 4 fail do mock provider mismatch, gom sửa 1 lần.
- Kiểm tra 2026-10-18: `npm run test:unit` 105 pass 0 fail; grep `AI-0` trong
  `test/` không còn match (chỉ còn chữ "AI" chung chung trong `mcp.test.ts` và
  `http.uat.test.ts`); không tìm thấy file mock provider nào trong `src/`, `test/`.
- Việc cần làm: chạy `npm test` full trên máy có DB test (`DATABASE_URL_TEST`
  trỏ DB chứa chữ "test") để tái hiện 4 fail, rồi sửa mock hoặc test cho khớp.
- Lệnh: `npm test`, `npm run test:uat`, `npm run test:constraints`.

### T3. `scripts/demo-seed.sh` fail — file không còn trong repo
- Ghi nhận cũ: fail do JSON parse response rỗng.
- Kiểm tra 2026-10-18: thư mục `scripts/` chỉ còn `create-admin.mjs`,
  `preview.mjs`; grep `demo-seed` toàn repo không match.
- Việc cần làm: hoặc tìm lại file (trong backup/history), hoặc xóa task nếu seed
  đã được thay bằng `create-admin.mjs` / UAT seed khác.

### T4. Port 20129 — process `/proxy.py` lạ vẫn nghe
- Kiểm tra 2026-10-18: `172.17.0.1:20129` LISTEN, PID 1399882,
  `python -u /proxy.py`, chạy từ 16/10. Không thuộc DCS, không có trong repo.
- Việc cần làm: xác định chủ (`/proxy.py` là gì, ai chạy), rồi giữ hoặc kill.
  Không tự kill vì chưa rõ owner.

### T5. `memory_search` lỗi embedding provider — thuộc OpenClaw, không thuộc DCS
- Ghi nhận cũ trong memory OpenClaw. Không có code/docs nào trong repo DCS liên
  quan. Tách ra khỏi backlog DCS, xử lý bên OpenClaw.

### T6. Homepage card ColdChain chưa có
- Ghi nhận cũ: card ColdChain trên homepage chưa được thêm.
- Việc cần làm: xác định homepage nào (tienhv.io.vn landing hay DCS home),
  thêm card/link ColdChain.

### T7. File untracked trong production — ĐÃ XONG (2026-10-18)
- Đã commit 3 file UAT seed vào repo: `scripts/uat/seed_uat.js`,
  `scripts/uat/seed_uat.sql`, `scripts/uat/uat_workflow.js`.
- File gốc trong `/opt/dcs` giữ nguyên (production vẫn dùng được).

### T8. README dòng "Chưa verify" — ĐÃ XONG (2026-10-18)
- Đã sửa README mục "Trạng thái": thay dòng "Chưa verify" bằng kết quả verify
  thật (test:unit 105 pass, UAT 414 pass, prod 16 migration) + link `docs/STATUS.md`.

## 4. Không còn treo

- Push DCS lên GitHub: xong (source khớp `origin/main`).
- Production behind 9 commit: xong (đã pull + redeploy + migrate + restart).
