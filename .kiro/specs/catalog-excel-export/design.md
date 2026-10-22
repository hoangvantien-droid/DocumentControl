# Design Document

## Overview

Tính năng bổ sung ba năng lực cho DCS tại `d:\Kiro\dcs`:

1. **Catalog_Export** — nút "Xuất danh mục Excel" trên `/documents`, xuất đúng tập tài liệu theo bộ lọc đang áp dụng, chỉ hiện với vai Author hoặc SiteDocControl.
2. **MyDocs_Export** — nút "Xuất Excel" trên `/my-documents`, xuất danh sách tài liệu của chính người biên soạn.
3. **DocType_Source** — gộp danh sách loại tài liệu thành một hằng số tầng domain dùng chung cho biểu mẫu đăng ký và bộ lọc danh mục.

Thiết kế bám kiến trúc hiện có của DCS (TypeScript, Fastify 4, postgres.js, Eta, htmx, SQL thuần không ORM, logic domain tách khỏi route mỏng — DCS-8). Export tái dùng nguyên vẹn các hàm lắp dữ liệu đang có (`listVisibleDocuments` cho danh mục; khối lắp `docs` trong route `/my-documents`), chỉ thêm một bộ dựng workbook dùng chung và hai route stream `.xlsx`. Kiểm quyền và giới hạn phạm vi dữ liệu thực thi phía máy chủ, không tin giao diện.

Phạm vi cố ý giữ hẹp: không đổi mô hình dữ liệu (trừ việc bổ sung `origin` vào SELECT và `CatalogRow` — vốn đã có sẵn trong `CatalogFilters`), không thêm migration (ràng buộc CHECK hiện tại vẫn là nguồn thực thi thẩm quyền của tập loại tài liệu).

## Architecture

### Component Overview

```
Trình duyệt
  │  GET /documents?<filters>            (trang danh mục — đã có)
  │  GET /documents/export.xlsx?<filters>  (MỚI)
  │  GET /my-documents                   (trang của tôi — đã có)
  │  GET /my-documents/export.xlsx       (MỚI)
  ▼
Routes (mỏng)
  ├─ src/routes/catalog.ts     → registerCatalogRoutes(app, sql, config)
  │     • parseCatalogFilters(query)  (MỚI — tách từ handler /documents)
  │     • GET /documents/export.xlsx  (MỚI)
  └─ src/routes/documents.ts   → registerDocumentRoutes(app, sql, config)
        • assembleMyDocuments(sql, userId) (MỚI — tách từ handler /my-documents)
        • GET /my-documents/export.xlsx (MỚI)
  ▼
Domain / Lib
  ├─ src/domain/catalog.ts
  │     • listVisibleDocuments(...)  (SỬA: thêm origin vào SELECT + CatalogRow)
  ├─ src/domain/permissions.ts
  │     • roleCodesOf / isSiteDocControl / canRegisterDocuments  (tái dùng)
  │     • canExportCatalog(roleCodes)  (MỚI — hàm thuần: Author || SiteDocControl)
  ├─ src/domain/doc-types.ts  (MỚI)
  │     • DOC_TYPES: readonly DocTypeOption[]
  │     • DOC_TYPE_CODES: readonly DocType[]
  └─ src/lib/xlsx.ts  (MỚI)
        • buildWorkbook(columns, rows) → ExcelJS.Workbook
        • streamXlsx(reply, workbook, fileName)
        • exportFileName(prefix, date) → "catalog-YYYYMMDD-HHmmss.xlsx"
  ▼
exceljs  (dependency MỚI)
  ▼
PostgreSQL (SQL thuần)  ← CHECK (doc_type IN (...)) là nguồn thực thi thẩm quyền
```

### Data Flow

**Catalog_Export (`GET /documents/export.xlsx`)**

1. `requireDocFlow(sql, req, reply)` xác thực người dùng trong luồng tài liệu (như `/documents`).
2. Nạp `roleCodesOf(sql, userId)`; nếu `!canExportCatalog(roles)` → `reply.code(403)` và trả thông báo, không dựng workbook.
3. `parseCatalogFilters(req.query)` dựng cùng một `CatalogFilters` như handler `/documents`.
4. `listVisibleDocuments(sql, userId, filters, req.nav.isReadOnly)` trả về tập đã lọc TRƯỚC theo phạm vi (Visible_Scope) và theo Applied_Filters — cùng hàm, cùng tham số với trang.
5. `buildWorkbook(CATALOG_COLUMNS, rows)` dựng workbook 11 cột.
6. `streamXlsx(reply, workbook, exportFileName('catalog', new Date()))` đặt header Content-Type + Content-Disposition và ghi workbook ra luồng của reply.

