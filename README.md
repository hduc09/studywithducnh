# StudyNest — góc học tập của riêng bạn

StudyNest là web app học tập tĩnh, chạy trực tiếp trên GitHub Pages. Không cần tài khoản, máy chủ, npm hay bước build. Giao diện mặc định tiếng Việt, hỗ trợ điện thoại và máy tính.

## Đã hoàn thành (Giai đoạn 1–3)

- Dashboard dạng thẻ: kéo để đổi vị trí, ẩn/hiện và đổi kích cỡ; bố cục lưu trên trình duyệt.
- 10 theme có xem trước, màu nhấn riêng, tự chọn theme sáng ban ngày, đổi phông chữ, độ mờ/tối nền, ảnh hoặc video nền từ URL hay thiết bị, CSS tùy chỉnh.
- Đồng hồ Pomodoro, nghỉ ngắn/dài, bấm giờ tiến, Flowtime, đếm ngược tùy chọn. Tùy chỉnh thời lượng và số phiên, tự chạy phiên kế tiếp, cộng 5 phút, bỏ qua, Zen mode, toàn màn hình.
- Đồng hồ tính từ timestamp nên không lệch khi tab ngủ. Có âm báo Web Audio, thông báo trình duyệt tùy chọn, nhắc khi rời tab, nhắc 20-20-20 và `Park a thought`.
- Quản lý việc học: thêm/sửa/xóa, hoàn tác xóa, đánh dấu hoàn thành, lưu trữ, việc nhỏ, ghi chú, hạn chót, ưu tiên, ước lượng Pomodoro, môn học, tìm kiếm/lọc/nhóm, sắp xếp kéo thả hoặc nút lên/xuống, lặp lại hằng ngày/tuần, gắn việc với đồng hồ.
- Quản lý môn học: màu và biểu tượng riêng, mục tiêu ngày/tuần/tháng, danh sách chương/bài, ngày thi. Phiên tập trung hoàn tất được ghi vào nhật ký để tính tiến độ.
- Onboarding lần đầu, localStorage, IndexedDB cho nền upload, sao lưu/khôi phục JSON, nhắc sao lưu mỗi tuần, PWA và cache offline.
- Thống kê: heatmap cả năm, chuỗi ngày, tổng giờ, giờ vàng, cột 7 ngày/30 ngày/12 tháng, phân bố theo môn, so sánh tuần và nhật ký phiên học. Có thể xuất thẻ thống kê PNG.
- Mixer 9 lớp âm thanh tạo bằng Web Audio: mưa, gió, sóng biển, lửa, quán cà phê, bàn phím, white/pink/brown noise; chỉnh âm lượng từng lớp, lưu preset, hẹn giờ tắt. Nhạc học tập hỗ trợ link YouTube, Spotify, SoundCloud và nút mở trang gốc khi nguồn không cho nhúng.
- Ghi chú Markdown có xem trước an toàn, tự lưu, tìm kiếm, gắn môn học; scratchpad luôn có sẵn ở góc màn hình.
- Kế hoạch: ba ưu tiên hôm nay, thời khóa biểu tuần kéo thả trên máy tính và chỉnh bằng form trên điện thoại, lịch tháng gộp deadline/ngày thi, tổng kết cuối ngày.
- Động lực: XP, cấp độ, huy hiệu, thử thách, streak, cây ảo lớn theo giờ học và đổi trạng thái sau nhiều ngày nghỉ; câu nói mỗi ngày có thể thêm/sửa.
- Flashcard: tạo bộ/thẻ, lật thẻ 3D, nhập CSV hoặc văn bản dán, ôn theo SM-2 với bốn mức nhớ, quiz trắc nghiệm sinh từ các thẻ cùng bộ và thống kê ôn tập.
- Thói quen: tạo/sửa thói quen, đặt mục tiêu số ngày mỗi tuần, đánh dấu từng ngày trên lưới tuần/tháng, xem chuỗi ngày liên tiếp.
- Bảng lệnh Ctrl/Cmd + K để điều hướng, tạo nội dung, điều khiển đồng hồ, đổi theme và xuất sao lưu; nhấn `?` để xem phím tắt.
- Widget đồng hồ số/kim, đổi 12/24 giờ và thời tiết theo thành phố. Thời tiết dùng Open-Meteo, chỉ gọi mạng khi đã chọn thành phố.
- Phòng học chung hai người bằng WebRTC: trao đổi mã mời/trả lời thủ công, thấy trạng thái tập trung thật và gửi lời nhắn qua kết nối trực tiếp. Có thể nhập máy chủ TURN của riêng bạn khi mạng không cho kết nối ngang hàng.

