-- 027_report_content_error_after_accept.sql — đường "báo sai nội dung sau khi
-- site đã chấp nhận" (điểm 7).
--
-- Trước đây convertReportToRejection đóng report thành 'chuyen_phan_hoi' và ghi
-- nhật ký từ chối, nhưng UPDATE receipt (... AND status='cho_phan_hoi') là
-- no-op khi receipt đã 'chap_nhan' — lệch dữ liệu (report đóng + audit từ chối
-- còn receipt vẫn chấp nhận). Nay:
--   • sai_dang_ky sau khi đã chấp nhận -> BỊ CHẶN ở domain (phải thu hồi + bản mới).
--   • sai_noi_dung sau khi đã chấp nhận -> report sang trạng thái mới
--     'bao_sai_noi_dung_sau_chap_nhan', receipt GIỮ 'chap_nhan', ghi audit riêng.
--
-- KHÔNG sửa 001-026 (runner append-only, đã áp dụng). Mở rộng CHECK bằng cách
-- drop + add lại (giữ toàn bộ mã cũ).

-- document_issue_report.status: nới độ dài cột + bổ sung giá trị mới.
-- Giá trị mới dài 30 ký tự > VARCHAR(15) hiện tại nên phải mở rộng cột.
ALTER TABLE document_issue_report
    ALTER COLUMN status TYPE VARCHAR(40);

-- CHECK status là ràng buộc inline không đặt tên -> Postgres tự sinh tên
-- 'document_issue_report_status_check'. Drop IF EXISTS rồi tạo lại có tên rõ.
ALTER TABLE document_issue_report
    DROP CONSTRAINT IF EXISTS document_issue_report_status_check;
ALTER TABLE document_issue_report
    ADD CONSTRAINT document_issue_report_status_check
    CHECK (status IN ('moi', 'chuyen_phan_hoi', 'bac_bo',
                       'bao_sai_noi_dung_sau_chap_nhan'));

-- audit_log.event_type: bổ sung sự kiện mới (giữ toàn bộ mã cũ từ 022).
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_event_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_event_type_check
    CHECK (event_type IN (
        'nop_dang_ky', 'rut_lai', 'sua_truoc_khi_nop',
        'xac_nhan', 'tu_choi_boi_admin', 'tu_choi_tu_dong', 'tich_checklist',
        'chuyen_hieu_luc', 'chuyen_het_hieu_luc', 'thu_hoi',
        'khai_nhan', 'sua_nhan', 'xac_nhan_nhan_chep',
        'xem', 'tai', 'in', 'tra_cuu_qr', 'xac_nhan_doc', 'hoi_ai',
        'xem_so_sanh', 'tim_kiem',
        'sua_ma_tran', 'gui_thong_bao',
        'sinh_ra_soat', 'ket_luan_ra_soat', 'dong_ra_soat_theo_ban_moi',
        'tao_goi', 'gan_vao_goi', 'doi_ngay_goi', 'thao_thanh_vien',
        'giai_the_goi', 'kich_hoat_goi', 'leo_thang',
        'sua_khan_cap', 'dong_hau_kiem_khan_cap',
        'kiem_toan_ven_tep', 'tieu_huy_ho_so', 'doi_so_hieu', 'dong_bo_l1',
        'ban_hanh', 'chap_nhan_nhan', 'tu_choi_nhan', 'tu_phan_hoi_canh_bao',
        'sua_dang_ky', 'xoa_ban_hanh',
        'bao_bat_thuong', 'chuyen_report_phan_hoi', 'bac_bo_report',
        'thu_hoi_ban_in',
        'bao_sai_noi_dung_sau_chap_nhan'
    ));
