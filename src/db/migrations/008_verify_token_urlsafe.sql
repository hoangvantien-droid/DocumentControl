-- 008_verify_token_urlsafe.sql — Fix QR route 404 cho token base64 chứa +/=.
--
-- Triệu chứng: /verify/:token trả 404 khi token in ra chứa '/' hoặc '='
--   vì Fastify coi chúng là phần đường dẫn (vd /verify/abc/def).
--
-- Sửa:
--   1. Nới cột verify_token lên VARCHAR(48) để chứa base64url 43 ký tự an toàn.
--   2. Đổi DEFAULT sang encode(gen_random_bytes(32), 'base64') rồi thay thế
--      '+' -> '-', '/' -> '_', xóa '='. PostgreSQL chưa có hàm base64url nên
--      dùng regexp_replace.
--   3. Chuyển các token cũ (base64 thường) sang base64url để QR cũ vẫn tra cứu
--      được. Không có xung đột UNIQUE vì base64url là ánh xạ 1-1 từ base64.

DO $$
DECLARE v_len INTEGER;
BEGIN
    SELECT character_maximum_length INTO v_len
      FROM information_schema.columns
     WHERE table_name = 'printed_copies'
       AND column_name = 'verify_token';

    IF v_len IS NULL THEN
        RAISE NOTICE 'Bỏ qua: không tìm thấy cột printed_copies.verify_token';
    ELSIF v_len < 48 THEN
        ALTER TABLE printed_copies
            ALTER COLUMN verify_token TYPE VARCHAR(48);
        RAISE NOTICE 'Đã nới printed_copies.verify_token lên VARCHAR(48)';
    END IF;
END $$;

-- DEFAULT mới: base64url (không +/=).
ALTER TABLE printed_copies
    ALTER COLUMN verify_token SET DEFAULT regexp_replace(
        encode(gen_random_bytes(32), 'base64'),
        '[+/=]', '-', 'g'
    );

-- Chuyển token cũ base64 -> base64url. Dùng translate + xóa đệm.
UPDATE printed_copies
   SET verify_token = translate(
       rpad(verify_token, 44, '='),  -- đảm bảo đủ đệm trước khi decode nếu cần
       '+/=',
       '-_'
   )
 WHERE verify_token LIKE '%+%'
    OR verify_token LIKE '%/%'
    OR verify_token LIKE '%=%';

-- Làm sạch đệm '=' còn sót (nếu có).
UPDATE printed_copies
   SET verify_token = rtrim(verify_token, '=')
 WHERE verify_token LIKE '%=%';

-- Đảm bảo ràng buộc UNIQUE vẫn sạch sau khi đổi.
-- PostgreSQL sẽ tự kiểm tra khi UPDATE xong.
