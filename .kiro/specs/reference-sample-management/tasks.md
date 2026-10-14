# Kế hoạch triển khai — Quản lý mẫu chuẩn

> Phạm vi triển khai phải tuân thủ `requirements.md`: không tạo ledger lượng còn lại, không triển khai quy trình R&D ký chuẩn và không tách tái ký khỏi yêu cầu mẫu chuẩn mới.

## 1. Khảo sát và chốt các điểm tích hợp

- [ ] 1.1 Khảo sát danh mục Item, cơ chế quyền, audit, file attachment, job scheduler, thông báo, QR/printing và pattern route/domain/view hiện có trong DCS.
  - Xác định module/tables có thể tái sử dụng; không tạo bản sao của cơ chế hiện hữu.
  - Xác nhận timezone nghiệp vụ áp dụng cho phép tính theo ngày.
  - **Validation:** ghi kết quả mapping module và các hạn chế kỹ thuật vào delivery note/PR.

- [ ] 1.2 Áp dụng các quyết định MVP đã chốt tại `design.md` §10.
  - Không cần chờ xác nhận nghiệp vụ bổ sung cho kênh cảnh báo, người nhận, approval hủy, danh mục vị trí hoặc request lifecycle.
  - Chỉ ghi nhận các giới hạn kỹ thuật phát hiện được và chọn tái sử dụng/tạo mới danh mục Item-vị trí theo Task 7.1.
  - **Validation:** mọi schema/API/UI triển khai đúng các quyết định đã chốt; thay đổi phạm vi chỉ được thực hiện qua spec change mới.

## 2. Thiết kế schema và migration

- [ ] 2.1 Tạo migration forward-only cho cấu hình mẫu chuẩn theo Item.
  - Lưu `managed`, đơn vị, lượng tham chiếu, `shelf_life_days`, `replacement_lead_time_days`, điều kiện bảo quản và người nhận thông báo theo design đã chốt.
  - Thêm validation/constraint để hạn dùng và lead time là số dương, đồng thời hạn dùng lớn hơn lead time.
  - Không thêm cột “days before expiry alert” độc lập và không tạo bảng giao dịch tồn lượng.
  - **Validation:** fresh schema và upgrade schema đều chạy được; invalid configuration bị từ chối an toàn.
  - _Requirements: FR-01_

- [ ] 2.2 Tạo migration cho mẫu chuẩn nhận, yêu cầu mẫu mới, hủy và các chỉ mục truy vấn.
  - Bao gồm snapshot cấu hình, ngày tính, trạng thái, location, attachment relation theo pattern hiện hữu và audit fields.
  - Thêm ràng buộc terminal disposal/state và unique/partial index phù hợp cho yêu cầu mở sau khi chốt chính sách 1.2.
  - **Validation:** migration rehearsal từ DB rỗng và DB nâng cấp; kiểm tra FK/index/constraint bằng test DB cô lập.
  - _Requirements: FR-02, FR-03, FR-05, FR-06, FR-07_

## 3. Domain logic và authorization

- [ ] 3.1 Triển khai domain cấu hình Item.
  - Validate quyền, unit, thời hạn, lead time và quy tắc không có cảnh báo độc lập.
  - **Validation:** unit tests cho configuration hợp lệ/sai, đặc biệt `shelf_life_days <= lead_time_days`.
  - _Requirements: FR-01_

- [ ] 3.2 Triển khai domain nhận mẫu và snapshot.
  - Tính `expires_on = received_at + shelf_life_days_snapshot` và `warning_on = expires_on - lead_time_days_snapshot` trong transaction.
  - Tạo đúng state ban đầu theo ngày tính; lưu dates/snapshot không bị ghi đè sau khi Item thay đổi.
  - **Validation:** tests cho Active, NeedsReplacement và ExpiredAwaitingDisposal tại thời điểm nhận; regression chứng minh sửa Item chỉ ảnh hưởng mẫu nhận sau đó.
  - _Requirements: FR-02, FR-03, FR-06_

- [ ] 3.3 Triển khai state transition và hủy có guard domain.
  - Chỉ cho hủy mẫu đúng state; Disposed là terminal; validate lý do/người hủy/bằng chứng tùy policy đã chốt.
  - Audit event cho các mutation.
  - **Validation:** tests cho mọi transition được phép/bị cấm và không có partial mutation khi bị từ chối.
  - _Requirements: FR-06, FR-07_

- [ ] 3.4 Triển khai domain Yêu cầu lấy mẫu chuẩn mới.
  - Hỗ trợ tạo từ sample hoặc Item; chuẩn hóa lý do; cảnh báo/link yêu cầu đang mở theo policy.
  - Tuyệt đối không tự tạo luồng tái ký hoặc làm thay đổi hạn mẫu cũ.
  - **Validation:** tests tạo thủ công, từ alert, duplicate-open handling và nhiều mẫu cùng Item.
  - _Requirements: FR-05_

- [ ] 3.5 Thêm capability server-side cho cấu hình, nhận/lưu, yêu cầu, in tem/QR, xem chi tiết và hủy.
  - Tái sử dụng permission model DCS; route trực tiếp không được bypass quyền.
  - **Validation:** injection/domain authorization tests cho QA, QA Lead, R&D recipient và actor không có quyền.
  - _Requirements: Roles, NFR phân quyền_

## 4. Job cảnh báo và notification

