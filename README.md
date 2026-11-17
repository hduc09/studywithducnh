# studywithducnh

studywithducnh là ứng dụng học tập chạy bằng HTML, CSS và JavaScript thuần trên GitHub Pages. Đây là bản **Giai đoạn 10**: tài khoản Supabase và đồng bộ local-first (GĐ8), bạn bè và Squad Streak (GĐ9), phòng học chung với Supabase Realtime (GĐ10). Ứng dụng vẫn dùng được khi không có mạng ở chế độ Khách.

**Trạng thái hiện tại:** chế độ Khách dùng ngay. Đăng nhập, đồng bộ, bạn bè, Squad và phòng chung chỉ hoạt động sau khi chủ dự án tạo Supabase, chạy SQL và điền URL/anon key công khai. Bản phát hành chưa có project/khóa. Luồng nhiều tài khoản và Realtime chưa được kiểm thử trực tiếp.

## Dữ liệu khi nâng cấp

Khi mở bản mới trên **cùng trình duyệt và cùng tên miền GitHub Pages**, ứng dụng sao chép dữ liệu từ khóa cũ sang khóa mới. Khóa cũ được giữ ít nhất 30 ngày. Ảnh/video nền trong IndexedDB được sao chép sang cơ sở dữ liệu mới; bản cũ không bị xóa.

Nếu có dữ liệu của hai mục đã gỡ, ứng dụng tự tạo một file JSON và hiện hộp thoại. Hãy kiểm tra file trong thư mục **Tải xuống**. Nếu trình duyệt chặn tải tự động, bấm **Tải lại file**. Chỉ bấm **Đã lưu file** sau khi thấy file đã tải. Lúc đó dữ liệu của hai mục mới được tách khỏi store đang dùng; bản lưu phục hồi ở trên thiết bị thêm 30 ngày. Vào **Cài đặt → Dữ liệu → Tải lại bản lưu cũ** để tải lại bản đó.

Nếu bộ nhớ đầy, thao tác dọn dữ liệu cũ sẽ dừng; bản gốc vẫn được giữ. Không hệ thống nào có thể hứa an toàn dữ liệu tuyệt đối. Hãy giữ thêm file sao lưu JSON ở nơi bạn kiểm soát.

## Chức năng đang dùng

- Dashboard dạng thẻ có thể sắp xếp, ẩn/hiện và đổi kích thước.
- 10 theme, nền ảnh/video, màu nhấn, font, chế độ Zen.
- Pomodoro, bấm giờ, Flowtime, đếm ngược, nhắc nghỉ mắt và ghi nhanh suy nghĩ.
- Việc học, môn học, mục tiêu, thống kê phiên học, XP và cây học tập.
- Mixer âm thanh, nguồn nhạc nhúng, ghi chú Markdown, scratchpad, thời khóa biểu và lịch.
- Bảng lệnh Ctrl/Cmd + K, widget giờ/thời tiết, sao lưu/khôi phục JSON.
- PWA với app shell dùng được offline.
- Bạn bè qua username/link, lời mời, chặn, quyền riêng tư và thông báo trong app.
- Squad 2–10 người với mục tiêu Focus, lịch chuỗi, khiên tuần, ngày nghỉ, thử thách và bảng tuần tùy chọn. Phút cho Squad lấy từ phiên Focus được máy chủ ghi nhận, không lấy từ phiên nhập tay.
- Phòng công khai/riêng/Squad 2–20 người, mã/mật khẩu, avatar Presence, đồng hồ chung theo thời gian máy chủ, cam kết, chat, phản ứng, báo cáo, kiểm duyệt, nhạc YouTube, lịch hẹn RSVP. Camera/mic mặc định không dùng.

Dữ liệu được ghi vào localStorage và IndexedDB theo từng tài khoản; thay đổi được xếp vào outbox trước khi gửi. Sau khi cấu hình Supabase, cùng tài khoản có thể đồng bộ qua Realtime và polling 60 giây. Ảnh/video nền tải lên chỉ nằm trên thiết bị này; dùng xuất JSON để chuyển nền sang thiết bị khác.