**MyDocs_Export (`GET /my-documents/export.xlsx`)**

1. `requireUser(req, reply)` xác thực.
2. Nếu `!await canRegisterDocuments(sql, userId)` → `403`, không dựng workbook.
3. `assembleMyDocuments(sql, userId)` chạy đúng truy vấn gộp receipt hiện có và trả về mảng `docs` (đã có `aggregate` qua `aggregateStatusOf` và `hasContentReject`).
4. `buildWorkbook(MY_DOCS_COLUMNS, docs)` dựng workbook 7 cột.
5. `streamXlsx(reply, workbook, exportFileName('my-documents', new Date()))`.

Phạm vi dữ liệu không được lọc SAU: Catalog_Export dựa hoàn toàn vào mệnh đề WHERE của `listVisibleDocuments`; MyDocs_Export dựa vào `WHERE v.registrant_user_id = ${userId}` của truy vấn gộp (DCS-2 §7.1).

## Components and Interfaces

### 1. `src/lib/xlsx.ts` — bộ dựng workbook dùng chung (MỚI)

Trừu tượng hóa quanh `exceljs`: mô tả cột theo khai báo (header + hàm trích giá trị từ row), dựng workbook, và stream ra `FastifyReply`. Không chứa tri thức nghiệp vụ về danh mục hay tài liệu của tôi — chỉ "column-definitions + rows → workbook → reply".

```typescript
import type { FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';

/** Mô tả một cột: tiêu đề hiển thị + cách lấy giá trị ô từ một dòng dữ liệu. */
export interface ColumnDef<Row> {
  header: string;
  /** Trả về giá trị ô. Null/undefined được chuẩn hóa thành chuỗi rỗng. */
  value: (row: Row) => string | number | null | undefined;
  /** Độ rộng cột gợi ý (tùy chọn). */
  width?: number;
}

/** Dựng workbook một sheet từ định nghĩa cột + danh sách dòng. */
export function buildWorkbook<Row>(
  columns: readonly ColumnDef<Row>[],
  rows: readonly Row[],
  sheetName = 'Export',
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  // Hàng tiêu đề luôn được ghi, kể cả khi rows rỗng → workbook rỗng-ish vẫn hợp lệ.
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(columns.map((c) => normalizeCell(c.value(row))));
  }
  columns.forEach((c, i) => {
    if (c.width) ws.getColumn(i + 1).width = c.width;
  });
  return wb;
}

function normalizeCell(v: string | number | null | undefined): string | number {
  return v === null || v === undefined ? '' : v;
}

/** Tên tệp theo quy ước: {prefix}-YYYYMMDD-HHmmss.xlsx (giờ máy chủ). */
export function exportFileName(prefix: string, at: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
    + `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${prefix}-${ts}.xlsx`;
}

/** Đặt header .xlsx chuẩn và stream workbook ra reply. */
export async function streamXlsx(
  reply: FastifyReply,
  workbook: ExcelJS.Workbook,
  fileName: string,
): Promise<void> {
  reply.header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
  // Ghi trực tiếp ra luồng của reply (reply.raw) để tránh đệm toàn bộ trong RAM.
  await workbook.xlsx.write(reply.raw);
  reply.raw.end();
}
```

Ghi chú: `workbook.xlsx.write(reply.raw)` ghi theo luồng vào socket; route trả về sau khi `streamXlsx` resolve. Do dùng `reply.raw` nên handler không `return reply.send(...)` cho nhánh export — trả về `reply` sau khi stream xong.

### 2. `src/domain/doc-types.ts` — nguồn loại tài liệu dùng chung (MỚI)

Một nguồn duy nhất cho tập loại tài liệu, gắn nhãn tiếng Việt an toàn, dùng lại kiểu `DocType` đã khai trong `registration.ts` để không tạo kiểu trùng.

