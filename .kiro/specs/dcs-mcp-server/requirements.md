# Requirements Document

## Introduction

DCS_MCP_Server là một máy chủ Model Context Protocol (MCP) cho hệ thống DCS, cho phép các tác nhân AI truy vấn kho tài liệu của DCS ở chế độ chỉ đọc. Máy chủ được nhúng vào ứng dụng Fastify hiện có (một tiến trình duy nhất, phù hợp giới hạn RAM khoảng 1 GB), thêm điểm cuối `/mcp` vào `src/server.ts`, tái dùng pool kết nối postgres.js, lớp `registerAuth` và hàm `resolveSession`.

Máy chủ xây trên nền hạ tầng tìm kiếm toàn văn Markdown hiện có (`fn_search_limited`, cột `markdown_content`, khung nhìn `v_current_documents`). Mọi truy vấn phải truyền định danh người dùng thật vào các hàm cơ sở dữ liệu đã lọc phạm vi và hiệu lực, để tác nhân AI chỉ thấy đúng những tài liệu mà chính người dùng đứng sau phiên được phép thấy. Máy chủ không bao giờ bỏ qua lọc quyền và không phụ thuộc vào lớp AI (embedding, index_status).

Phạm vi MVP gồm hai công cụ chỉ đọc (`search_documents`, `get_document_markdown`) và một tài nguyên (`dcs://document/{id}`), tất cả đều lọc quyền theo người dùng.

## Glossary

- **DCS_MCP_Server**: Máy chủ MCP nhúng trong ứng dụng Fastify của DCS, phơi điểm cuối `/mcp` để tác nhân AI truy vấn tài liệu ở chế độ chỉ đọc.
- **MCP_Endpoint**: Điểm cuối HTTP `/mcp` sử dụng transport Streamable HTTP, đặt sau nginx reverse proxy nội bộ.
- **MCP_Client**: Tác nhân AI kết nối tới DCS_MCP_Server qua MCP_Endpoint.
- **Identity_Resolver**: Thành phần gọi `resolveSession(sql, sessionId)` để phân giải phiên thành `SessionUser`.
- **Session_Identifier**: Mã phiên (`session_id`) do nginx chuyển tiếp qua header tin cậy nội bộ hoặc cookie đã ký.
- **Resolved_User**: Đối tượng `SessionUser` trả về từ `resolveSession`, chứa `user_id` dạng UUID.
- **Search_Tool**: Công cụ MCP `search_documents(q, include_historical?, limit?)` bọc hàm `fn_search_limited`.
- **Document_Markdown_Tool**: Công cụ MCP `get_document_markdown(doc_id)` trả nội dung `markdown_content` của bản hiệu lực.
- **Document_Resource**: Tài nguyên MCP định danh `dcs://document/{id}` phơi `markdown_content` của một tài liệu.
- **Permission_Filtered_Query**: Truy vấn cơ sở dữ liệu nhận `user_id` thật và tự lọc phạm vi xem cùng hiệu lực ngay trong truy vấn (ví dụ `fn_search_limited`, `v_current_documents`).
- **Current_Version**: Bản hiệu lực hiện hành của một tài liệu, lấy từ `v_current_documents` hoặc `document_versions`.
- **Match_Level**: Mức khớp của một kết quả tìm kiếm, nhận giá trị `document`, `section` hoặc `fulltext`.
- **AI_Layer**: Lớp tính năng AI của DCS gồm bảng embedding và `index_status`.
- **Default_Result_Limit**: Số kết quả trả về mặc định khi MCP_Client không chỉ định `limit`, đặt bằng 20.
- **Maximum_Result_Limit**: Trần số kết quả tối đa mà Search_Tool trả về trong một lần gọi, đặt bằng 50.
- **Snippet_Cap**: Giới hạn độ dài đoạn trích (snippet) của mỗi kết quả tìm kiếm.

## Requirements

### Requirement 1: Phơi MCP qua điểm cuối nhúng

**User Story:** Là người vận hành DCS, tôi muốn phơi khả năng MCP qua một điểm cuối nhúng trong ứng dụng Fastify, để không phải chạy thêm tiến trình riêng trên máy chủ giới hạn bộ nhớ.