## Cây thư mục

    index.html
    manifest.json
    sw.js
    .nojekyll
    README.md
    CHANGELOG.md
    css/ base.css, themes.css, components.css, animations.css, stage2.css, stage3.css
    js/ main.js, store.js, migration.js, timer.js, tasks.js, subjects.js,
        stats.js, audio.js, notes.js, planner.js, gamification.js,
        themes.js, commands.js, utility.js, i18n.js, utils.js,
        config.js, cloud.js, account.js, sync.js, localdb.js, sync-model.js,
        community.js, rooms.js, focus-verification.js
    supabase/schema.sql
    .github/workflows/keep-supabase-awake.yml
    assets/avatars/ moon.svg, sun.svg, leaf.svg, star.svg, wave.svg, book.svg
    assets/icons/ icon.svg, icon-192.png, icon-512.png,
                  icon-maskable.svg, icon-maskable-192.png, icon-maskable-512.png
    assets/audio/README.md
    assets/backgrounds/README.md
    tests/migration.test.mjs, sync-model.test.mjs,
          rls.integration.mjs, community.integration.mjs

## Chạy trên máy

Dùng static server vì ứng dụng sử dụng ES Modules. Ví dụ với Node.js: chạy lệnh **npx serve .** ở thư mục chứa index.html. Không cần bước build hay package JavaScript trong ứng dụng. Manifest của bản phát hành dùng đường dẫn /studywithducnh/ để cài PWA từ GitHub Pages; giao diện vẫn chạy khi xem tại localhost.

## Đưa lên GitHub Pages

Repository chính: https://github.com/hduc09/studywithducnh . Trang đã xuất bản: https://hduc09.github.io/studywithducnh/ .

1. Đặt toàn bộ file ở gốc nhánh main; index.html phải nằm ngay ở gốc repository.
2. Mở **Settings → Pages**.
3. Chọn **Deploy from a branch**, nhánh main, thư mục / (root), rồi bấm **Save**.
4. Đợi workflow pages-build-deployment hoàn tất và mở URL trên.
5. Sau khi cập nhật phiên bản, tải lại trang khi ứng dụng hiện thông báo có bản mới.

Service worker chỉ cache file của ứng dụng trên cùng origin, không cache API bên ngoài. Font và thời tiết cần mạng; khi offline, font hệ thống thay thế và thời tiết cũ có thể tiếp tục hiển thị.

## Phím tắt

| Phím | Tác dụng |
| --- | --- |
| Ctrl/Cmd + K | Mở bảng lệnh |
| ↑ / ↓ / Enter | Chọn và chạy lệnh trong bảng lệnh |
| Space | Bắt đầu hoặc tạm dừng đồng hồ khi không nhập văn bản |
| ? | Xem bảng phím tắt |
| F | Toàn màn hình khi ở Zen |
| Esc | Thoát Zen hoặc đóng bảng lệnh |

## Checklist tự kiểm tra Giai đoạn 8

- [ ] Mở bản mới trên trình duyệt đã có dữ liệu: tên, việc, môn, ghi chú, lịch và phiên học vẫn còn.
- [ ] Kiểm tra file JSON được tải tự động khi có dữ liệu của hai mục đã gỡ.
- [ ] Bấm **Để sau**, tải lại trang: dữ liệu cũ vẫn chờ xác nhận.
- [ ] Bấm **Đã lưu file** sau khi kiểm tra file: giao diện tiếp tục hoạt động, dữ liệu học còn nguyên.
- [ ] Vào Cài đặt → Dữ liệu → **Tải lại bản lưu cũ**, kiểm tra file phục hồi.
- [ ] Thử nhập file sao lưu hỏng: dữ liệu hiện có vẫn còn.
- [ ] Tắt mạng rồi tải lại sau khi đã mở ứng dụng ít nhất một lần.
- [ ] Kiểm tra giao diện ở 360 px, bàn phím Tab, theme sáng/tối và chế độ giảm chuyển động.
- [ ] Kiểm tra tên mới ở tab, logo, thông báo, tên file sao lưu và PWA.
- [ ] Kiểm tra mọi mục menu, bảng lệnh và link không dẫn đến trang đã gỡ.
- [ ] Cấu hình Supabase rồi đăng ký, xác minh email, đăng nhập và lưu username/avatar/múi giờ.
- [ ] Thử magic link, quên/đổi mật khẩu, đổi email, đăng xuất; Google chỉ khi đã bật provider.
- [ ] Tạo ghi chú ở chế độ Khách, đăng nhập, chọn **Đưa vào tài khoản**, kiểm tra số lượng và checksum rồi mở trên thiết bị thứ hai.
- [ ] Sửa ghi chú offline; kết nối lại và xem badge đồng bộ. Thử sửa cùng một ghi chú ở hai thiết bị rồi giải quyết xung đột.
- [ ] Xóa ghi chú, mở Thùng rác, khôi phục; thử xóa vĩnh viễn sau khi cloud xác nhận.
- [ ] Xuất và nhập JSON có checksum; chọn file sao lưu tự động trên trình duyệt hỗ trợ File System Access.

