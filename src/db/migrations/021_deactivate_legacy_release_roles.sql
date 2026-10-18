-- 021_deactivate_legacy_release_roles.sql — vô hiệu hóa vai duyệt-trước cũ.
--
-- Mô hình receipt mới bỏ hẳn vai gác cổng nguồn (DC_DEPT_HEAD + Site QA / BU
-- owner / Group owner). Code đã gỡ mọi tham chiếu runtime. Migration này đặt
-- is_active=FALSE cho các bản ghi vai cũ còn sót, để chúng KHÔNG còn phát huy
-- tác dụng (ví dụ lọt vào menu/quyền). KHÔNG xóa bản ghi — giữ cho ghi vết.
--
-- Giữ CHECK constraint ở migration 018 (vẫn cho phép mã cũ tồn tại ở trạng
-- thái inactive để dữ liệu lịch sử không vi phạm ràng buộc).

UPDATE user_roles
   SET is_active = FALSE
 WHERE is_active
   AND role_code IN ('DC_DEPT_HEAD', 'DC_SITE_QA_MANAGER', 'DC_BU_OWNER', 'DC_GROUP_OWNER');