```typescript
import type { DocType } from './registration.js';

export interface DocTypeOption {
  code: DocType;
  /** Nhãn hiển thị cho người dùng (hiện trùng mã; để mở đường bản địa hóa). */
  label: string;
}

/**
 * Nguồn DUY NHẤT của danh sách loại tài liệu cho tầng ứng dụng.
 *
 * Quan hệ với cơ sở dữ liệu: ràng buộc CHECK trong
 * src/db/migrations/001_schema.sql (documents.doc_type IN
 * ('SOP','WI','Form','Policy','External')) VẪN là nguồn thực thi thẩm quyền.
 * Hằng số này phải khớp CHECK đó. Thêm một loại mới sau này đòi HAI việc:
 *   (1) viết migration mở rộng ràng buộc CHECK, và
 *   (2) bổ sung mục tương ứng vào DOC_TYPES ở đây.
 * Không được chỉ sửa một trong hai nơi.
 */
export const DOC_TYPES: readonly DocTypeOption[] = [
  { code: 'SOP', label: 'SOP' },
  { code: 'WI', label: 'WI' },
  { code: 'Form', label: 'Form' },
  { code: 'Policy', label: 'Policy' },
  { code: 'External', label: 'External' },
] as const;

/** Chỉ các mã (tiện cho kiểm thử và so khớp). */
export const DOC_TYPE_CODES: readonly DocType[] = DOC_TYPES.map((t) => t.code);
```

Hai template được cập nhật để lặp danh sách truyền vào thay vì mã cứng:

- `register.eta`: thay `var docTypes = ['SOP','WI','Form','Policy','External']` bằng lặp `it.docTypes` (route `/register`, `/my-documents/:id/edit`, và các nhánh re-render lỗi truyền `docTypes: DOC_TYPES`).
- `catalog.eta`: thay 5 thẻ `<option>` cứng trong bộ lọc "Loại" bằng lặp `it.docTypes` với giữ nguyên trạng thái `selected` theo `ff.doc_type`.

### 3. `src/domain/catalog.ts` — bổ sung `origin` (SỬA)

`CatalogFilters` đã có `origin`. Thiếu `origin` ở đầu ra. Bổ sung:

```typescript
export interface CatalogRow {
  doc_id: string;
  version_id: string;
  version_no: string;
  title: string;
  status: string;
  doc_type: string;
  scope_level: string;
  origin: string;                      // MỚI
  effective_date: string | null;
  next_review_date: string | null;
  issued_date: string | null;          // MỚI (SELECT đã trả về, nay khai báo)
  expiry_date: string | null;          // MỚI (SELECT đã trả về, nay khai báo)
  owner_department_id: string | null;
}
```

Trong câu `SELECT` của `listVisibleDocuments`, thêm `d.origin` (các cột `issued_date`/`expiry_date` đã có trong SELECT, chỉ cần khai báo ở interface). Đây là thay đổi cộng thêm, không ảnh hưởng người dùng hiện tại của `CatalogRow`.

### 4. `src/domain/permissions.ts` — hàm quyền export danh mục (MỚI)

```typescript
/** Được xuất danh mục Excel = vai Author HOẶC SiteDocControl. */
export function canExportCatalog(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_AUTHOR') || isSiteDocControl(roleCodes);
}
```

Hàm thuần, kiểm thử bằng bảng vai, dùng trong cả route (phía máy chủ) và để quyết định hiển thị nút (`it.nav.canRegister || it.nav.isSiteDocControl` — hai cờ đã có trong `NavFlags`).

### 5. `src/routes/catalog.ts` — tách parse filter + route export (SỬA/MỚI)

Tách logic parse querystring khỏi handler `/documents` thành hàm nội bộ để cả trang và export dùng chung (bảo đảm Applied_Filters giống hệt):

```typescript
function parseCatalogFilters(query: CatalogQuery): CatalogFilters {
  return {
    status: (query.status ?? '').trim() || null,
    q: (query.q ?? '').trim() || null,
    doc_type: (query.doc_type ?? '').trim() || null,
    origin: (query.origin ?? '').trim() || null,
    eff_from: (query.eff_from ?? '').trim() || null,
    eff_to: (query.eff_to ?? '').trim() || null,
    preset: (query.preset ?? '').trim() || null,
    site_id: (query.site_id ?? '').trim() || null,
    rollout_status: (query.rollout_status ?? '').trim() || null,
    sort: (query.sort ?? '').trim() || 'hieu_luc_moi',
  };
}
```