#### Acceptance Criteria

1. THE DCS_MCP_Server SHALL phơi MCP_Endpoint tại đường dẫn `/mcp` bằng transport Streamable HTTP.
2. THE DCS_MCP_Server SHALL chạy trong cùng một tiến trình với ứng dụng Fastify hiện có thông qua đăng ký route trong `src/server.ts`.
3. THE DCS_MCP_Server SHALL tái dùng pool kết nối postgres.js hiện có thay vì mở pool kết nối riêng.
4. THE DCS_MCP_Server SHALL nhận kết nối từ MCP_Client qua nginx reverse proxy nội bộ.

### Requirement 2: Xác thực danh tính qua phiên

**User Story:** Là quản trị viên bảo mật, tôi muốn mọi yêu cầu MCP được gắn với một người dùng đã xác thực, để tác nhân AI không truy cập tài liệu một cách nặc danh.

#### Acceptance Criteria

1. WHEN MCP_Client gửi yêu cầu kèm Session_Identifier, THE Identity_Resolver SHALL gọi `resolveSession(sql, sessionId)` để lấy Resolved_User.
2. WHEN `resolveSession` trả về Resolved_User, THE DCS_MCP_Server SHALL dùng `user_id` của Resolved_User cho mọi truy vấn trong yêu cầu đó.
3. IF yêu cầu MCP không kèm Session_Identifier, THEN THE DCS_MCP_Server SHALL trả về mã trạng thái HTTP 401.
4. IF `resolveSession` trả về null, THEN THE DCS_MCP_Server SHALL trả về mã trạng thái HTTP 401.
5. THE DCS_MCP_Server SHALL chỉ chấp nhận header danh tính do nginx nội bộ đặt và SHALL coi header danh tính đến từ nguồn bên ngoài là không hợp lệ.
6. THE DCS_MCP_Server SHALL phân giải danh tính qua Identity_Resolver cho mọi yêu cầu MCP mà không dùng tài khoản dịch vụ bỏ qua phân quyền.

### Requirement 3: Tìm kiếm tài liệu lọc quyền

**User Story:** Là người dùng tài liệu, tôi muốn tác nhân AI tìm được tài liệu đúng phạm vi tôi được phép xem, để kết quả tìm kiếm tôn trọng quyền của tôi.

#### Acceptance Criteria

1. WHEN MCP_Client gọi Search_Tool, THE Search_Tool SHALL truyền `user_id` của Resolved_User vào hàm `fn_search_limited`.
2. THE Search_Tool SHALL trả về kết quả đã lọc phạm vi xem và hiệu lực do `fn_search_limited` áp dụng trong truy vấn, không lọc lại sau truy vấn.
3. WHERE MCP_Client truyền tham số `include_historical` bằng true, THE Search_Tool SHALL truyền giá trị đó vào `fn_search_limited` để bao gồm cả bản không hiệu lực mà người dùng được phép xem.
4. WHERE MCP_Client không truyền tham số `include_historical`, THE Search_Tool SHALL chỉ trả về bản hiệu lực.
5. THE Search_Tool SHALL trả về trường Match_Level cho mỗi kết quả với giá trị `document`, `section` hoặc `fulltext`.

### Requirement 4: Đọc Markdown tài liệu lọc quyền

**User Story:** Là người dùng tài liệu, tôi muốn tác nhân AI chỉ đọc được nội dung Markdown của tài liệu mà tôi có quyền xem, để tài liệu ngoài phạm vi không bị lộ.

#### Acceptance Criteria

1. WHEN MCP_Client gọi Document_Markdown_Tool với `doc_id` mà Resolved_User có quyền xem, THE Document_Markdown_Tool SHALL trả về `markdown_content` của Current_Version lấy từ `v_current_documents` hoặc `document_versions`.
2. IF Resolved_User không có quyền xem tài liệu ứng với `doc_id`, THEN THE Document_Markdown_Tool SHALL từ chối yêu cầu mà không trả về nội dung tài liệu.
3. IF Resolved_User không có quyền xem tài liệu ứng với `doc_id`, THEN THE Document_Markdown_Tool SHALL phản hồi theo cách không phân biệt được giữa tài liệu không tồn tại và tài liệu nằm ngoài phạm vi của Resolved_User.
4. THE Document_Markdown_Tool SHALL xác định quyền xem bằng Permission_Filtered_Query truyền `user_id` của Resolved_User.