- [ ] 4.1 Triển khai job quét mẫu theo ngày, idempotent.
  - Tính cảnh báo duy nhất từ snapshot lead time; update Active → NeedsReplacement; update Active/NeedsReplacement → ExpiredAwaitingDisposal khi hết hạn.
  - Không gửi event/lặp transition trùng khi job chạy lại.
  - **Validation:** tests với ngày trước warning, đúng warning, giữa warning/hết hạn, đúng hạn (mẫu vẫn còn hiệu lực trong ngày) và sau hạn (chuyển chờ hủy), cùng tình huống chạy job hai lần.
  - _Requirements: FR-02, FR-06_

- [ ] 4.2 Tích hợp dashboard và kênh thông báo đã chốt.
  - Gửi đến snapshot recipients; vẫn hiển thị việc cần làm nếu gửi thất bại.
  - **Validation:** failure/retry test hoặc mock delivery test; dashboard hiển thị đúng mẫu cần thay và chờ hủy.
  - _Requirements: FR-02, FR-08, NFR tính đúng hạn_

## 5. Routes, UI, QR và in tem

- [ ] 5.1 Xây dựng màn hình cấu hình mẫu chuẩn theo Item.
  - Hiển thị lead time là nguồn cảnh báo; không render input cảnh báo độc lập.
  - **Validation:** form validation có field error và render lại giá trị hợp lệ.
  - _Requirements: FR-01_

- [ ] 5.2 Xây dựng QA receive form, danh sách, detail/timeline và filters.
  - Hiển thị read-only snapshot/dates đã tính; không có control trừ lượng/quantity remaining.
  - **Validation:** route tests và manual smoke test cho lọc Item/status/hạn/vị trí/lô.
  - _Requirements: FR-03, FR-08_

- [ ] 5.3 Xây dựng tạo yêu cầu mẫu mới và hủy mẫu.
  - Expose request từ alert/detail; form hủy chỉ có với mẫu hợp lệ để hủy.
  - **Validation:** end-to-end QA journey từ alert → request → receipt record mới → disposal mẫu cũ.
  - _Requirements: FR-05, FR-06, FR-07_

- [ ] 5.4 Tích hợp QR/tem với pattern printing hiện có.
  - Tem lấy dữ liệu snapshot: mã mẫu, Item, nhóm, received date, expiry, storage condition, location và QR opaque/internal.
  - In lại có audit event; route quét QR có authorization.
  - **Validation:** render/print test; QR lookup authorized/unauthorized tests; kiểm tra QR không chứa thông tin mẫu đầy đủ.
  - _Requirements: FR-04_

## 6. Kiểm thử và phát hành

- [ ] 6.1 Viết bộ regression cho các tiêu chí chấp nhận của requirements.md.
  - Bao gồm ví dụ 180 ngày/30 ngày: mẫu nhận 01/01 có warning 31/05 và expiry 30/06 theo timezone đã chốt.
  - Bao gồm manual request do thiếu mẫu vật lý, không có ledger lượng còn lại.
  - **Validation:** toàn bộ acceptance criteria pass trên database test cô lập.

- [ ] 6.2 Chạy validation dự án: build, test suite liên quan, migration fresh/upgrade rehearsal và kiểm tra quyền route trực tiếp.
  - Không kết nối database production.
  - **Validation:** ghi kết quả lệnh và migration checklist trong PR/release evidence.

- [ ] 6.3 UAT cùng QA/R&D.
  - Xác nhận tem, QR, vị trí lưu, luồng cảnh báo, tạo yêu cầu, nhận mẫu mới và hủy mẫu trên dữ liệu mô phỏng.
  - **Validation:** QA xác nhận không cần quản lý lượng còn lại và cảnh báo chỉ dựa trên lead time Item.


## 7. Quyết định MVP đã chốt — áp dụng trong triển khai

- [ ] 7.1 Trong Task 1.1, xác nhận chỉ một điểm kỹ thuật: tái sử dụng hay bổ sung mới danh mục Item và vị trí lưu của DCS.
  - Nếu chưa có thực thể phù hợp, tạo `item_master` tối giản và danh mục vị trí ba cấp theo design.md §10; không trì hoãn triển khai để chờ ERP/LIMS.
  - **Validation:** Item code unique, một cấu hình mẫu chuẩn hiện hành/Item, QA chỉ chọn vị trí hợp lệ từ danh mục.

- [ ] 7.2 Triển khai policy MVP đã chốt cho request và cảnh báo.
  - In-app/dashboard only; warning event một lần, dashboard nhắc hằng ngày khi chưa có request open; không email.
  - Implement request state `open/closed`; QA receipt có thể đóng request open cùng Item trong cùng transaction.
  - **Validation:** request trùng được cảnh báo; receipt gắn request sai Item bị từ chối; receipt không gắn request vẫn hợp lệ.

- [ ] 7.3 Triển khai policy đa mẫu, ngừng sử dụng và hủy.
  - Cho phép nhiều mẫu Active cùng Item; receipt mới không đổi sample cũ.
  - Thêm guarded action ngừng sử dụng với reason bắt buộc, audit event, transition sang ExpiredAwaitingDisposal; disposal bắt buộc date/reason/executor, witness/approver/attachment tùy chọn.
  - **Validation:** không thể hủy trực tiếp sample Active/NeedsReplacement; withdrawal hợp lệ tạo event và sau đó có thể disposal; Disposed terminal.

- [ ] 7.4 Triển khai tem QR MVP.
  - Browser-print 50 × 30 mm, một sample/một tem, opaque QR và tra cứu authenticated/authorized.
  - **Validation:** print preview có đủ trường snapshot; QR không chứa metadata đầy đủ; truy cập QR không quyền bị từ chối.
