# Bugfix Requirements Document

## Introduction

Tài liệu này xác định các sửa lỗi P1 và P2 được tổng hợp trong báo cáo rà soát test DCS. Mục tiêu là khôi phục các luồng quản lý tài liệu, quản trị tổ chức/người dùng và phân quyền bị ảnh hưởng, đồng thời không làm thay đổi hành vi hợp lệ ngoài điều kiện lỗi. Các mệnh đề 2.x là tiêu chí chấp nhận cho đầu ra đã sửa; các mệnh đề 3.x là tiêu chí kiểm thử hồi quy.

Một số quy tắc chưa có bằng chứng yêu cầu nghiệp vụ trong nguồn test và **phải được Product/QA/Security xác nhận trước khi triển khai**: phạm vi unique của mã/tên phòng ban theo site; chính sách xử lý tài khoản trùng; QR có bắt buộc cho bản hết hiệu lực, nội dung trạng thái/version và đối tượng được truy cập; phạm vi in/xuất PDF, tải và chia sẻ; và ma trận quyền chính thức cho QA Site B. Các mệnh đề liên quan yêu cầu hệ thống áp dụng chính sách đã được xác nhận, không tự giả định chính sách đó.

Bug condition `C(X)` là mọi yêu cầu hoặc thao tác `X` thỏa một điều kiện ở 1.1–1.12; property `P(result)` là kết quả tương ứng ở 2.1–2.12. Fix checking yêu cầu: với mọi `X` thỏa `C(X)`, phiên bản đã sửa `F'(X)` phải thỏa `P(result)`. Preservation checking yêu cầu: với mọi `X` không thỏa `C(X)`, hành vi của phiên bản đã sửa `F'(X)` phải tương đương phiên bản gốc `F(X)`, theo các mệnh đề 3.1–3.11.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an Author without approval permission opens an approval queue or calls an approval action THEN the system allows the Author to approve a document.

1.2 WHEN a QA Site B user without approval permission sees or directly accesses approval functionality THEN the system presents approval navigation inconsistently and the effective API authorization is unverified.

1.3 WHEN an administrator creates a department whose code or name collides with data at another site THEN the system can return HTTP 500 and expose a database unique-constraint failure.

1.4 WHEN an Author saves a document registration as a draft and reopens it THEN the system reports an error and does not allow the draft to be edited.

1.5 WHEN an Author creates an update or replacement version and selects or enters the wrong prior version THEN the system permits an ambiguous flow and submission can fail without reliably identifying the invalid prior-version reference.

1.6 WHEN an Author selects a major change and submits without a reason THEN the system blocks the request without displaying a clear error at the reason field.

1.7 WHEN an administrator removes one department from a user assigned to multiple departments THEN the system cannot reliably remove only the selected department association.

1.8 WHEN an administrator encounters a user considered duplicate THEN the system has no confirmed safe workflow to resolve that duplicate.

1.9 WHEN a QA Site B user signs in THEN the document menu does not match the recorded expected role experience, including an inappropriate approval-queue item and a missing “My documents” entry.

1.10 WHEN a user scans the QR code for an effective document THEN the QR destination does not display the document’s effective status.

1.11 WHEN a document version is expired THEN the system does not provide a QR-based history/status experience, although it is not yet confirmed whether such a QR is required by the business.

1.12 WHEN an authorized business user needs to print, export, download, distribute, or share an approved controlled document THEN the system does not provide a confirmed, permission-governed workflow.

### Expected Behavior (Correct)

2.1 WHEN an Author without approval permission opens an approval queue or calls an approval action THEN the system SHALL deny the approval action server-side, prevent a state transition, and retain an auditable record of the denied attempt according to the confirmed audit policy.

2.2 WHEN a QA Site B user without approval permission sees or directly accesses approval functionality THEN the system SHALL expose only navigation allowed by the confirmed role matrix and SHALL deny any approval action server-side regardless of UI visibility.

