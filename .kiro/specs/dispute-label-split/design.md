# Design Document

## Overview

Tách nhãn/màu của trạng thái `tranh_chap` thành hai mức khi hiển thị, GIỮ NGUYÊN
enum + `aggregateStatusOf`. Thực hiện qua một helper nhãn dùng chung + bổ sung
một cờ phân biệt loại từ chối cho mỗi dòng ở danh sách my-documents (issuance đã
có sẵn cờ).

Không migration, không đổi logic/luồng/quyền.

## Architecture

```
aggregateStatusOf (GIỮ NGUYÊN) -> 'tranh_chap' khi rejected > 0
                                   |
view (issuance / my-documents) ---+--> aggregateDisplay(aggregate, hasContentReject)
                                        -> { label, cls }
```

- `aggregateStatusOf`: không đổi — vẫn là nguồn sự thật cho logic (chặn phát hành
  thêm, v.v.).
- Việc "nặng/nhẹ" chỉ xảy ra ở tầng trình bày, dựa trên cờ `hasContentReject`.

## Components and Interfaces

### 1. Helper nhãn dùng chung — `src/views/labels.ts`

Thêm hàm (giữ `aggregateStatusLabel` cũ để tương thích ngược):

```ts
export function aggregateDisplay(
  aggregate: string | null | undefined,
  hasContentReject = false,
): { label: string; cls: string } {
  switch (aggregate) {
    case 'chua_phat_hanh': return { label: 'Chưa phát hành', cls: 'status-da_ban_hanh' };
    case 'dang_cho':       return { label: 'Đang chờ phản hồi', cls: 'status-da_ban_hanh' };
    case 'mot_phan':       return { label: 'Một phần đã áp dụng', cls: 'status-da_ban_hanh' };
    case 'toan_bo':        return { label: 'Toàn bộ đã áp dụng', cls: 'status-hieu_luc' };
    case 'tranh_chap':
      return hasContentReject
        ? { label: 'Có site báo sai nội dung', cls: 'status-thu_hoi' }   // đỏ (nặng)
        : { label: 'Có site báo sai đăng ký', cls: 'status-cho_xac_nhan' }; // amber (nhẹ)
    default: return { label: aggregate || '', cls: 'status-da_ban_hanh' };
  }
}
```

Ghi chú class: tái dùng các lớp status CSS sẵn có.
- `status-thu_hoi` = tông đỏ (đang dùng cho tranh_chap hiện tại).
- `status-cho_xac_nhan` = tông amber/vàng (đã có trong app.css cho trạng thái chờ).
- `status-hieu_luc` = xanh (toàn bộ).
- `status-da_ban_hanh` = xanh brand nhạt (các trạng thái trung tính).
KHÔNG thêm lớp CSS mới nếu các lớp này đã đủ; nếu cần tinh chỉnh màu amber cho
đúng ngữ nghĩa thì thêm quy tắc nhỏ, không bắt buộc.

`aggregateStatusLabel` cũ: giữ nguyên (các chỗ khác còn gọi), nhưng hai view mục
tiêu sẽ chuyển sang `aggregateDisplay`.

Render layer (`src/views/render.ts`) đã tự chèn các hàm nhãn vào context — thêm
`aggregateDisplay` vào danh sách inject để view gọi `it.aggregateDisplay(...)`.

### 2. my-documents — bổ sung cờ loại từ chối theo dòng

`src/routes/documents.ts`, truy vấn danh sách đã GROUP BY: thêm một cột đếm
trong cùng câu (KHÔNG thêm truy vấn/dòng):

```sql
count(r.*) FILTER (WHERE r.status = 'tu_choi' AND r.response_type = 'sai_noi_dung')::int AS content_rejected
```

Khi map `docs`: thêm `hasContentReject: d.content_rejected > 0`.

### 3. View — gọi helper

`src/views/my-documents.eta` (dòng ~39-40): thay
```
var cls = d.aggregate === 'tranh_chap' ? 'status-thu_hoi' : (...);
<span class="status <%= cls %>"><%= it.aggregateStatusLabel(d.aggregate) %></span>
```
bằng
```
var disp = it.aggregateDisplay(d.aggregate, d.hasContentReject);
<span class="status <%= disp.cls %>"><%= disp.label %></span>
```

`src/views/issuance-status.eta` (dòng ~14-15): thay cách tính `aggCls` +
`aggregateStatusLabel` bằng
```
var disp = it.aggregateDisplay(it.aggregate, it.hasContentReject);
<span class="status <%= disp.cls %>"><%= disp.label %></span>
```
`it.hasContentReject` route đã truyền sẵn.

## Data Models

Không đổi schema. my-documents thêm một cột ĐẾM dẫn xuất (`content_rejected`)
trong truy vấn sẵn có; không bảng/cột mới.

## Error Handling

Không phát sinh lỗi. Helper fall-through an toàn cho giá trị lạ (default). Khi
`aggregate !== 'tranh_chap'`, cờ `hasContentReject` bị bỏ qua.

## Testing Strategy

- **Unit (thuần, không DB):** test `aggregateDisplay`:
  - tranh_chap + hasContentReject=true -> label "sai nội dung", cls đỏ.
  - tranh_chap + hasContentReject=false -> label "sai đăng ký", cls amber.
  - các trạng thái khác -> label/cls giữ như cũ, không phụ thuộc cờ.
- **Render (không DB):** my-documents.eta + issuance-status.eta render đúng nhãn
  theo cờ ở ca sai nội dung vs sai đăng ký.
- **Build + test view hiện có:** `npm run build` sạch; test view pass. Lưu ý:
  test `labels-receipt.test.ts` có thể kiểm `aggregateStatusLabel` cũ — giữ hàm
  đó nguyên để không vỡ.

## Rollout / Deploy

Chỉ sửa labels.ts + render.ts + route my-documents + 2 view. KHÔNG migration.
Target: pull + build + restart.

## Correctness Properties

### Property 1: Tách đúng theo loại từ chối
**Validates: Requirements 1.1, 1.2, 1.3**
Khi aggregate='tranh_chap': hasContentReject=true -> nhãn "sai nội dung" + màu
nặng; hasContentReject=false -> nhãn "sai đăng ký" + màu nhẹ. Có cả hai loại thì
hasContentReject=true nên ra "sai nội dung" (ưu tiên nặng).

### Property 2: Các trạng thái khác bất biến
**Validates: Requirements 2.1, 2.2**
Với aggregate thuộc {chua_phat_hanh, dang_cho, mot_phan, toan_bo},
`aggregateDisplay` trả nhãn/màu không phụ thuộc hasContentReject và khớp nhãn cũ.

### Property 3: Không đổi nguồn sự thật
**Validates: Requirements 3.1, 3.2, 3.3**
`aggregateStatusOf` và enum không đổi; không có logic chặn/luồng nào thay đổi.

### Property 4: Nhất quán hai trang
**Validates: Requirements 1.4, 4.1, 4.2, 4.3**
issuance-status.eta và my-documents.eta cùng dùng `aggregateDisplay`; cả hai có
cờ hasContentReject đúng (issuance từ route, my-documents từ cột đếm dẫn xuất).

### Property 5: Không đổi schema
**Validates: Requirements 3.4, 3.5, 4.2**
Không migration; my-documents chỉ thêm một cột FILTER trong truy vấn GROUP BY sẵn
có, không thêm vòng truy vấn.
