# Yêu cầu — Quản lý mẫu chuẩn

## 1. Mục tiêu và phạm vi

Tính năng cho phép QA quản lý vòng đời mẫu chuẩn sau khi R&D đã hoàn tất quy trình ký/duyệt mẫu ở bên ngoài hệ thống: QA nhận mẫu, in/quét tem QR, ghi nhận vị trí lưu, theo dõi hiệu lực, yêu cầu lấy mẫu mới và ghi nhận hủy mẫu.

Áp dụng cho Item thuộc bốn nhóm: **Nguyên liệu**, **Bán thành phẩm**, **Thành phẩm** và **Bao bì**.

### Ngoài phạm vi

- Luồng ký chuẩn, xét duyệt hoặc phê duyệt nội bộ của R&D.
- Quản lý số lượng còn lại, trừ lượng tiêu hao, giao dịch xuất dùng hoặc bổ sung tồn kho mẫu.
- Phân biệt nghiệp vụ “tái ký” với “cấp mẫu chuẩn mới”; hệ thống chỉ dùng một yêu cầu thống nhất là **Yêu cầu lấy mẫu chuẩn mới**.
- Tích hợp tự động với thiết bị ghi nhiệt độ, ERP, LIMS hoặc hệ thống bên ngoài, trừ khi được xác định ở một spec riêng.

## 2. Thuật ngữ

- **Item**: mã hàng/nguyên liệu/BTP/TP/bao bì được quản lý trong danh mục DCS.
- **Cấu hình mẫu chuẩn Item**: thông tin dùng chung để QA quản lý mẫu của một Item.
- **Mẫu chuẩn nhận**: một bản ghi cho từng lần QA nhận mẫu vật lý từ R&D.
- **Lead time lấy mẫu mới**: số ngày cần để có mẫu thay thế, từ lúc phát sinh yêu cầu đến lúc QA nhận mẫu.
- **Ngày cảnh báo**: ngày hệ thống phải nhắc chuẩn bị/thực hiện yêu cầu lấy mẫu mới.
- **Hạn sử dụng**: ngày cuối cùng mẫu được phép ở trạng thái có hiệu lực.

## 3. Vai trò

| Vai trò | Quyền trong phạm vi MVP |
|---|---|
| QA | Nhận/lưu mẫu, in/quét QR, cập nhật vị trí, tạo yêu cầu lấy mẫu mới, ngừng sử dụng và ghi nhận hủy theo quyền được cấp. |
| QA Lead/Quản lý QA | Toàn bộ quyền QA; quản lý Item/cấu hình/vị trí; theo dõi dashboard, cảnh báo và lịch sử hủy. Không có bước phê duyệt hủy riêng trong MVP. |
| R&D/Người nhận thông báo | Chỉ nhận thông báo cho Item được cấu hình nếu có tài khoản DCS; không thực hiện ký chuẩn, xử lý hay cập nhật yêu cầu trong MVP. |
| Quản trị hệ thống | Cấp quyền; không vận hành thay QA/QA Lead trừ khi được phân role tương ứng. |

Việc phân quyền chi tiết phải tái sử dụng cơ chế role/scope hiện có của DCS; không cho phép chỉ dựa vào việc ẩn/hiện màn hình để kiểm soát quyền.

## 4. Yêu cầu chức năng

### FR-01 — Khai báo mẫu chuẩn theo Item

1. Hệ thống phải cho phép cấu hình mẫu chuẩn cho từng Item có cờ **Có quản lý mẫu chuẩn**.
2. Cấu hình tối thiểu gồm:
   - Item, tên Item, nhóm Item;
   - cờ có/không quản lý mẫu chuẩn;
   - đơn vị mẫu (ví dụ: cái, bộ, g, kg, mL, L);
   - lượng mẫu tham chiếu cho mỗi lần R&D bàn giao;
   - thời hạn sử dụng mẫu chuẩn theo số ngày;
   - lead time lấy mẫu chuẩn mới theo số ngày;
   - điều kiện bảo quản chuẩn;
   - nhóm/người nhận cảnh báo.
