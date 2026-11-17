# Changelog

## Giai đoạn 9–10 — 2026-11-17

- Thêm bạn bè qua username/link, chặn, tùy chọn quyền riêng tư và thông báo.
- Thêm Squad 2–10 người, chuỗi ngày, khiên/ngày nghỉ, thử thách, bảng tuần và phiên Focus xác thực bằng RPC máy chủ.
- Thêm phòng công khai/riêng/Squad, Presence/Broadcast, đồng hồ chung, chat, nhạc YouTube, lịch hẹn và công cụ kiểm duyệt.
- Mở rộng `schema.sql` với RLS, RPC có kiểm tra thành viên, giới hạn tốc độ và test tích hợp cộng đồng.
- Bản phát hành chưa được kiểm thử cloud/Realtime vì chưa có project Supabase và hai tài khoản test.

## Giai đoạn 8 — 2026-11-17

- Thêm Supabase Auth, hồ sơ và avatar SVG; chế độ Khách vẫn chạy độc lập.
- Thêm schema RLS, RPC idempotent, đồng bộ outbox IndexedDB, Realtime và polling dự phòng.
- Thêm thùng rác, lịch sử ghi chú, xử lý xung đột, checksum sao lưu và workflow chống pause.
- Bổ sung test mô hình đồng bộ và kịch bản RLS tích hợp; cloud thực tế cần project Supabase để kiểm tra.

## Giai đoạn 7 — 2026-11-17

- Đổi tên StudyNest thành studywithducnh.
- Gỡ flashcard, habit tracker, quiz và thuật toán SM-2 khỏi giao diện và mã chạy.
- Gỡ phòng WebRTC cũ; phòng Supabase Realtime sẽ được xây ở Giai đoạn 10.
- Di chuyển dữ liệu localStorage và IndexedDB, giữ khóa cũ ít nhất 30 ngày.
- Nếu có flashcard hoặc thói quen, tự tải JSON, yêu cầu xác nhận trước khi dọn và giữ bản phục hồi 30 ngày.
- Thay logo, icon PWA, cache, metadata và tên file sao lưu.
