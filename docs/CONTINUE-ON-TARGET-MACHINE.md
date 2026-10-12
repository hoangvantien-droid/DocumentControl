# Việc còn lại cần làm trên máy đích (cần PostgreSQL)

Tài liệu này mô tả **4 mục chưa hoàn tất** của đợt thay đổi "phân quyền Reader + sửa bug Author + dọn menu/dead code + dọn 2 cột DB lỗi thời". Phần code đã xong và đã build sạch (`npm run build`), test không-cần-DB đã xanh (171/171). 4 mục dưới đây **bắt buộc có PostgreSQL** nên chưa chạy được trên máy phát triển ban đầu.

> Ngữ cảnh cho AI đọc tài liệu này: repo là DCS (Document Control System), Fastify + Eta templates + PostgreSQL, UI tiếng Việt. Mô hình 3 vai trò: `DC_ADMIN` (Admin), `DC_AUTHOR` (Biên soạn), `DC_DEPT_HEAD` (Phê duyệt). Scripts: `npm run build` (tsc), `npm test` (`node --test test/**/*.test.ts`), `npm run test:unit` (`test/domain/**`), `npm run migrate` (`tsx src/db/migrate.ts`). Node >= 20.

---

## Bối cảnh thay đổi đã thực hiện (để hiểu vì sao cần verify)

- **A — Reader chỉ xem tài liệu hiện hành**: người chỉ-xem (`isReadOnly = !canRegister && !canRelease && !isAdmin`) chỉ thấy tài liệu `status IN ('hieu_luc','da_dang_ky')`. Mở trực tiếp bản lỗi thời → redirect về bản hiện hành của cùng `doc_id`, không có thì 404. File: `src/domain/permissions.ts`, `src/domain/catalog.ts`, `src/routes/catalog.ts`, `src/middleware/nav.ts`.
- **B — Bug phân quyền duyệt**: `canRelease` nhánh tài liệu cấp `group` giờ **chỉ `DC_ADMIN`** (chống leo thang: migration 013 đã gộp Site QA/BU/Group owner cũ thành `DC_DEPT_HEAD@group`). File: `src/domain/permissions.ts` (`canUserRelease`, `canRelease`).
- **C — Xóa 5 mục**: Hỏi đáp (`/qa`), Trưng bày thành phần (`/design`), Chất lượng nạp (`/ops/quality`), Mức độ sử dụng (`/ops/usage`), Kiểm tra dữ liệu nhập (`/data-check`).
- **D — Nhãn/thuật ngữ**: thống nhất "Xác nhận"; `/functional-groups` chỉ Admin; vá phòng thủ `/packages`.
- **E — Dọn 2 cột DB lỗi thời**: `applicable_site_ids`, `required_reader_dept_ids` → migration `src/db/migrations/014_drop_legacy_columns.sql`.

Phần loại trừ (KHÔNG làm trong đợt này — để đợt sau): nhóm rollout-theo-site (QR không mang site, in không xét rollout, thu hồi không đồng bộ rollout, ack bỏ qua rollout, `isDraftingDept` quyền rộng).

---

## Chuẩn bị: dựng PostgreSQL

`.env` hiện trỏ:
```
DATABASE_URL=postgres://dcs:dcs@localhost:5432/dcs_dev
DATABASE_URL_TEST=postgres://dcs:dcs@localhost:5432/dcs_test
```

Dựng Postgres (chọn một cách), tạo role `dcs`/mật khẩu `dcs` và 2 database `dcs_dev`, `dcs_test`:

```sql
CREATE ROLE dcs LOGIN PASSWORD 'dcs';
CREATE DATABASE dcs_dev OWNER dcs;
CREATE DATABASE dcs_test OWNER dcs;
```

Hoặc Docker:
```bash
docker run --name dcs-pg -e POSTGRES_USER=dcs -e POSTGRES_PASSWORD=dcs -e POSTGRES_DB=dcs_dev -p 5432:5432 -d postgres:16
# tạo thêm dcs_test:
docker exec -it dcs-pg psql -U dcs -d dcs_dev -c "CREATE DATABASE dcs_test OWNER dcs;"
```

Sau khi cài phụ thuộc:
```bash
npm install
npm rebuild argon2   # module native cho hashing mật khẩu (xem Mục 4)
```