3. Lượng mẫu tham chiếu chỉ là thông tin hướng dẫn khi R&D bàn giao. Hệ thống **không** được tính lượng còn lại, không trừ lượng dùng và không cảnh báo dựa trên số lượng.
4. Người dùng không được nhập hoặc sửa một trường “số ngày cảnh báo trước hạn” độc lập. Số ngày cảnh báo trước hạn luôn bằng lead time của Item.
5. Thời hạn sử dụng và lead time phải là số nguyên dương tính theo ngày; thời hạn sử dụng phải lớn hơn lead time. Hệ thống phải báo lỗi tại trường dữ liệu khi vi phạm.
6. Item chưa khai báo đủ thời hạn sử dụng hoặc lead time không được dùng để nhận mẫu chuẩn mới; hệ thống phải chỉ rõ dữ liệu cấu hình còn thiếu.

### FR-02 — Tính hạn sử dụng và cảnh báo từ lead time

1. Khi QA tạo bản ghi nhận mẫu, hệ thống phải tính **hạn sử dụng** theo công thức:

   `Hạn sử dụng = Ngày QA nhận mẫu + thời hạn sử dụng mẫu chuẩn của Item`

   Ngày QA nhận mẫu là mốc chuẩn thống nhất của phiên bản đầu tiên; ngày lấy mẫu vẫn được lưu để truy xuất.
2. Hệ thống phải tính **ngày cảnh báo** theo công thức:

   `Ngày cảnh báo = Hạn sử dụng - lead time lấy mẫu mới của Item`

3. Khi ngày hiện tại đến hoặc vượt ngày cảnh báo trong khi mẫu chưa hết hạn, hệ thống phải:
   - đưa mẫu vào danh sách/dashboard cần xử lý;
   - gửi thông báo cho người/nhóm nhận cảnh báo của Item;
   - chuyển trạng thái mẫu sang **Cần thay mẫu**;
   - cho phép QA tạo Yêu cầu lấy mẫu chuẩn mới trực tiếp từ mẫu hoặc cảnh báo.
4. Khi ngày hiện tại vượt hạn sử dụng, hệ thống phải chuyển mẫu sang **Hết hạn / Chờ hủy**, không cho phép đánh dấu mẫu là khả dụng, và thông báo cho người phụ trách.
5. Khi tạo bản ghi nhận mẫu, hệ thống phải sao chép/snapshot thời hạn sử dụng, lead time, điều kiện bảo quản và người nhận cảnh báo từ cấu hình Item. Việc sửa cấu hình Item sau đó chỉ áp dụng cho các lần nhận mẫu mới; không thay đổi các giá trị lịch sử đã snapshot.

### FR-03 — QA nhận và lưu mẫu chuẩn

1. QA phải có thể tạo bản ghi khi nhận mẫu chuẩn từ R&D.
2. Thông tin tối thiểu của bản ghi gồm:
   - mã mẫu chuẩn do hệ thống sinh;
   - Item;
   - lô nguyên liệu/lô sản xuất liên quan nếu áp dụng;
   - ngày lấy mẫu;
   - ngày QA nhận mẫu;
   - lượng nhận và đơn vị, chỉ để tham chiếu/hiển thị tem;
   - hạn sử dụng và ngày cảnh báo do hệ thống tính;
   - điều kiện bảo quản;
   - vị trí lưu thực tế;
   - người R&D bàn giao và người QA nhận;
   - ghi chú và tệp đính kèm nếu có.
3. Vị trí lưu phải hỗ trợ mô tả tối thiểu theo cấu trúc: khu vực/phòng, tủ/kho, ngăn-kệ-vị trí; cho phép đơn vị triển khai dùng danh mục vị trí sẵn có nếu DCS đã có.
4. Sau khi nhận thành công, trạng thái ban đầu là **Đang lưu / Có hiệu lực**, trừ trường hợp dữ liệu thời gian cho thấy mẫu đã đến ngày cảnh báo hoặc hết hạn.
5. Hệ thống phải ghi nhận người tạo, thời điểm tạo, người cập nhật và thời điểm cập nhật. Không được xóa cứng bản ghi mẫu.

### FR-04 — Tem QR và tra cứu mẫu

