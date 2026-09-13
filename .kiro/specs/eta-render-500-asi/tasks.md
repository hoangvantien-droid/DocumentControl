# Implementation Plan

- [x] 1. Viết test khám phá điều kiện lỗi (bug condition exploration test)
  - **Property 1: Bug Condition** — View có câu-xuất-trước-`(`/`[` phải kết xuất được
  - **CRITICAL**: Test này PHẢI FAIL trên code CHƯA sửa — thất bại xác nhận lỗi tồn tại
  - **DO NOT** cố sửa test hay sửa code khi nó fail ở bước này
  - **NOTE**: Test này mã hóa hành vi kỳ vọng — nó sẽ chuyển sang PASS để xác thực fix ở task 3.2
  - **GOAL**: Surface counterexamples chứng minh lỗi
  - **Scoped PBT Approach**: Vì lỗi tất định theo cấu trúc template, scope test vào các case cụ thể đã xác minh
  - Tạo file `test/views/render.test.ts` dùng `node:test` (không thêm thư viện). Tạo `new Eta({ views: join(src, 'views'), cache: false })` (đọc `src/config.ts`/`src/server.ts` để khớp cách cấu hình)
  - Trên code CHƯA sửa, khẳng định các render sau NÉM lỗi (từ Bug Condition trong design):
    - `admin/roles.eta` với `{users, rolesByUser, bus, sites, depts, user, nav, error}` → lỗi chứa `is not a function`
    - `functional-groups.eta` với `{stale, groups, users, membersByGroup, ...}` → `is not a function`
    - `admin/users.eta` với `{users, deptsByUser, depts, ...}` → `is not a function`
    - `packages.eta` với `{packages, membersByPkg, attachable, ...}` → `is not a function`
    - `register.eta` với `{bus, sites, depts, values:{}, ...}` → `reading 'forEach'`
  - Chạy trên code CHƯA sửa: `node --import tsx --test test/views/render.test.ts`
  - **EXPECTED OUTCOME**: Test FAIL (đúng — chứng minh lỗi tồn tại)
  - Ghi lại counterexamples (thông điệp lỗi thực tế) để hiểu gốc rễ
  - Đánh dấu hoàn thành khi test đã viết, đã chạy, và thất bại đã được ghi nhận
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Viết test phòng ngừa (preservation property tests) TRƯỚC khi sửa
  - **Property 2: Preservation** — Mọi view kết xuất không ném lỗi và giữ nguyên nội dung
  - **IMPORTANT**: Theo phương pháp quan-sát-trước (observation-first)
  - Quan sát trên code CHƯA sửa: các view không-lỗi render OK (`home.eta`, `detail.eta`, `reviews.eta`, `login.eta`, `compare.eta`, `qa.eta`, `matrix-options.eta`) — ghi lại HTML/độ dài
  - Viết test bảng dữ liệu (table-driven, PBT thu gọn) quét các view KHÔNG dính lỗi với nhiều biến thể dữ liệu (rỗng / một / nhiều phần tử) → khẳng định render KHÔNG ném lỗi và HTML ổn định (từ Preservation Requirements trong design)
  - Bổ sung assert bảo toàn: mẫu `(<%= it.pending.length %>)` trong `home.eta` cho ra `(<số>)` như văn bản; layout ghép đúng (có `<html>`, sidebar); escape `<`,`&`,`"` đúng
  - Chạy trên code CHƯA sửa
  - **EXPECTED OUTCOME**: Test PASS (xác nhận baseline cần bảo toàn)
  - Đánh dấu hoàn thành khi test đã viết, đã chạy, và PASS trên code chưa sửa
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Sửa lỗi ASI khiến Eta render sập (5 file, 6 vị trí)

  - [x] 3.1 Áp dụng fix ở tầng template (hướng a — gán biến, không đổi HTML)
    - `src/views/admin/roles.eta`: `var rs = (it.rolesByUser[u.user_id] || []); rs.forEach(...)`
    - `src/views/admin/users.eta`: `var ds = (it.deptsByUser[u.user_id] || []); ds.forEach(...)`
    - `src/views/functional-groups.eta`: `var ms = (it.membersByGroup[g.group_id] || []); ms.forEach(...)`
    - `src/views/packages.eta`: `var mm = (it.membersByPkg[p.package_id] || []); mm.forEach(...)`
    - `src/views/register.eta` (2 vị trí): gán `['SOP','WI','Form','Policy','External']` và `['group','bu','site','dept']` vào biến rồi `.forEach(...)`
    - Chỉ đổi phần scriptlet để dòng JS sinh ra không còn bắt đầu bằng `(`/`[`; KHÔNG đổi HTML/text
    - _Bug_Condition: isBugCondition(view) — câu xuất đứng ngay trước scriptlet mở đầu `(` hoặc `[` (design)_
    - _Expected_Behavior: view render ra HTML hợp lệ không ném lỗi (Property 1, design)_
    - _Preservation: Preservation Requirements (design)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Xác minh test khám phá giờ đã PASS
    - **Property 1: Expected Behavior** — View có câu-xuất-trước-`(`/`[` phải kết xuất được
    - **IMPORTANT**: Chạy lại ĐÚNG test ở task 1 — KHÔNG viết test mới. Đổi khẳng định từ "ném lỗi" sang "render OK trả chuỗi HTML không rỗng" (hoặc tách assertion theo trạng thái fixed)
    - Bổ sung: render các view đã sửa với mảng RỖNG → không ném lỗi (Requirement 3.5)
    - **EXPECTED OUTCOME**: Test PASS (xác nhận lỗi đã hết)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Xác minh test phòng ngừa vẫn PASS
    - **Property 2: Preservation** — Mọi view kết xuất không ném lỗi và giữ nguyên nội dung
    - **IMPORTANT**: Chạy lại ĐÚNG test ở task 2 — KHÔNG viết test mới
    - **EXPECTED OUTCOME**: Test PASS (không hồi quy)
    - Xác nhận mọi test vẫn xanh sau khi sửa

- [x] 4. Checkpoint — Đảm bảo toàn bộ test xanh
  - Chạy `npm test` và `node --import tsx --test test/views/render.test.ts`
  - Đảm bảo mọi test PASS; nếu có nghi vấn thì hỏi người dùng