## Checklist tự kiểm tra Giai đoạn 9–10

- [ ] Dùng hai tài khoản đã xác minh: A tìm username B, gửi lời mời; B chấp nhận/từ chối; thử hủy, hủy kết bạn và chặn. Kiểm tra trạng thái/phút của B chỉ hiện khi B bật chia sẻ.
- [ ] Tạo Squad, nhập mã từ tài khoản thứ hai, kiểm tra giới hạn 10 thành viên, quyền admin, rời/chuyển chủ, mục tiêu ngày, khiên tuần và ngày nghỉ. Thử nhập phiên học bằng tay: phút Squad không tăng.
- [ ] Focus 25 phút bằng đồng hồ app, kiểm tra máy chủ ghi phiên và Squad cập nhật theo múi giờ; tạm dừng/bỏ dở thì không nhận phút gian lận. Thử hai tab cùng tài khoản.
- [ ] A tạo phòng riêng có mật khẩu; B vào bằng mã và mật khẩu. Tài khoản ngoài không thể đọc chat hay xem Squad; chạy `tests/community.integration.mjs` để xác nhận RLS.
- [ ] Chat, trả lời, reaction, báo cáo, mute/kick/ban, lọc từ, khóa phòng và chuyển host. Thử gửi liên tiếp >1 tin/giây, >20 tin/phút và tin dài >500 ký tự.
- [ ] Đồng hồ chung trên hai thiết bị có giờ hệ thống lệch nhau; bật/tắt mạng giữa phiên, tải lại trang, thử nhạc YouTube, scene, Zen và lịch hẹn RSVP.
- [ ] Thử màn hình 360 px, bàn phím và offline: phần học cá nhân vẫn dùng được; phòng báo Realtime tạm ngắt và polling dự phòng.

## Kiểm thử tự động