1. QA phải có thể in tem QR cho mẫu chuẩn sau khi nhận.
2. Tem phải hiển thị tối thiểu: mã mẫu, mã/tên Item, nhóm Item, ngày QA nhận, hạn sử dụng, điều kiện bảo quản, vị trí lưu và QR.
3. QR phải mã hóa định danh nội bộ hoặc liên kết nội bộ có kiểm soát truy cập; không nhúng toàn bộ thông tin mẫu nhạy cảm trong QR.
4. Khi quét QR, người dùng có quyền phải xem được thông tin hiện tại và lịch sử phù hợp với quyền của mình.
5. Mỗi lần in lại tem phải lưu người in, thời điểm in và lý do in lại nếu tổ chức yêu cầu.

### FR-05 — Yêu cầu lấy mẫu chuẩn mới

1. QA phải có thể tạo một **Yêu cầu lấy mẫu chuẩn mới** từ bản ghi mẫu hoặc độc lập theo Item.
2. Yêu cầu phải có Item, mẫu liên quan nếu có, người yêu cầu, ngày yêu cầu, lý do và ghi chú.
3. Lý do chuẩn hóa tối thiểu: sắp hết hạn, hết hạn, không đủ mẫu vật lý, hư hỏng/không phù hợp, sự cố điều kiện bảo quản, thay đổi Item, lý do khác.
4. Hệ thống không phân biệt yêu cầu tái ký và yêu cầu cấp mẫu mới.
5. Việc tạo yêu cầu không tự động làm thay đổi hạn sử dụng của mẫu cũ. Mẫu mới được tạo thành một bản ghi nhận mới khi QA thực tế nhận từ R&D.
6. Mẫu ở trạng thái Đang lưu/Cần thay mẫu vẫn có thể có yêu cầu thủ công; việc ngăn trùng lặp hoặc cho phép nhiều yêu cầu mở phải theo quy tắc được nêu trong design và phải hiển thị cảnh báo cho QA.

### FR-06 — Trạng thái và chuyển trạng thái

Hệ thống chỉ dùng bốn trạng thái nghiệp vụ:

| Trạng thái | Ý nghĩa | Chuyển tiếp được phép |
|---|---|---|
| Đang lưu / Có hiệu lực | QA đã nhận và mẫu chưa đến ngày cảnh báo/hết hạn. | → Cần thay mẫu; → Hết hạn / Chờ hủy |
| Cần thay mẫu | Cần chuẩn bị mẫu thay thế do cảnh báo tự động hoặc yêu cầu thủ công. | → Hết hạn / Chờ hủy; không tự quay về Có hiệu lực |
| Hết hạn / Chờ hủy | Mẫu hết hạn hoặc đã được quyết định ngừng sử dụng, chờ hủy vật lý. | → Đã hủy |
| Đã hủy | Đã hoàn tất hủy; dữ liệu chỉ đọc. | Không có chuyển tiếp tiếp theo |

Bản ghi mẫu mới không thay đổi trạng thái mẫu cũ tự động, trừ khi người dùng thực hiện nghiệp vụ hủy theo quy trình.

### FR-07 — Hủy mẫu

1. QA phải có thể ghi nhận hủy mẫu ở trạng thái Hết hạn / Chờ hủy.
2. Thông tin hủy bắt buộc: ngày hủy, lý do hủy và người thực hiện. Các lý do chuẩn hóa gồm hết hạn, đã có mẫu thay thế, hư hỏng, sự cố bảo quản và lý do khác.
3. Nếu chính sách đơn vị yêu cầu, hệ thống phải hỗ trợ ghi người phê duyệt/người chứng kiến, ghi chú và tệp bằng chứng.
4. Sau khi hủy thành công, trạng thái là Đã hủy. Bản ghi hủy và lịch sử trạng thái không được chỉnh sửa/xóa không có dấu vết.

### FR-08 — Danh sách, dashboard và lịch sử

1. Hệ thống phải cho phép lọc/tìm kiếm theo Item, nhóm Item, trạng thái, hạn sử dụng, vị trí lưu, lô liên quan và người nhận mẫu.
2. Dashboard tối thiểu phải hiển thị: mẫu Cần thay mẫu, mẫu Hết hạn / Chờ hủy, yêu cầu lấy mẫu mới đang mở và mẫu theo vị trí lưu.
3. Chi tiết mẫu phải hiển thị lịch sử nhận, thay đổi trạng thái, yêu cầu lấy mẫu mới, in tem và hủy mẫu.