---

## Mục 1 — Chạy migration (áp schema, gồm migration 014)

**Mục tiêu**: áp toàn bộ migration lên `dcs_dev`, đặc biệt migration mới `014_drop_legacy_columns.sql` (DROP 2 cột lỗi thời + viết lại view `v_current_documents`).

**Rủi ro**: đây là thay đổi schema (DROP COLUMN). Chỉ chạy trên DB dev/test, KHÔNG chạy trên production trước khi đã verify.

**Các bước**:
1. Chạy:
   ```bash
   npm run migrate
   ```
2. Kết quả mong đợi: runner in danh sách migration đã chạy, kết thúc "Xong. Đã chạy N migration". Migration `014_drop_legacy_columns.sql` phải nằm trong danh sách "đã chạy" (nếu DB mới) hoặc đã có trong `schema_migrations`.
3. **Verify schema** sau migration (dùng psql hoặc script):
   ```sql
   -- 2 cột phải KHÔNG còn tồn tại:
   SELECT column_name FROM information_schema.columns
    WHERE table_name = 'document_versions'
      AND column_name IN ('applicable_site_ids','required_reader_dept_ids');
   -- → phải trả 0 dòng.

   -- View v_current_documents phải tồn tại và KHÔNG chứa 2 cột đó:
   SELECT * FROM v_current_documents LIMIT 1;
   -- → chạy không lỗi; không có cột applicable_site_ids / required_reader_dept_ids.
   ```
4. Nếu migration lỗi: đọc thông báo. Khả năng cao nhất là DB đã có schema cũ nhưng thiếu các migration trung gian (006–013). Runner tự chạy theo thứ tự số và bỏ qua file đã có trong `schema_migrations`, nên chạy lại an toàn.

**Tiêu chí hoàn thành**: `npm run migrate` chạy hết không lỗi; 2 cột đã biến mất; `v_current_documents` truy vấn được.

---

## Mục 2 — Chạy bộ test ràng buộc DB (`constraints.test.ts`)

**Mục tiêu**: `test/constraints.test.ts` kiểm 16 ràng buộc nghiệp vụ ở tầng PostgreSQL (CHECK, trigger, unique index có điều kiện). Bộ này **tự dựng lại DB test** nên cần `DATABASE_URL_TEST`.

**Lưu ý an toàn**: bộ test này xoá sạch và dựng lại DB trỏ bởi `DATABASE_URL_TEST`. Biến này BẮT BUỘC có chữ "test" trong tên (test tự chặn nếu không). TUYỆT ĐỐI không trỏ vào DB thật.

**Các bước**:
1. Chạy riêng bộ constraints (PowerShell):
   ```powershell
   $env:DATABASE_URL_TEST="postgres://dcs:dcs@localhost:5432/dcs_test"; node --import tsx --test test/constraints.test.ts
   ```
   (bash: `DATABASE_URL_TEST=postgres://dcs:dcs@localhost:5432/dcs_test node --import tsx --test test/constraints.test.ts`)
2. Hoặc chạy toàn bộ test (gồm cả unit + views + constraints):
   ```powershell
   $env:DATABASE_URL_TEST="postgres://dcs:dcs@localhost:5432/dcs_test"; npm test
   ```
3. Kết quả mong đợi: `pass` = tổng số, `fail 0`.

**Nếu fail vì migration 014**: bộ constraints dựng schema bằng cách nào (chạy tuần tự tất cả migration hay nạp một snapshot) — kiểm phần `before()` trong `test/constraints.test.ts`. Nếu nó chạy tuần tự migration thì 014 áp tự nhiên. Nếu nó nạp riêng `001_schema.sql` thì 2 cột vẫn còn trong DB test (001 tạo chúng) — điều này KHÔNG sai, chỉ nghĩa là test không phản ánh trạng thái sau-014. Khi đó: xác nhận không có assertion nào của constraints phụ thuộc vào việc 2 cột đã bị bỏ (chúng không nên — 2 cột này không có ràng buộc nghiệp vụ nào). Nếu có test gãy do thiếu/thừa 2 cột, báo lại — rất có thể cần điều chỉnh cách `before()` áp migration.

