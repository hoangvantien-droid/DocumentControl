# Requirements Document

## Introduction

Trang "Xem xét định kỳ" (`/reviews`) hiện CHỈ dành cho vai Biên soạn (Author):
menu hiện khi `nav.canRegister`, dữ liệu lấy theo BỘ PHẬN SỞ HỮU
(`reviewBacklogForOwner`), và Author được KẾT LUẬN rà soát (Giữ nguyên / Cần sửa
/ Hủy bỏ). Vai Kiểm soát tài liệu site (DC_SITE_DOC_CONTROL) không thấy gì.

Nhu cầu: DC Site cần THEO DÕI tài liệu tới hạn/quá hạn xem xét mà đã phát hành
tới site mình phụ trách, để đôn đốc — NHƯNG không kết luận thay bộ phận sở hữu.

Hướng đã chốt (Cách 3):
- DC Site thấy một BẢNG NHẮC chỉ-đọc (không có nút kết luận) trên CHÍNH trang
  `/reviews` (dùng chung, không trang riêng).
- Phạm vi: tài liệu có receipt phát hành TỚI SITE mà người dùng phụ trách.
- Kết luận rà soát GIỮ NGUYÊN chỉ cho bộ phận sở hữu (Author). DC Site không ra
  verdict.

Không đổi: logic kết luận, enum, schema. Tái dùng `v_review_backlog`,
`siteIdsWithDocControl`.

## Requirements

### Requirement 1: DC Site truy cập được trang Xem xét định kỳ

**User Story:** Là Kiểm soát tài liệu site, tôi muốn mở được trang Xem xét định
kỳ, để theo dõi tài liệu tới hạn ở site mình.

#### Acceptance Criteria
1. WHEN người dùng có vai DC_SITE_DOC_CONTROL THEN menu điều hướng SHALL hiển thị
   mục "Xem xét định kỳ".
2. WHEN DC Site mở `/reviews` THEN route SHALL cho vào (không 403) và hiển thị
   phần dành cho DC Site.
3. The system SHALL giữ nguyên quyền vào `/reviews` của Author (canRegister).

### Requirement 2: Bảng nhắc chỉ-đọc theo site cho DC Site

**User Story:** Là DC Site, tôi muốn thấy danh sách tài liệu tới hạn/quá hạn xem
xét đã phát hành tới site mình, nhưng chỉ để theo dõi.

#### Acceptance Criteria
1. WHEN DC Site mở `/reviews` THEN hệ thống SHALL hiển thị bảng các bản ghi rà
   soát (từ `v_review_backlog`) của tài liệu CÓ RECEIPT tới site mà người dùng
   phụ trách (qua `siteIdsWithDocControl`).
2. The system SHALL hiển thị tối thiểu: số hiệu + phiên bản, tiêu đề, hạn xem
   xét, số ngày quá hạn.
3. The system SHALL NOT hiển thị form/nút kết luận (Giữ nguyên/Cần sửa/Hủy bỏ)
   trong bảng của DC Site — chỉ đọc.
4. IF DC Site không phụ trách site nào, hoặc không có tài liệu tới hạn tới site
   mình THEN hệ thống SHALL nêu rõ "không có tài liệu nào tới hạn xem xét".
5. The system SHALL hiển thị trong phạm vi quyền hiện có — chỉ dùng dữ liệu
   receipt/review mà người dùng vốn được thấy; KHÔNG nới quyền.

### Requirement 3: Kết luận rà soát không đổi

**User Story:** Là người bảo trì, tôi muốn giữ nguyên nguyên tắc chỉ bộ phận sở
hữu kết luận rà soát.

#### Acceptance Criteria
1. The system SHALL chỉ cho người thuộc BỘ PHẬN SỞ HỮU tài liệu ghi kết luận
   (`recordVerdict` không đổi).
2. IF DC Site cố gọi POST `/reviews/:id/verdict` cho tài liệu không thuộc bộ phận
   sở hữu của mình THEN hệ thống SHALL từ chối (403) như hiện tại.
3. The system SHALL KHÔNG thêm quyền kết luận nào cho DC Site.

### Requirement 4: Người dùng có cả hai vai

**User Story:** Là người vừa là Author vừa là DC Site (hiếm), tôi muốn thấy cả
phần kết luận (của bộ phận mình) lẫn bảng nhắc theo site, không bị trùng rối.

#### Acceptance Criteria
1. WHEN người dùng vừa canRegister vừa isSiteDocControl THEN `/reviews` SHALL
   hiển thị cả phần kết luận (theo bộ phận sở hữu) VÀ bảng nhắc theo site.
2. The system SHALL phân tách rõ hai phần bằng tiêu đề để không nhầm lẫn.

### Requirement 5: Không thay đổi ngoài phạm vi

**User Story:** Là người bảo trì, tôi muốn thay đổi an toàn.

#### Acceptance Criteria
1. The system SHALL NOT thêm migration / đổi schema.
2. The system SHALL NOT đổi `recordVerdict`, `reviewBacklogForOwner`, enum
   verdict/status.
3. The system SHALL NOT đổi luồng rà soát của Author.

## Glossary

- **Xem xét định kỳ (rà soát):** chu trình đánh giá lại tài liệu khi tới hạn
  (`next_review_date`); bản ghi ở `periodic_reviews`, tồn đọng ở `v_review_backlog`.
- **Kết luận (verdict):** Giữ nguyên / Cần sửa / Hủy bỏ — chỉ bộ phận sở hữu.
- **Bộ phận sở hữu (`owner_department_id`):** bộ phận chịu trách nhiệm tài liệu;
  cơ sở quyền kết luận rà soát.
- **DC Site (DC_SITE_DOC_CONTROL):** vai kiểm soát tài liệu theo site; phụ trách
  một hoặc nhiều site qua `siteIdsWithDocControl`.
- **Bảng nhắc chỉ-đọc:** danh sách tài liệu tới hạn xem xét đã phát hành tới site
  DC Site phụ trách, hiển thị để theo dõi, KHÔNG có hành động kết luận.