2.3 WHEN an administrator creates a department whose code or name collides with data at another site THEN the system SHALL apply the confirmed site-scoped or global uniqueness rule, reject an invalid request with a safe actionable 4xx validation response, and never expose an internal constraint failure or HTTP 500 for that validation case.

2.4 WHEN an Author saves a document registration as a draft and reopens it THEN the system SHALL load the saved draft and allow the Author to edit and save permitted fields without corrupting the draft state.

2.5 WHEN an Author creates an update or replacement version THEN the system SHALL require an unambiguous choice of create-new versus update-existing, require a valid eligible prior-version reference for an update, and identify invalid or stale references before approval submission.

2.6 WHEN an Author selects a major change and submits without a reason THEN the system SHALL prevent submission and display a clear validation error associated with the reason field.

2.7 WHEN an administrator removes one department from a user assigned to multiple departments THEN the system SHALL remove only the selected department association, persist the remaining associations, and show the saved result after reload.

2.8 WHEN an administrator encounters a user considered duplicate THEN the system SHALL apply the confirmed safe duplicate-account policy, including the authorized resolution action and preservation of required access and audit history.

2.9 WHEN a QA Site B user signs in THEN the system SHALL present the confirmed role-specific document navigation, including “My documents” if mandated by the role matrix, and SHALL not show approval functionality to a user lacking approval permission.

2.10 WHEN a user scans the QR code for an effective document THEN the system SHALL display the document identity, version, and an unambiguous effective status subject to the confirmed access policy.

2.11 WHEN a document version is expired THEN the system SHALL apply the confirmed expired-version QR policy: if historical QR access is required, it shall resolve to the identified version and visibly state that it is expired; if it is not required, direct or generated QR access shall be handled with the approved safe status response.

2.12 WHEN an authorized business user needs to print, export, download, distribute, or share an approved controlled document THEN the system SHALL provide only the confirmed permitted actions, enforce them server-side by role and document state, and prevent unauthorized direct access or sharing.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user has a role with valid approval permission and the document is eligible for approval THEN the system SHALL CONTINUE TO allow the approved workflow and record the approval according to the existing audit rules.

3.2 WHEN a user lacks approval permission and views non-approval document functions allowed by the role matrix THEN the system SHALL CONTINUE TO allow those permitted functions without granting approval capability.

3.3 WHEN an administrator creates a department whose code and name satisfy the confirmed uniqueness rule THEN the system SHALL CONTINUE TO create the department successfully for the selected site.

3.4 WHEN an Author opens a valid existing draft or starts a valid new registration THEN the system SHALL CONTINUE TO preserve entered permitted data and allow the applicable save or submit action.

3.5 WHEN an Author updates a document with a valid eligible prior version and all required change data THEN the system SHALL CONTINUE TO submit the version workflow successfully.

3.6 WHEN an Author selects a major change and supplies a valid reason THEN the system SHALL CONTINUE TO submit the request without a reason-field validation error.

3.7 WHEN an administrator edits a user with one or more valid department associations without removing an association THEN the system SHALL CONTINUE TO retain all saved associations after reload.

3.8 WHEN an administrator creates or edits a non-duplicate user under the confirmed identity policy THEN the system SHALL CONTINUE TO save the user without applying duplicate-resolution actions.

3.9 WHEN a user signs in with another role or a QA Site B role with confirmed non-approval permissions THEN the system SHALL CONTINUE TO display only the navigation and document access authorized for that role.

3.10 WHEN a user scans a QR code for an effective, expired, or unknown document version under the confirmed QR policy THEN the system SHALL CONTINUE TO resolve or reject access consistently without misrepresenting document status.

3.11 WHEN an authorized or unauthorized user requests a print, export, download, distribution, or sharing action outside the changed document state or role condition THEN the system SHALL CONTINUE TO allow or deny it according to the confirmed permissions without bypass through a direct URL or API request.