Handler `/documents` hiện tại chuyển sang gọi `parseCatalogFilters`. Route mới:

```typescript
app.get<{ Querystring: CatalogQuery }>('/documents/export.xlsx', async (req, reply) => {
  const user = await requireDocFlow(sql, req, reply);
  if (!user) return reply;
  const roles = await roleCodesOf(sql, user.user_id);
  if (!canExportCatalog(roles)) {
    reply.code(403);
    return reply.send('Chỉ Biên soạn hoặc Kiểm soát tài liệu site được xuất danh mục');
  }
  const filters = parseCatalogFilters(req.query);
  const rows = await listVisibleDocuments(sql, user.user_id, filters, req.nav.isReadOnly);
  const wb = buildWorkbook(CATALOG_COLUMNS, rows, 'Danh mục');
  await streamXlsx(reply, wb, exportFileName('catalog', new Date()));
  return reply;
});
```

`CATALOG_COLUMNS` (thứ tự cố định; KHÔNG có cột File PDF):

```typescript
const CATALOG_COLUMNS: ColumnDef<CatalogRow>[] = [
  { header: 'Số hiệu',             value: (r) => r.doc_id },
  { header: 'Phiên bản',           value: (r) => r.version_no },
  { header: 'Tiêu đề',             value: (r) => r.title },
  { header: 'Loại',                value: (r) => r.doc_type },
  { header: 'Phạm vi',             value: (r) => scopeLabel(r.scope_level) },
  { header: 'Trạng thái',          value: (r) => docStatusLabel(r.status) },
  { header: 'Nguồn',               value: (r) => originLabel(r.origin) },
  { header: 'Ngày ban hành',       value: (r) => r.issued_date ?? '' },
  { header: 'Ngày hiệu lực',       value: (r) => r.effective_date ?? '' },
  { header: 'Ngày rà soát kế tiếp',value: (r) => r.next_review_date ?? '' },
  { header: 'Ngày hết hạn',        value: (r) => r.expiry_date ?? '' },
];
```

`scopeLabel` / `docStatusLabel` tái dùng cùng nguồn nhãn mà view layer đang dùng (các helper `it.scopeLabel` / `it.docStatusLabel`); `originLabel` ánh xạ `noi_bo → "Nội bộ"`, `ngoai_bo → "Ngoại bộ"`. Nếu các nhãn này hiện chỉ đăng ký ở view layer, trích chúng ra một module nhãn nhỏ dùng chung để cả view lẫn export cùng gọi (không tạo nguồn nhãn thứ hai).

### 6. `src/routes/documents.ts` — tách lắp dữ liệu + route export (SỬA/MỚI)

Tách khối lắp `docs` của handler `/my-documents` thành hàm dùng chung:

```typescript
async function assembleMyDocuments(sql: Sql, userId: string): Promise<MyDocRow[]> {
  // (đúng truy vấn gộp receipt hiện có) → map thêm aggregate + hasContentReject
}
```

Handler `/my-documents` gọi `assembleMyDocuments` rồi render; route export dùng lại chính nó:

```typescript
app.get('/my-documents/export.xlsx', async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return reply;
  if (!await canRegisterDocuments(sql, user.user_id)) {
    reply.code(403);
    return reply.send('Chỉ người biên soạn được xuất Excel tài liệu của mình');
  }
  const docs = await assembleMyDocuments(sql, user.user_id);
  const wb = buildWorkbook(MY_DOCS_COLUMNS, docs, 'Tài liệu của tôi');
  await streamXlsx(reply, wb, exportFileName('my-documents', new Date()));
  return reply;
});
```

`MY_DOCS_COLUMNS` (thứ tự cố định):

```typescript
const MY_DOCS_COLUMNS: ColumnDef<MyDocRow>[] = [
  { header: 'Số hiệu',            value: (d) => d.doc_id },
  { header: 'Phiên bản',          value: (d) => d.version_no },
  { header: 'Tiêu đề',            value: (d) => d.title },
  { header: 'Trạng thái',         value: (d) => docStatusLabel(d.status) },
  { header: 'Site xác nhận',      value: (d) => d.total > 0 ? `${d.accepted}/${d.total}` : '' },
  { header: 'Tình trạng ban hành',value: (d) => d.total > 0 ? aggregateLabel(d.aggregate, d.hasContentReject) : 'Chưa phát hành' },
  { header: 'Lý do từ chối',      value: (d) => d.rejection_reason ?? '' },
];
```

