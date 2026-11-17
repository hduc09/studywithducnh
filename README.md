# studywithducnh

studywithducnh là ứng dụng học tập chạy bằng HTML, CSS và JavaScript thuần trên GitHub Pages. Đây là bản **Giai đoạn 7**: đổi tên, dọn tính năng đã gỡ và chuyển dữ liệu an toàn. Ứng dụng vẫn dùng được khi không có mạng.

**Trạng thái hiện tại:** chế độ Khách lưu trên thiết bị. Đăng nhập, đồng bộ Supabase, bạn bè, Squad và phòng học Realtime thuộc Giai đoạn 8–10; bản này chưa yêu cầu khóa API hay dự án Supabase. Phòng kết nối trực tiếp đời trước đã được gỡ để chuẩn bị thay bằng Supabase Realtime.

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

Dữ liệu vẫn nằm trong localStorage và IndexedDB của trình duyệt hiện tại. Chưa có đồng bộ giữa các thiết bị. Bản sao lưu JSON là cách thủ công để chuyển dữ liệu.

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
        themes.js, commands.js, utility.js, i18n.js, utils.js
    assets/icons/ icon.svg, icon-192.png, icon-512.png,
                  icon-maskable.svg, icon-maskable-192.png, icon-maskable-512.png
    assets/audio/README.md
    assets/backgrounds/README.md
    tests/migration.test.mjs

## Chạy trên máy

Dùng static server vì ứng dụng sử dụng ES Modules. Ví dụ với Node.js: chạy lệnh **npx serve .** ở thư mục chứa index.html. Không cần bước build hay package JavaScript trong ứng dụng. Manifest của bản phát hành dùng đường dẫn /studywithducnh/ để cài PWA từ GitHub Pages; giao diện vẫn chạy khi xem tại localhost.

## Đưa lên GitHub Pages

Repository chính: https://github.com/hduc09/studywithducnh . Địa chỉ dự kiến: https://hduc09.github.io/studywithducnh/ .

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

## Checklist tự kiểm tra Giai đoạn 7

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

## Kiểm thử tự động

Chạy **node tests/migration.test.mjs**. Bộ test kiểm tra sao chép dữ liệu cũ, giữ bản gốc, chỉ dọn sau xác nhận, giữ bản phục hồi 30 ngày, từ chối dọn khi hết quota, không xóa bản gốc đã đổi, và bảo toàn store khi ghi thất bại. Kiểm tra giao diện và PWA cần làm thêm trên trình duyệt.

## Việc bạn cần tự làm

- **Giai đoạn 7:** không cần tạo dịch vụ hay nhập khóa.
- **Giai đoạn 8:** tạo project Supabase; bật Auth, cấu hình Site URL/Redirect URLs; chạy supabase/schema.sql; dán Project URL và anon key công khai vào js/config.js. Chưa làm các bước này cho đến khi Giai đoạn 8 được cung cấp.
- **Giai đoạn 9–10:** cấu hình Realtime và các tùy chọn cộng đồng sau khi schema, RLS và kiểm thử bảo mật đã hoàn tất.

Không đặt service_role key hay bí mật khác trong mã front-end hoặc repository công khai.

## Quyền riêng tư và giới hạn

Bản này không có tài khoản hoặc đồng bộ đám mây. Tên thành phố bạn nhập được gửi tới Open-Meteo để lấy thời tiết; ứng dụng không xin vị trí thiết bị. Nhạc nhúng phụ thuộc quyền nhúng và kết nối mạng. Thông báo trình duyệt cần bạn cấp quyền. Nền upload và dữ liệu học nằm trên máy này; xóa dữ liệu website sẽ xóa bản cục bộ. Hãy tải file sao lưu định kỳ.

Mốc Lighthouse >90 chưa được đo trên bản phát hành này.

## Giấy phép

Mã nguồn có thể dùng và chỉnh sửa cho dự án cá nhân. Không có phụ thuộc JavaScript cần build.