Sao lưu JSON là cách chuyển dữ liệu giữa các thiết bị: xuất ở thiết bị cũ, nhập ở thiết bị mới. Phòng học chung chỉ chia sẻ trạng thái và lời nhắn trong phiên hiện tại, không đồng bộ toàn bộ dữ liệu học.

## Cây thư mục

```text
index.html
manifest.json
sw.js
.nojekyll
README.md
css/
  base.css
  themes.css
  components.css
  animations.css
  stage2.css
  stage3.css
js/
  main.js
  store.js
  utils.js
  i18n.js
  themes.js
  timer.js
  tasks.js
  subjects.js
  stats.js
  audio.js
  notes.js
  planner.js
  gamification.js
  flashcards.js
  habits.js
  commands.js
  utility.js
  room.js
assets/
  icons/
    icon.svg
    icon-192.png
    icon-512.png
  audio/
    README.md
  backgrounds/
    README.md
```

## Chạy trên máy

Do ES Modules cần máy chủ HTTP, hãy mở thư mục dự án bằng một static server. Ví dụ nếu có Node.js:

```bash
npx serve .
```

Không cần cài package vào dự án. Hoặc dùng extension Live Server của VS Code. Mở địa chỉ localhost được in ra. PWA hoạt động trên localhost hoặc HTTPS.

## Đưa lên GitHub Pages

1. Tạo repository mới trên GitHub, ví dụ `studynest`.
2. Tải toàn bộ **nội dung** thư mục này lên nhánh `main`, đảm bảo `index.html` nằm ngay ở thư mục gốc của repository.
3. Trong repository, mở **Settings → Pages**.
4. Ở **Build and deployment**, chọn **Deploy from a branch**, nhánh `main`, thư mục `/ (root)`, rồi bấm **Save**.
5. Chờ GitHub Pages xuất bản, sau đó mở `https://TEN-TAI-KHOAN.github.io/studynest/`.
6. Trên điện thoại hoặc máy tính, dùng mục **Add to Home Screen / Install app** của trình duyệt để cài PWA.

Mọi đường dẫn nội bộ đều là đường dẫn tương đối, nên repository không cần tên cố định. Khi cập nhật file, service worker có thể giữ cache cũ đến lần tải lại kế tiếp; tăng hằng số `CACHE` trong `sw.js` để phát hành bản cache mới.

