# Design Document

## Overview

Làm `expiry_date` "biết nói": thêm (1) cờ tính `qua_han_su_dung` trong
`loadDetail` để banner cảnh báo ở trang chi tiết, và (2) preset lọc `expired`
trong `listVisibleDocuments` + liên kết/ô chọn ở Danh mục. Chỉ cảnh báo/lọc;
KHÔNG đổi vòng đời, KHÔNG job nền, KHÔNG migration.

Tách bạch với "quá hạn xem xét" (`qua_han_xem_xet`, dựa `next_review_date`) —
hai cờ/banner riêng.

## Architecture

```
loadDetail(versionId)  (GIỮ) + thêm cột tính:
   (v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE) AS qua_han_su_dung
        -> detail.eta: banner "đã hết hạn" (độc lập banner qua_han_xem_xet)

listVisibleDocuments(filters)  (GIỮ) + thêm nhánh preset:
   preset='expired' -> v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE
        -> catalog.eta: link lọc nhanh + option "Đã hết hạn"
```

## Components and Interfaces

### 1. Domain `loadDetail` — `src/domain/catalog.ts`

- Thêm vào SELECT (ngay cạnh `qua_han_xem_xet`):
  `(v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE) AS qua_han_su_dung`
- Thêm `qua_han_su_dung: boolean` vào interface `DocumentDetail`.
- KHÔNG đổi điều kiện quyền/hiện hành.

### 2. Domain `listVisibleDocuments` — preset `expired`

- Trong khối OR preset, thêm một nhánh:
  `OR (${preset} = 'expired' AND v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE)`
- Giữ nguyên `new30`, `expiring30`, `overdue`, và nhánh đầu
  `(${preset}::varchar IS NULL OR ${preset} = 'hieu_luc')`. Khi `preset='expired'`
  nhánh đầu false nên chỉ nhánh expired áp dụng (nhất quán cách preset khác hoạt động).
- `CatalogFilters.preset` đã là string — không đổi kiểu.

### 3. View trang chi tiết — `src/views/detail.eta`

- Ở cụm banner (gần `qua_han_xem_xet`), thêm độc lập:
```
<% if (d.qua_han_su_dung) { %>
  <%~ include('/components/alert-banner.eta', { type: 'error', text: 'Tài liệu ĐÃ QUÁ NGÀY HẾT HẠN (' + (d.expiry_date || '') + '). Kiểm tra trước khi sử dụng.' }) %>
<% } %>
```
- Đặt cùng chỗ các banner trạng thái; KHÔNG thay banner het_hieu_luc/thu_hoi/
  qua_han_xem_xet hiện có (hai banner có thể cùng hiện).
- `d.expiry_date` đã có trong detail (loadDetail trả `expiry_date`).

### 4. View Danh mục — `src/views/catalog.eta`

- Dải lọc nhanh (`.quick-filters`): thêm link
  `<a href="/documents?preset=expired">Đã hết hạn</a>` cạnh "Sắp hết hạn 30 ngày"/
  "Quá hạn rà soát".
- Ô chọn preset (`<select name="preset">`): thêm
  `<option value="expired" ...selected...>Đã hết hạn</option>`.

### 5. Route Danh mục — `src/routes/catalog.ts`

- Không đổi: route đã đọc `preset` từ querystring và truyền vào
  `listVisibleDocuments`. Preset `expired` tự chạy qua nhánh mới.

## Data Models

Không đổi schema. Chỉ:
- Thêm cột tính (boolean, dẫn xuất) `qua_han_su_dung` trong truy vấn `loadDetail`.
- Thêm điều kiện preset trong `listVisibleDocuments`.
Cột DB `expiry_date` giữ nguyên.

## Error Handling

Không phát sinh lỗi mới. `expiry_date` NULL -> cờ false -> không banner; preset
expired chỉ lọc thêm, không ảnh hưởng các filter khác.

## Testing Strategy

- **Unit (thuần, không DB):** nếu tách được logic cờ — nhưng ở đây cờ tính bằng
  SQL, nên chủ yếu test bằng render + kiểm SQL tĩnh. Có thể thêm 1 test nhỏ
  khẳng định `DocumentDetail` có trường `qua_han_su_dung` (type-level, qua build).
- **Render test (không DB):** detail.eta:
  - `qua_han_su_dung=true` -> có banner "ĐÃ QUÁ NGÀY HẾT HẠN" kèm ngày.
  - `qua_han_su_dung=false` -> KHÔNG có banner đó.
  - cùng lúc `qua_han_xem_xet=true` -> cả hai banner (độc lập).
- **Render test:** catalog.eta có link + option "Đã hết hạn"; khi
  `filters.preset='expired'` thì option được chọn.
- **SQL tĩnh:** kiểm chuỗi truy vấn `listVisibleDocuments` chứa nhánh
  `preset = 'expired'` và điều kiện `expiry_date < CURRENT_DATE`.
- **Build + test view hiện có:** `npm run build` sạch; test view pass.
- **Trên target (cần DB):** đặt một tài liệu `expiry_date` quá khứ -> preset
  "Đã hết hạn" liệt kê đúng; mở chi tiết thấy banner; tài liệu chưa hết hạn
  không bị ảnh hưởng.

## Rollout / Deploy

Chỉ sửa domain + 2 view. KHÔNG migration. Target: pull + build + restart.

## Correctness Properties

### Property 1: Banner đúng điều kiện
**Validates: Requirements 1.1, 1.2**
Banner "đã hết hạn" hiện khi và chỉ khi `expiry_date` không rỗng và < hôm nay.

### Property 2: Hai trục độc lập
**Validates: Requirements 1.3, 4.2**
Banner "đã hết hạn" và banner "quá hạn xem xét" độc lập: có thể hiện riêng hoặc
cùng lúc; cái này bật/tắt không ảnh hưởng cái kia.

### Property 3: Preset lọc đúng
**Validates: Requirements 2.1, 2.4**
preset='expired' trả đúng tập tài liệu có expiry_date không rỗng và < hôm nay;
không ảnh hưởng preset khác.

### Property 4: Không đổi vòng đời/quyền
**Validates: Requirements 3.1, 3.2, 3.3, 1.4**
Trạng thái tài liệu và điều kiện hiện hành/quyền xem không đổi khi quá hạn; chỉ
thêm chỉ báo. Không job nền.

### Property 5: Không đổi schema/luồng
**Validates: Requirements 4.1, 4.2, 4.3**
Không migration; không đổi luồng đăng ký/sửa/thu hồi/xem xét; banner tái dùng
alert-banner.eta.