## 5. Quy tắc nghiệp vụ và tình huống biên

- Cảnh báo được đánh giá theo ngày hệ thống; phải xử lý đúng trường hợp ngày cảnh báo rơi vào cùng ngày nhận mẫu hoặc tác vụ nền chạy sau giờ cảnh báo.
- Nếu mẫu được tạo với hạn sử dụng đã hết, hệ thống không được đưa vào trạng thái Có hiệu lực mà phải đưa thẳng vào Hết hạn / Chờ hủy.
- Nếu nhiều mẫu cùng Item đang lưu, hệ thống theo dõi hạn và cảnh báo riêng từng bản ghi mẫu.
- Khi người dùng tạo yêu cầu mới cho một mẫu đã có yêu cầu mở, hệ thống phải cảnh báo và cho người dùng mở yêu cầu hiện hữu thay vì tạo trùng ngoài ý muốn.
- Điều kiện bảo quản và vị trí thực tế được lưu theo từng mẫu tại thời điểm nhận; thay đổi cấu hình chuẩn Item không ghi đè dữ liệu lịch sử.
- Mọi thao tác tạo, đổi trạng thái, tạo yêu cầu, in tem và hủy phải để lại audit trail theo chuẩn DCS.

## 6. Yêu cầu phi chức năng

- **Phân quyền:** kiểm tra quyền tại route/domain phía máy chủ; không dùng UI làm cơ chế bảo vệ.
- **Truy vết:** giữ lịch sử immutable/append-only đối với các sự kiện nghiệp vụ trọng yếu.
- **Tính đúng hạn:** job cảnh báo phải chạy ít nhất mỗi ngày và xử lý idempotent để không tạo nhiều chuyển trạng thái/thông báo trùng trong cùng sự kiện.
- **Bảo mật QR:** dữ liệu QR phải tuân theo quyền truy cập hiện có; không công khai dữ liệu mẫu nếu chưa có chính sách rõ ràng.
- **Khả dụng:** khi gửi thông báo lỗi, cảnh báo vẫn phải xuất hiện trên dashboard/danh sách để QA xử lý thủ công.

## 7. Tiêu chí chấp nhận

1. Quản trị/QA Lead cấu hình Item với hạn 180 ngày và lead time 30 ngày; không có trường nhập cảnh báo độc lập.
2. QA nhận mẫu ngày 01/01; hệ thống tính hạn 30/06 và ngày cảnh báo 31/05 theo timezone/nguyên tắc ngày đã thống nhất.
3. Đến 31/05, mẫu xuất hiện trong danh sách Cần thay mẫu, gửi thông báo và QA tạo được Yêu cầu lấy mẫu chuẩn mới.
4. QA có thể tạo yêu cầu thủ công khi thấy lượng vật lý không đủ mà không cần nhập hay cập nhật lượng còn lại trên hệ thống.
5. Sau hạn, mẫu chuyển Hết hạn / Chờ hủy và không còn được coi là khả dụng.
6. QA ghi nhận đủ thông tin hủy; mẫu chuyển Đã hủy và toàn bộ lịch sử vẫn tra cứu được.
7. Việc thay đổi lead time/hạn dùng tại Item không làm thay đổi hạn/ngày cảnh báo đã snapshot của mẫu đã nhận.
8. Tem QR hiển thị các trường yêu cầu và người không có quyền không truy cập được thông tin mẫu chỉ bằng QR.


## 8. Quyết định vận hành đã chốt cho MVP

Các quyết định dưới đây là yêu cầu đã chốt để triển khai MVP; không cần chờ tích hợp hoặc luồng phê duyệt bổ sung.

### 8.1 Danh mục Item và vị trí lưu