`aggregateLabel` dùng cùng nguồn nhãn tổng hợp mà `my-documents.eta` đang dùng qua `it.aggregateDisplay` (lấy phần `label`).

### 7. Views — vị trí nút (SỬA)

- `catalog.eta`: trong `.toolbar` của `page-header`, thêm nút khi `it.nav.canRegister || it.nav.isSiteDocControl`. Nút là liên kết thuần tới `/documents/export.xlsx` KÈM querystring lọc hiện tại để export khớp những gì đang hiển thị. Vì template đã có đối tượng `ff` (filters), dựng querystring từ các trường non-null của `ff` (dùng helper encode phía route hoặc một chuỗi được route truyền sẵn, ví dụ `it.exportQuery`, để tránh dựng URL thủ công trong template).
- `my-documents.eta`: trong `.toolbar` của `page-header`, thêm nút khi `it.nav.canRegister`, liên kết thuần tới `/my-documents/export.xlsx` (không cần querystring).

## Data Models

Không có bảng/migration mới. Thay đổi mô hình duy nhất là mở rộng `CatalogRow` (mục 3) để lộ `origin`, `issued_date`, `expiry_date` đã có sẵn trong truy vấn. Loại tài liệu vẫn do ràng buộc CHECK trong `001_schema.sql` thực thi; `DOC_TYPES` là bản sao phía ứng dụng phải khớp CHECK đó.

### Column Mapping — Catalog_Export (11 cột)

| # | Tiêu đề (header) | Nguồn (CatalogRow) | Ghi chú |
|---|---|---|---|
| 1 | Số hiệu | `doc_id` | |
| 2 | Phiên bản | `version_no` | |
| 3 | Tiêu đề | `title` | |
| 4 | Loại | `doc_type` | |
| 5 | Phạm vi | `scope_level` | qua `scopeLabel` |
| 6 | Trạng thái | `status` | qua `docStatusLabel` |
| 7 | Nguồn | `origin` | qua `originLabel` (MỚI trong SELECT) |
| 8 | Ngày ban hành | `issued_date` | null → "" |
| 9 | Ngày hiệu lực | `effective_date` | null → "" |
| 10 | Ngày rà soát kế tiếp | `next_review_date` | null → "" |
| 11 | Ngày hết hạn | `expiry_date` | null → "" |

Không có cột "File PDF" (Yêu cầu 1.5).

### Column Mapping — MyDocs_Export (7 cột)

| # | Tiêu đề (header) | Nguồn (MyDocRow) | Ghi chú |
|---|---|---|---|
| 1 | Số hiệu | `doc_id` | |
| 2 | Phiên bản | `version_no` | |
| 3 | Tiêu đề | `title` | |
| 4 | Trạng thái | `status` | qua `docStatusLabel` |
| 5 | Site xác nhận | `accepted` / `total` | `total>0` → `"{accepted}/{total}"`, ngược lại "" |
| 6 | Tình trạng ban hành | `aggregate`, `hasContentReject` | `total>0` → `aggregateLabel(...)`, ngược lại "Chưa phát hành" |
| 7 | Lý do từ chối | `rejection_reason` | null → "" |

## Error Handling

- **403 khi sai vai (phía máy chủ):** Catalog_Export yêu cầu `canExportCatalog(roles)`; MyDocs_Export yêu cầu `canRegisterDocuments`. Thất bại → `reply.code(403)` + thông báo tiếng Việt, KHÔNG dựng/stream workbook. Việc ẩn nút ở view chỉ là lớp bề mặt; thẩm quyền thực thi ở route (Yêu cầu 4.1).
- **Kết quả rỗng:** `buildWorkbook` luôn ghi hàng tiêu đề trước khi lặp rows. Khi không có tài liệu, workbook vẫn hợp lệ với đúng hàng header và không có hàng dữ liệu (không lỗi, không tệp hỏng).
- **Giá trị null trong ô:** `normalizeCell` chuyển `null`/`undefined` thành chuỗi rỗng để tránh ô "null" hay lỗi kiểu của exceljs.
- **Lỗi stream:** nếu `workbook.xlsx.write` ném lỗi, để Fastify xử lý qua error handler mặc định; vì header chỉ đặt ngay trước khi ghi nên phần lớn lỗi dựng dữ liệu xảy ra trước khi gửi header.
- **Không tin giao diện:** route không đọc trạng thái hiển thị nút; quyền và phạm vi đều tính lại phía máy chủ từ `sql`.

