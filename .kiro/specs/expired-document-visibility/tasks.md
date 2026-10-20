# Implementation Plan

## Overview

Cho expiry_date "biết nói": cờ qua_han_su_dung trong loadDetail (banner chi
tiết) + preset lọc 'expired' trong listVisibleDocuments (+ link/option Danh mục).
Chỉ cảnh báo/lọc; không migration/job/đổi vòng đời. Tách bạch với qua_han_xem_xet.

## Tasks

- [x] 1. Cờ qua_han_su_dung trong loadDetail + preset 'expired' trong listVisibleDocuments
  - `src/domain/catalog.ts`, loadDetail SELECT: thêm `(v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE) AS qua_han_su_dung`; thêm `qua_han_su_dung: boolean` vào interface DocumentDetail.
  - listVisibleDocuments khối OR preset: thêm nhánh `OR (${preset} = 'expired' AND v.expiry_date IS NOT NULL AND v.expiry_date < CURRENT_DATE)`. Giữ nguyên hieu_luc/new30/expiring30/overdue.
  - KHÔNG đổi điều kiện quyền/hiện hành/schema.
  - _Requirements: 1.1, 2.1, 2.4, 3.1, 3.3_
  - _Properties: 1, 3, 4_

- [x] 2. Banner "đã hết hạn" ở trang chi tiết
  - `src/views/detail.eta`, cụm banner trạng thái: thêm độc lập `<% if (d.qua_han_su_dung) { %> <%~ include('/components/alert-banner.eta', { type: 'error', text: 'Tài liệu ĐÃ QUÁ NGÀY HẾT HẠN (' + (d.expiry_date || '') + '). Kiểm tra trước khi sử dụng.' }) %> <% } %>`.
  - KHÔNG thay banner het_hieu_luc/thu_hoi/qua_han_xem_xet (độc lập, có thể cùng hiện). Không `<%# %>`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.3_
  - _Properties: 1, 2_

- [x] 3. Danh mục: link + option preset "Đã hết hạn"
  - `src/views/catalog.eta`: thêm link lọc nhanh `<a href="/documents?preset=expired">Đã hết hạn</a>` vào dải quick-filters (cạnh Sắp hết hạn/Quá hạn rà soát).
  - Thêm `<option value="expired" <%= ff.preset==='expired'?'selected':'' %>>Đã hết hạn</option>` vào select preset.
  - _Requirements: 2.2, 2.3_

- [x] 4. Render + SQL test (không DB)
  - Render detail.eta: qua_han_su_dung=true -> banner có ngày; false -> không; cùng qua_han_xem_xet=true -> cả hai banner.
  - Render catalog.eta: có link + option "Đã hết hạn"; preset='expired' -> option selected.
  - Kiểm SQL tĩnh: chuỗi listVisibleDocuments chứa nhánh preset='expired' + expiry_date < CURRENT_DATE; loadDetail chứa qua_han_su_dung.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_
  - _Properties: 1, 2, 3_

- [x] 5. Build, test, dọn dẹp
  - Compile .eta sạch; `npm run build` sạch (interface DocumentDetail có qua_han_su_dung); test view hiện có pass.
  - Đọc lại xác nhận không migration, không đổi vòng đời/quyền/job. Dọn file tạm.
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2_
  - _Properties: 4, 5_

## Task Dependency Graph

Các "wave" chạy tuần tự; task trong cùng wave có thể làm song song.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "3"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["5"] }
  ],
  "dependencies": {
    "1": [],
    "3": [],
    "2": ["1"],
    "4": ["2", "3"],
    "5": ["4"]
  }
}
```

## Notes

- Không migration, không đổi schema/vòng đời/quyền; không job nền.
- Tái dùng alert-banner.eta + mẫu cờ như qua_han_xem_xet. Tách bạch 2 trục.
- Máy dev không có Postgres: verify compile + render + SQL tĩnh + build; kiểm lọc
  thật trên target.