### Requirement 5: Tài nguyên tài liệu lọc quyền

**User Story:** Là người tích hợp tác nhân AI, tôi muốn truy cập tài liệu qua tài nguyên MCP theo định danh ổn định, để tham chiếu tài liệu bằng URI nhất quán.

#### Acceptance Criteria

1. WHEN MCP_Client đọc Document_Resource `dcs://document/{id}` với `id` mà Resolved_User có quyền xem, THE Document_Resource SHALL trả về `markdown_content` của Current_Version.
2. THE Document_Resource SHALL xác định quyền xem bằng Permission_Filtered_Query truyền `user_id` của Resolved_User.
3. IF Resolved_User không có quyền xem tài liệu ứng với `id`, THEN THE Document_Resource SHALL từ chối yêu cầu mà không trả về nội dung tài liệu.
4. IF Resolved_User không có quyền xem tài liệu ứng với `id`, THEN THE Document_Resource SHALL phản hồi theo cách không phân biệt được giữa tài liệu không tồn tại và tài liệu nằm ngoài phạm vi của Resolved_User.

### Requirement 6: Giới hạn khối lượng kết quả

**User Story:** Là người vận hành DCS, tôi muốn giới hạn khối lượng dữ liệu mỗi lần gọi trả về, để tác nhân AI không kéo toàn bộ bảng và làm quá tải máy chủ.

#### Acceptance Criteria

1. WHERE MCP_Client không truyền tham số `limit`, THE Search_Tool SHALL trả về tối đa Default_Result_Limit kết quả.
2. WHERE MCP_Client truyền `limit` lớn hơn Maximum_Result_Limit, THE Search_Tool SHALL giới hạn số kết quả trả về bằng Maximum_Result_Limit.
3. THE Search_Tool SHALL cắt mỗi đoạn trích kết quả theo Snippet_Cap.

### Requirement 7: Giao diện chỉ đọc

**User Story:** Là quản trị viên bảo mật, tôi muốn giao diện MCP chỉ đọc, để tác nhân AI không thể thay đổi dữ liệu DCS.

#### Acceptance Criteria

1. THE DCS_MCP_Server SHALL phơi duy nhất các công cụ và tài nguyên chỉ đọc.
2. WHEN DCS_MCP_Server thực thi một công cụ hoặc tài nguyên, THE DCS_MCP_Server SHALL chỉ thực hiện thao tác đọc trên cơ sở dữ liệu.

### Requirement 8: Độc lập với lớp AI

**User Story:** Là người vận hành DCS, tôi muốn truy vấn MCP hoạt động độc lập với lớp AI, để kho tài liệu vẫn tra cứu được khi lớp AI ngừng.

#### Acceptance Criteria

1. THE DCS_MCP_Server SHALL truy xuất dữ liệu chỉ qua `fn_search_limited`, `v_current_documents` và `document_versions`.
2. THE DCS_MCP_Server SHALL phục vụ yêu cầu của MCP_Client mà không đọc bảng embedding hoặc `index_status` của AI_Layer.

## Out of Scope

Các hạng mục sau không thuộc phạm vi MVP và được ghi nhận là hướng phát triển tương lai:

- **Prompts MCP**: Không cung cấp prompts trong MVP.
- **Công cụ ghi hoặc sửa dữ liệu**: Không có công cụ thay đổi dữ liệu; giao diện hoàn toàn chỉ đọc.
- **OAuth 2.1 server riêng**: Không triển khai máy chủ OAuth 2.1 độc lập; danh tính dựa trên phiên hiện có.
- **Công cụ bổ sung**: `get_effective_version` và `list_recent` không thuộc MVP.