## Correctness Properties

*Một property là đặc tính/hành vi phải đúng trên MỌI lần thực thi hợp lệ của hệ thống — một phát biểu hình thức về điều hệ thống phải làm. Property là cầu nối giữa đặc tả cho người đọc và bảo đảm đúng-đắn kiểm chứng được bằng máy.*

### Property 1: Bộ dựng workbook danh mục bảo toàn số dòng và nội dung ô

*Với mọi* mảng `CatalogRow` và định nghĩa `CATALOG_COLUMNS`, workbook do `buildWorkbook` sinh ra có đúng `rows.length` hàng dữ liệu (ngoài hàng tiêu đề), và với mọi dòng, giá trị mỗi ô bằng kết quả hàm trích của cột tương ứng (với null/undefined chuẩn hóa thành chuỗi rỗng).

**Validates: Requirements 1.3**

### Property 2: Bất biến hàng tiêu đề danh mục và loại trừ cột File PDF

*Với mọi* tập `CatalogRow` (kể cả rỗng), hàng tiêu đề của workbook danh mục bằng đúng chuỗi `['Số hiệu','Phiên bản','Tiêu đề','Loại','Phạm vi','Trạng thái','Nguồn','Ngày ban hành','Ngày hiệu lực','Ngày rà soát kế tiếp','Ngày hết hạn']` theo đúng thứ tự, và không chứa tiêu đề 'File PDF'.

**Validates: Requirements 1.4, 1.5**

### Property 3: Bộ dựng workbook "tài liệu của tôi" ánh xạ đúng tiêu đề và nội dung

*Với mọi* mảng `MyDocRow` (kể cả rỗng), hàng tiêu đề của workbook my-documents bằng đúng `['Số hiệu','Phiên bản','Tiêu đề','Trạng thái','Site xác nhận','Tình trạng ban hành','Lý do từ chối']` theo thứ tự; và với mọi dòng, ô "Tình trạng ban hành" phản ánh đúng giá trị tổng hợp của dòng đó, còn ô "Lý do từ chối" bằng `rejection_reason` khi có và bằng chuỗi rỗng khi không có.

**Validates: Requirements 2.3, 2.5, 2.6**

### Property 4: Định dạng ô "Site xác nhận" theo số được chấp nhận trên tổng số

*Với mọi* cặp số nguyên `accepted`, `total` thỏa `0 ≤ accepted ≤ total`, nếu `total > 0` thì ô "Site xác nhận" bằng chuỗi `"{accepted}/{total}"`; nếu `total = 0` thì ô bằng chuỗi rỗng.

**Validates: Requirements 2.4**

### Property 5: Quy ước tên tệp xuất nhận diện loại xuất và thời điểm

*Với mọi* `Date` hợp lệ, `exportFileName(prefix, date)` trả về chuỗi khớp mẫu `"{prefix}-YYYYMMDD-HHmmss.xlsx"`; tiền tố của Catalog_Export (`"catalog"`) khác tiền tố của MyDocs_Export (`"my-documents"`), bảo đảm nhận diện được loại xuất.

**Validates: Requirements 4.3**

## Testing Strategy

Theo DCS-8: logic domain/lib kiểm thử được bằng unit test không cần hạ tầng; các ràng buộc DB (CHECK, phạm vi) cần Postgres thật.

### Unit / Property tests (không cần DB)

- **Bộ dựng workbook (`src/lib/xlsx.ts`):** property test cho Property 1–4 bằng fast-check. Đọc lại workbook bằng chính API exceljs (ghi vào buffer rồi `workbook.xlsx.load`, hoặc đọc trực tiếp từ worksheet trong bộ nhớ) để khẳng định hàng tiêu đề, số dòng, và nội dung ô. Tối thiểu 100 vòng lặp mỗi property.
  - Tag: **Feature: catalog-excel-export, Property 1: Bộ dựng workbook danh mục bảo toàn số dòng và nội dung ô** (tương tự cho Property 2–4).