Chạy **node --test tests/*.test.mjs**. Bộ test thuần kiểm tra migration, giữ bản gốc, từ chối dọn khi hết quota, checksum, bản xung đột không ghi đè, soft delete và patch theo trường. Hai file `tests/rls.integration.mjs` và `tests/community.integration.mjs` yêu cầu project và hai tài khoản test; đặt biến môi trường `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEST_USER_A_EMAIL`, `TEST_USER_A_PASSWORD`, `TEST_USER_B_EMAIL`, `TEST_USER_B_PASSWORD`, rồi chạy lần lượt `node tests/rls.integration.mjs` và `node tests/community.integration.mjs`. Test thứ hai xác nhận người ngoài không xem/gửi chat phòng, không xem Squad và không tự ghi phút Focus xác thực. Mọi tài khoản test phải được xác minh email trước.

### Kịch bản mất dữ liệu và kết quả

| Kịch bản | Kết quả hiện tại |
| --- | --- |
| Nhập file sao lưu hỏng, hết quota, migration từ bản cũ | PASS bằng test tự động GĐ7 và checksum GĐ8. |
| Xóa nhầm rồi khôi phục; hợp nhất hai ghi chú khác nội dung | PASS bằng test mô hình; UI cần kiểm tra trên trình duyệt. |
| Tắt mạng khi gõ; đóng tab đột ngột | Có autosave 500 ms, blur/visibility/pagehide và localStorage + IndexedDB; kiểm tra thực tế còn chờ. |
| Hai thiết bị sửa một ghi chú, token hết hạn, project pause | Có luồng giữ bản local, outbox và màn hình xung đột; kiểm tra tích hợp còn chờ project Supabase. |
| Đổi tài khoản khi outbox còn dữ liệu; cô lập RLS A/B | Có chặn đổi tài khoản; test RLS tích hợp còn chờ project và hai tài khoản. |

Không thể hứa an toàn dữ liệu tuyệt đối: người dùng có thể xóa dữ liệu trình duyệt, thiết bị hỏng, hoặc quota đầy. Hãy giữ bản sao lưu JSON ngoài thiết bị.

## Việc bạn cần tự làm

- **Giai đoạn 8:** tạo project Supabase ở Dashboard; vào Authentication → Providers, bật Email và xác minh email. Vào Authentication → URL Configuration, đặt Site URL `https://hduc09.github.io/studywithducnh/`, thêm Redirect URL đúng địa chỉ đó và `http://localhost:3000/**` cho thử nghiệm cục bộ. Dùng SQL Editor chạy toàn bộ `supabase/schema.sql` một lần. Trong Project Settings → API, lấy Project URL và anon/publishable key công khai điền vào `js/config.js`, rồi cập nhật GitHub Pages. Với Google, bật provider Google trong Supabase và làm theo hướng dẫn redirect/callback của Supabase; có thể bỏ qua.
- **Chống pause:** trong GitHub → Settings → Secrets and variables → Actions, thêm `SUPABASE_URL` và `SUPABASE_ANON_KEY` cho workflow `keep-supabase-awake.yml`; chạy thử bằng **Run workflow**. GitHub có thể vô hiệu hóa workflow theo lịch ở repo công khai sau 60 ngày không hoạt động; khi đó bật lại trong tab Actions.
- **Giai đoạn 9–10:** cùng file `supabase/schema.sql` đã gồm bảng/RPC/RLS cho cộng đồng và phòng học; chạy từ đầu đến cuối trong SQL Editor của project mới. Nếu đã chạy bản GĐ8, chỉ chạy phần bắt đầu tại dòng `-- GĐ9–10` ở cuối file, tránh tạo lại policy cũ. Vào **Realtime → Settings**, tắt **Allow public access** để chỉ các kênh private `room:<uuid>` được policy `realtime.messages` cho thành viên truy cập. Schema tự thêm `rooms` và `room_messages` vào publication Realtime; app vẫn polling 15 giây khi không có sự kiện. Chạy hai test tích hợp bên trên trước khi mời người dùng thật.

Không đặt service_role key hay bí mật khác trong mã front-end hoặc repository công khai.

### Giới hạn Realtime và dữ liệu

Presence chỉ gửi lại mỗi 9 giây; đồng hồ chung chạy trên timestamp máy chủ nên không gửi mỗi giây. Mỗi phòng đang mở dùng khoảng 1 kết nối Realtime trên mỗi tab; 20 phòng × 10 người ≈ 200 kết nối. Nếu mỗi người gửi 1 tin hoặc thao tác/phút trong 2 giờ/ngày, 20 × 10 × 120 × 30 ≈ 720.000 sự kiện/tháng, chưa kể fan-out Presence và Broadcast; theo dõi quota thực trong Supabase Dashboard. Khi Realtime chạm giới hạn, phòng vẫn tải lại mỗi 15 giây và phần học cá nhân vẫn lưu local-first. Tin nhắn cũ hơn 24 giờ hoặc vượt 200 tin/phòng được dọn khi có tin mới; phòng trống 24 giờ được đóng khi app gọi RPC dọn phòng. Không dùng chat để lưu dữ liệu cần giữ lâu.

## Quyền riêng tư và giới hạn

Khi đã cấu hình Supabase, mỗi record gắn `user_id`; RLS cho phép chủ sở hữu đọc và RPC ghi đúng tài khoản. Không đặt service_role key ở front-end. Server giữ `version` và `updated_at`; ghi chú lệch version tạo bản xung đột, việc và lịch gộp patch theo trường. Xóa thông thường là soft delete; xóa vĩnh viễn cần xác nhận. Snapshot server được ghi lần đầu mỗi ngày khi người dùng mở app và đồng bộ thành công, giữ 14 bản, giới hạn 1 MB; Postgres có thể nén JSONB bằng TOAST. File JSON có checksum, nhập sẽ xem trước và hợp nhất. File System Access cần người dùng chọn file và cấp quyền; nếu quyền bị thu hồi, ứng dụng vẫn nhắc sao lưu tuần.

Tên thành phố được gửi tới Open-Meteo để lấy thời tiết. Nhạc nhúng phụ thuộc quyền nhúng và kết nối mạng. Nền upload và dữ liệu học ở chế độ Khách nằm trên máy; xóa dữ liệu website sẽ xóa bản cục bộ. Các luồng Supabase chưa được kiểm tra thực tế vì chưa có project/khóa trong môi trường này.

Mốc Lighthouse >90 chưa được đo trên bản phát hành này.

## Giấy phép

Mã nguồn có thể dùng và chỉnh sửa cho dự án cá nhân. Không có phụ thuộc JavaScript cần build.