**Tiêu chí hoàn thành**: `constraints.test.ts` xanh (fail 0), hoặc nếu có fail thì xác định rõ nguyên nhân và sửa (ưu tiên không nới lỏng ràng buộc).

---

## Mục 3 — Kiểm thử end-to-end 4 vai trên app chạy thực

**Mục tiêu**: xác minh hành vi runtime của A, B, D đúng với 4 nhóm người dùng. Đây là verify quan trọng nhất vì phần lớn thay đổi là phân quyền + điều hướng.

**Chuẩn bị dữ liệu**:
1. Chạy migration (Mục 1) xong.
2. Tạo admin:
   ```bash
   node scripts/create-admin.mjs    # xem scripts/ để biết tham số; tạo 1 tài khoản DC_ADMIN
   ```
3. Khởi động app (chạy ở terminal riêng, KHÔNG để agent chạy nền chặn):
   ```bash
   npm run dev
   ```
   App lắng nghe ở `PORT` trong `.env` (mặc định 3100) → http://localhost:3100
4. Dùng trang Admin (`/admin/users`, `/admin/roles`, `/admin/org`) tạo:
   - 1 tài khoản **Reader** (không gán vai trò nào, hoặc chỉ `DC_READER`).
   - 1 tài khoản **Author** thuần (chỉ `DC_AUTHOR`).
   - 1 tài khoản **Phê duyệt** (`DC_DEPT_HEAD`), có `primary_dept_id` gán vào một Dept thuộc một Site/BU cụ thể.
   - Admin đã có.
   - Tạo một ít tài liệu ở nhiều `scope_level` (group/bu/site/dept) và nhiều trạng thái: `hieu_luc`, `het_hieu_luc` (lỗi thời), `cho_xac_nhan`.

**Kịch bản kiểm thử** (ghi lại kết quả từng dòng):

### 3.1 Reader (yêu cầu A)
- [ ] Đăng nhập Reader → menu chỉ thấy: Trang chủ, Danh mục tài liệu. KHÔNG thấy "Tài liệu của tôi", "Chờ tôi xác nhận", "Gói ban hành", "Nhóm chức năng", các mục Admin.
- [ ] Vào **Danh mục tài liệu** (`/documents`): CHỈ thấy tài liệu `hieu_luc` + `da_dang_ky` trong phạm vi của mình. KHÔNG thấy bản `het_hieu_luc`/`thu_hoi`/nháp/chờ.
- [ ] Mở link trực tiếp tới một bản `het_hieu_luc` (`/documents/<version_id_cua_ban_loi_thoi>`): phải **redirect** sang bản `hieu_luc` của cùng `doc_id`. Nếu `doc_id` đó không có bản hiệu lực → **404**.
- [ ] 5 mục đã xóa phải trả 404 khi gõ URL thẳng: `/qa`, `/design`, `/ops/quality`, `/ops/usage`, `/data-check`.

### 3.2 Author thuần (yêu cầu B1)
- [ ] Menu thấy "Tài liệu của tôi", "Gói ban hành"; thấy nhãn mờ "Chờ tôi xác nhận: không có quyền" (KHÔNG phải link).
- [ ] Vào `/pending-confirmation`: trang rỗng + banner "Bạn là người biên soạn — không có quyền xác nhận".
- [ ] POST thẳng (bỏ qua UI) tới `/confirm/<version_id>/approve` và `/confirm/<version_id>/reject` của một tài liệu `cho_xac_nhan` do người KHÁC nộp → phải **403** (không duyệt/không từ chối được). Dùng curl với cookie phiên của Author.
- [ ] Vẫn đăng ký tài liệu được (`/register`), xem được "Tài liệu của tôi".

### 3.3 Phê duyệt — DC_DEPT_HEAD (yêu cầu B2)
- [ ] Vào `/pending-confirmation`: thấy tài liệu `cho_xac_nhan` trong **phạm vi Dept chính** của mình (dept/site/bu khớp), KHÔNG thấy tài liệu ngoài phạm vi.
- [ ] Duyệt được tài liệu `cho_xac_nhan` thuộc đúng Dept chính (approve → chuyển `da_dang_ky`).
- [ ] **KHÔNG** duyệt được tài liệu `scope_level='group'` (toàn tập đoàn): mở `/confirm/<id_group_doc>` → 403, và không hiện trong hàng chờ. ĐÂY là điểm cốt lõi của bug B2.
- [ ] Vẫn thấy bản lỗi thời khi tra cứu (KHÁC Reader — Phê duyệt không bị giới hạn trạng thái).

