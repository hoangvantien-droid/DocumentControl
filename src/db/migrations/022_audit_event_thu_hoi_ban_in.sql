-- 022_audit_event_thu_hoi_ban_in.sql — thêm sự kiện thu hồi bản in tại hiện trường.
-- Bổ sung vào CHECK audit_log.event_type (giữ toàn bộ mã cũ).
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
        'thu_hoi_ban_in'
    ));