1. MVP sử dụng **danh mục Item nội bộ tối giản** của tính năng nếu DCS chưa có danh mục dùng lại được: mã Item duy nhất, tên Item, nhóm (Nguyên liệu/BTP/TP/Bao bì) và trạng thái hoạt động.
2. Không tích hợp ERP/LIMS trong MVP. Import/đồng bộ danh mục là phạm vi sau.
3. Mỗi Item có tối đa một cấu hình mẫu chuẩn hiện hành.
4. Vị trí lưu được quản lý bằng danh mục nội bộ theo ba cấp bắt buộc: **Khu vực/Phòng → Tủ/Kho → Ngăn/Kệ/Vị trí**. QA chọn từ danh mục, không nhập tự do thay cho vị trí chuẩn; có thể bổ sung ghi chú vị trí khi cần.
5. QA Lead quản lý danh mục Item, cấu hình mẫu chuẩn và danh mục vị trí lưu; Admin chỉ quản lý quyền theo chính sách hệ thống.

### 8.2 Phân quyền vận hành

1. **QA** được nhận/lưu mẫu, in/quét QR, xem dashboard, tạo yêu cầu mẫu mới, cập nhật ghi chú/vị trí theo quyền, ngừng sử dụng mẫu và ghi nhận hủy mẫu.
2. **QA Lead** có toàn bộ quyền QA, đồng thời quản lý Item/cấu hình/vị trí và theo dõi việc hủy/cảnh báo. MVP không thêm bước phê duyệt hủy riêng để giữ quy trình đơn giản.
3. **R&D** không thao tác ký chuẩn hay cập nhật trạng thái yêu cầu trong MVP; R&D chỉ là người/nhóm nhận thông báo theo cấu hình Item nếu có tài khoản DCS.
4. Mọi thao tác vẫn kiểm tra quyền ở phía máy chủ.

### 8.3 Cảnh báo và yêu cầu mẫu mới

1. MVP dùng **thông báo trong ứng dụng và dashboard**, không gửi email.
2. Khi đến ngày cảnh báo, hệ thống chuyển mẫu sang Cần thay mẫu và tạo thông báo một lần cho QA Lead và người/nhóm R&D được cấu hình tại Item.
3. Nếu chưa có yêu cầu mẫu mới đang mở cho mẫu/Item liên quan, dashboard phải hiển thị nhắc việc mỗi ngày. Khi đã có yêu cầu mở, hệ thống ngừng tạo cảnh báo tạo yêu cầu trùng nhưng vẫn hiển thị yêu cầu mở.
4. Mẫu Hết hạn / Chờ hủy phải được hiển thị trong dashboard cho đến khi hủy; không phụ thuộc việc gửi thông báo thành công.
5. Yêu cầu lấy mẫu mới chỉ có hai trạng thái: **Đang mở** và **Đã đóng**. QA tạo yêu cầu; R&D không có bước xác nhận/chuẩn bị/bàn giao trên hệ thống trong MVP.
6. Khi QA nhận mẫu mới, QA có thể chọn một yêu cầu đang mở của cùng Item; hệ thống tự liên kết mẫu mới với yêu cầu đó và đóng yêu cầu. QA vẫn có thể nhận mẫu không gắn yêu cầu.

### 8.4 QR, in tem, nhiều mẫu và hủy

1. MVP in tem bằng trình duyệt theo mẫu mặc định **50 × 30 mm**, một tem cho một mẫu; chưa tích hợp trực tiếp máy in hoặc thiết bị quét chuyên dụng.
2. QR chỉ chứa mã/định danh opaque của mẫu và luôn yêu cầu đăng nhập DCS để xem chi tiết.
3. Cho phép nhiều mẫu Đang lưu / Có hiệu lực cho cùng một Item. QA quyết định mẫu vật lý nào được sử dụng; hệ thống không chọn mẫu ưu tiên và không theo dõi lượng còn lại.
4. Việc nhận mẫu mới không tự động thay đổi hoặc hủy mẫu cũ. Mỗi mẫu cũ tiếp tục được theo dõi theo hạn riêng.
5. QA được phép chủ động **ngừng sử dụng** một mẫu trước hạn do hư hỏng, sự cố bảo quản hoặc đã có mẫu thay thế. Thao tác này bắt buộc chọn lý do, ghi audit trail, và chuyển mẫu sang Hết hạn / Chờ hủy để thực hiện hủy vật lý.
6. Ghi nhận hủy bắt buộc có ngày hủy, lý do và người thực hiện; người chứng kiến, người phê duyệt và bằng chứng đính kèm là tùy chọn trong MVP.