### 3.4 Admin
- [ ] Thấy đủ menu Admin (Quản trị tổ chức/người dùng/Vai trò, Nhóm chức năng).
- [ ] Duyệt được tài liệu MỌI cấp, kể cả `scope_level='group'`.
- [ ] `/functional-groups` mở được (chỉ Admin). Author/Phê duyệt KHÔNG thấy mục này trong menu và vào URL thẳng → 403.

### 3.5 Nhãn & UI (yêu cầu D)
- [ ] Trang chủ, danh mục, "Tài liệu của tôi", trang xác nhận: trạng thái hiển thị bằng nhãn tiếng Việt ("Chờ xác nhận", "Đã xác nhận, chờ hiệu lực", "Đang hiệu lực"...), KHÔNG lộ mã enum (`cho_xac_nhan`...).
- [ ] Form đăng ký: legend là "Hiệu lực & bộ phận sở hữu"; select "Cấp phạm vi" hiển thị nhãn tiếng Việt (Toàn Tập đoàn / Khối (BU) / Nhà máy / Phòng ban); field "Ngày hiệu lực pháp lý (ngoại bộ)" **ẩn** khi Nguồn = Nội bộ, **hiện** khi Ngoại bộ.
- [ ] `/admin/roles`: bảng "Vai trò hiện có" hiển thị nhãn 3 vai (không in `DC_DEPT_HEAD @ group` trần).

**Dọn sau khi test**: xóa dữ liệu test nếu dùng DB dùng chung; dừng `npm run dev`.

**Tiêu chí hoàn thành**: tất cả checkbox đạt. Ghi lại checkbox nào không đạt kèm hiện trạng để sửa.

---

## Mục 4 — Rebuild `argon2` (module native cho login)

**Vấn đề**: `argon2` là native module (hashing mật khẩu). Trên máy phát triển ban đầu, install-script của nó bị chặn bởi allow-scripts policy nên chưa build. Nếu không rebuild, **đăng nhập sẽ lỗi** khi chạy app thật.

**Các bước**:
1. ```bash
   npm rebuild argon2
   ```
   hoặc cài lại cho chắc:
   ```bash
   npm install
   ```
   (trên môi trường bình thường, install-script chạy tự do nên argon2 build luôn).
2. **Verify**:
   ```bash
   node -e "import('argon2').then(a=>a.hash('x')).then(h=>console.log('argon2 OK', h.slice(0,10))).catch(e=>{console.error('argon2 FAIL', e.message);process.exit(1)})"
   ```
   → in "argon2 OK ..." là đạt.
3. Thử đăng nhập trên app (`npm run dev` + đăng nhập tài khoản admin đã tạo).

**Tiêu chí hoàn thành**: `argon2` import + hash chạy được; đăng nhập thành công.

---

## Checklist tổng khi hoàn tất 4 mục

- [ ] Mục 1: `npm run migrate` xanh; 2 cột đã bỏ; `v_current_documents` OK.
- [ ] Mục 2: `constraints.test.ts` xanh (fail 0) với `DATABASE_URL_TEST`.
- [ ] Mục 3: E2E 4 vai đạt mọi checkbox.
- [ ] Mục 4: `argon2` rebuild + đăng nhập OK.
- [ ] `npm run build` sạch, `npm test` xanh toàn bộ.

## Ghi chú kỹ thuật khác
- Khối CSS `/design` trong `src/public/app.css` giờ là dead CSS (route đã xóa). Vô hại; có thể dọn sau nếu muốn gọn.
- Type `RoleCode` cố ý giữ đủ 7 mã để tương thích dữ liệu lịch sử (migration 013 chỉ set `is_active=false`, không xoá bản ghi role cũ). CHECK constraint migration 012 cũng giữ nguyên. Việc dọn hẳn bản ghi role cũ + siết constraint là một đợt riêng, chưa làm.
- Test cần DB: chỉ `test/constraints.test.ts`. Toàn bộ `test/domain/**` và `test/views/**` là test thuần, không cần DB.