- **Tên tệp (`exportFileName`):** property test cho Property 5 — sinh `Date` ngẫu nhiên, khẳng định khớp regex và phân biệt tiền tố.
- **`DOC_TYPES` (Yêu cầu 3.1):** unit test khẳng định `DOC_TYPE_CODES` sâu-bằng `['SOP','WI','Form','Policy','External']` và mỗi `label` không rỗng. Thêm một test canh gác khớp với danh sách trong ràng buộc CHECK (đọc giá trị kỳ vọng như hằng số trong test) để phát hiện lệch khi thêm loại mới.
- **Quyền export (hàm thuần):** bảng ví dụ cho `canExportCatalog` — `{DC_AUTHOR}`→true, `{DC_SITE_DOC_CONTROL}`→true, `{DC_ADMIN}`→false, `{}`(Reader)→false, `{DC_AUTHOR,DC_ADMIN}`→true (Yêu cầu 1.7, 2.7, 4.1; phần `canRegisterDocuments` cho MyDocs kiểm ở tầng DB).
- **Render template (ví dụ):** render `catalog.eta` và `register.eta` với `docTypes: DOC_TYPES`, khẳng định bộ chọn "Loại" có đúng 5 option đúng `value` (Yêu cầu 3.2, 3.3); render `catalog.eta`/`my-documents.eta` với các tổ hợp `nav` để khẳng định nút export hiện/ẩn đúng (Yêu cầu 1.1, 1.2, 2.1).

### Integration / constraints tests (cần Postgres thật — DCS-8)

- `listVisibleDocuments` trả về `origin` đúng sau khi thêm vào SELECT (Yêu cầu 1.6).
- Phạm vi dữ liệu: người dùng không thấy tài liệu ngoài Visible_Scope trong export danh mục (Yêu cầu 1.8, 4.4); MyDocs_Export chỉ gồm tài liệu `registrant_user_id` của chính người dùng (Yêu cầu 2.2, 2.8).
- Áp dụng cùng Applied_Filters: với cùng querystring, tập dữ liệu của `/documents/export.xlsx` bằng tập của `/documents` (Yêu cầu 4.2) — dựa trên việc cả hai dùng chung `parseCatalogFilters` + `listVisibleDocuments`.
- Ràng buộc CHECK: INSERT `documents.doc_type` ngoài tập bị từ chối (Yêu cầu 3.4); tính năng này KHÔNG thêm migration.

## File / Route Changes

**Tệp mới**
- `src/lib/xlsx.ts` — `ColumnDef`, `buildWorkbook`, `exportFileName`, `streamXlsx`.
- `src/domain/doc-types.ts` — `DocTypeOption`, `DOC_TYPES`, `DOC_TYPE_CODES`.

**Tệp sửa**
- `package.json` — thêm dependency `exceljs` (ghim phiên bản chính xác).
- `src/domain/catalog.ts` — thêm `origin`/`issued_date`/`expiry_date` vào `CatalogRow`; thêm `d.origin` vào SELECT của `listVisibleDocuments`.
- `src/domain/permissions.ts` — thêm `canExportCatalog(roleCodes)`.
- `src/routes/catalog.ts` — tách `parseCatalogFilters`; thêm route `GET /documents/export.xlsx`; truyền `docTypes` (và `exportQuery`) vào `catalog.eta`.
- `src/routes/documents.ts` — tách `assembleMyDocuments`; thêm route `GET /my-documents/export.xlsx`; truyền `docTypes` vào `register.eta` (các route `/register`, `/my-documents/:id/edit`, và nhánh re-render lỗi).
- `src/views/catalog.eta` — bộ lọc "Loại" lặp `it.docTypes`; thêm nút export (hiện khi `canRegister || isSiteDocControl`, kèm querystring lọc).
- `src/views/my-documents.eta` — thêm nút export (hiện khi `canRegister`).
- `src/views/register.eta` — bộ chọn "Loại" lặp `it.docTypes`.

**Route mới**
- `GET /documents/export.xlsx` (trong `registerCatalogRoutes`).
- `GET /my-documents/export.xlsx` (trong `registerDocumentRoutes`).

Không thay đổi `src/server.ts` (hai route mới nằm trong các hàm đăng ký đã được gọi sẵn).