Tham khảo thêm [hướng dẫn cấu hình nguồn xuất bản chính thức của GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Phím tắt

| Phím | Tác dụng |
| --- | --- |
| `Space` | Bắt đầu / tạm dừng đồng hồ khi không nhập văn bản |
| `Esc` | Thoát Zen mode |
| `F` | Bật / tắt toàn màn hình khi ở Zen mode |
| `?` | Hiện gợi ý phím tắt |
| `Ctrl/Cmd + K` | Mở bảng lệnh |
| `↑` / `↓` / `Enter` | Chọn và chạy lệnh trong bảng lệnh |
| `Space` | Lật thẻ khi đang ôn flashcard |
| `1` / `2` / `3` / `4` | Chấm thẻ Quên / Khó / Tốt / Dễ |

## Checklist tự kiểm tra

- [ ] Lần mở đầu có onboarding, nhập tên, mục tiêu và môn học.
- [ ] Thêm một việc, đổi ưu tiên/hạn chót, thêm việc nhỏ, gắn việc vào đồng hồ.
- [ ] Bắt đầu đồng hồ, chuyển tab vài phút rồi quay lại: thời gian phải đúng.
- [ ] Hoàn thành phiên tập trung: tiến độ hôm nay và thời gian gắn với việc tăng.
- [ ] Sau phiên tập trung, chọn mức tập trung và ghi chú; kiểm tra nhật ký, heatmap, XP và cây ảo.
- [ ] Bật mixer bằng nút bấm, chỉnh hai lớp âm, lưu preset, đặt hẹn giờ tắt.
- [ ] Tạo ghi chú Markdown, xem trước, tải lại trang và kiểm tra nội dung còn nguyên.
- [ ] Đặt ba ưu tiên, thêm khung học, chuyển ngày bằng kéo thả hoặc form, xem lịch tháng.
- [ ] Mở tổng kết ngày, lưu cảm nhận và kiểm tra sau khi tải lại.
- [ ] Đổi cả theme sáng/tối, upload nền, chỉnh blur/dim, mở Zen mode.
- [ ] Kéo thẻ dashboard, ẩn một thẻ, tải lại trang: bố cục được giữ.
- [ ] Xuất JSON, thay đổi dữ liệu, nhập JSON và kiểm tra khôi phục.
- [ ] Tắt mạng rồi tải lại sau khi đã truy cập một lần: ứng dụng vẫn mở.
- [ ] Thử màn hình 360 px, bàn phím Tab và chế độ giảm chuyển động.
- [ ] Tạo bộ flashcard, nhập CSV có dấu phẩy trong dấu ngoặc kép, ôn thẻ và kiểm tra ngày ôn lại; thử quiz với ít nhất bốn thẻ.
- [ ] Tạo thói quen, đánh dấu hôm nay, đổi lưới tuần/tháng và tải lại trang.
- [ ] Mở bảng lệnh bằng Ctrl/Cmd + K, tìm một trang và chạy một lệnh; nhấn `?` xem phím tắt.
- [ ] Đổi đồng hồ số/kim, 12/24 giờ; nhập một thành phố và thử trường hợp mất mạng.
- [ ] Mở hai trình duyệt hoặc hai tab: A tạo mã mời, B dán và tạo mã trả lời, A dán mã trả lời; thử nhắn tin và bật trạng thái tập trung.

## Giới hạn lưu trữ và quyền riêng tư

Dữ liệu chỉ nằm trong trình duyệt hiện tại. Xóa dữ liệu website hoặc dùng trình duyệt khác sẽ không tự đồng bộ; hãy xuất JSON định kỳ. Nền upload nằm trong IndexedDB và được đưa vào file sao lưu. File video lớn có thể vượt hạn mức lưu trữ của trình duyệt, nên ứng dụng giới hạn 25 MB. Font Google dùng CDN; khi offline, font hệ thống sẽ thay thế. Thông báo trình duyệt cần được cấp quyền và có thể bị hệ điều hành chặn. Âm thanh mixer được tạo ngay trên thiết bị nên không cần tải file CC0. Nhạc nhúng cần mạng và phụ thuộc quyền nhúng của từng nguồn; StudyNest luôn cung cấp link mở trang gốc.

Thời tiết gửi **tên thành phố bạn nhập** cho dịch vụ định vị địa danh của Open-Meteo, sau đó dùng tọa độ thành phố để lấy nhiệt độ và mã thời tiết hiện tại. Không dùng quyền vị trí của trình duyệt. Dữ liệu đã tải được lưu cục bộ để hiện lại khi mất mạng. Tham khảo [Geocoding API](https://open-meteo.com/en/docs/geocoding-api) và [Forecast API](https://open-meteo.com/en/docs).

Phòng học chung cần kết nối mạng để dùng máy chủ STUN công khai của Cloudflare và trao đổi mã trực tiếp giữa hai người. Một số mạng cần TURN; nhập URI, tên người dùng và mật khẩu TURN vào phần tùy chọn trong phòng. Thông tin TURN chỉ dùng trong phiên và không lưu. Mã WebRTC có thể tiết lộ địa chỉ mạng của bạn cho người nhận, nên chỉ gửi cho người tin cậy. Không có máy chủ signaling, danh sách phòng công khai, đồng bộ lịch sử chat hoặc lưu chat lâu dài. Mỗi phòng chỉ hỗ trợ hai người. Tham khảo [hướng dẫn WebRTC](https://webrtc.org/getting-started/peer-connections) và [STUN Cloudflare](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/).

## 10 hướng nâng cấp tiếp theo

1. Đồng bộ hai chiều tùy chọn qua một kho lưu trữ do người dùng chọn.
2. Nhập và xuất thời khóa biểu bằng file `.ics`.
3. Nhắc deadline bằng thông báo khi ứng dụng đang mở.
4. Thống kê tiến độ theo từng chương của giáo trình.
5. Xuất ghi chú thành PDF.
6. Tùy chỉnh mục tiêu XP và bộ huy hiệu cá nhân.
7. Lịch sử ôn flashcard để xem mức nhớ theo thời gian.
8. Mẫu bộ flashcard có thể chia sẻ bằng file CSV.
9. Tự dựng signaling server tùy chọn để mời vào phòng bằng một link.
10. Nhóm học nhiều người có quyền kiểm soát tham gia và lưu trữ tùy chọn.

## Giấy phép

Mã nguồn được cung cấp để bạn dùng và chỉnh sửa cho dự án cá nhân. Không có phụ thuộc JavaScript bên ngoài.
