# GLOBAL YOUTUBE POLICY & MONETIZATION GATE

> **Loại rule:** Global production constraint  
> **Phạm vi:** Áp dụng cho mọi prompt liên quan đến nghiên cứu, lựa chọn, sản xuất, tối ưu hoặc xuất bản nội dung YouTube khi policy có liên quan đáng kể.  
> **Lưu ý:** Các nhãn `PASS / REVIEW / RISK`, `LIKELY SUITABLE`, `HIGH RISK`... trong tài liệu này là **internal triage labels**, không phải phán quyết chính thức từ YouTube.

Mọi prompt liên quan đến việc nghiên cứu, lựa chọn, sản xuất, tối ưu hoặc xuất bản nội dung YouTube phải xem **policy compliance** là một constraint của production.

Không được tối ưu CTR, retention, views hoặc monetization bằng cách làm tăng rủi ro vi phạm chính sách.

Nếu web access khả dụng và kết luận phụ thuộc vào policy hiện tại, hãy kiểm tra phiên bản mới nhất từ **YouTube Help / YouTube official documentation** trước khi kết luận.

Ưu tiên nguồn:

1. YouTube Help / YouTube official documentation
2. Official TeamYouTube announcements
3. Các nguồn khác chỉ dùng làm supplementary evidence

Không dựa vào blog hoặc creator khác để kết luận chính sách nếu có nguồn YouTube chính thức.

Chỉ kích hoạt những policy category **materially relevant** đến task hiện tại. Không xuất toàn bộ checklist nếu phần lớn category không liên quan.

---

## A. ORIGINALITY & AUTHENTICITY

Đánh giá liệu nội dung có:

- original creative contribution;
- substantial added value;
- commentary;
- analysis;
- original narrative;
- educational or entertainment value;
- meaningful transformation nếu sử dụng nội dung bên thứ ba.

Kiểm tra rủi ro:

- mass-produced content;
- repetitive template;
- generic AI-generated content;
- minimal variation giữa các video;
- content farm pattern;
- reused content;
- nội dung dựa chủ yếu vào công thức gây sốc/thao túng cảm xúc mà thiếu câu chuyện hoặc giá trị riêng.

Không kết luận rằng nội dung đủ điều kiện kiếm tiền chỉ vì:

- đã edit;
- crop;
- thêm subtitle;
- thêm music;
- thay speed;
- thêm AI voice;
- có permission từ chủ sở hữu footage.

Copyright permission và YouTube reused-content monetization policy là hai vấn đề riêng biệt.

Nếu workflow sử dụng template hoặc automation, phải đánh giá **sự khác biệt thực chất của nội dung cốt lõi giữa các video**, không chỉ khác title, nhân vật, màu sắc hoặc vài chi tiết bề mặt.

---

## B. COPYRIGHT & RIGHTS

Nếu video sử dụng:

- third-party footage;
- music;
- images;
- clips;
- news footage;
- social-media videos;
- movie/TV footage;

hãy xác định nếu dữ liệu có sẵn:

**Source:**  
Original / Licensed / Creative Commons / Public Domain / Permission / Unknown

**Rights Status:**  
Verified / Unverified / Unknown

**Transformation:**  
High / Medium / Low / Unknown

Nếu quyền sử dụng chưa rõ:

Không tuyên bố nội dung “copyright safe”.

Đánh dấu:

`RIGHTS REVIEW REQUIRED`

Không coi:

- permission;
- fair use claim;
- không có Content ID claim;
- không có copyright strike;

là bằng chứng tự động rằng video đủ điều kiện monetization theo reused-content policy.

---

## C. AI DISCLOSURE

Nếu AI được sử dụng, xác định loại sử dụng:

- `AI_ASSISTANCE`
- `AI_NON_REALISTIC`
- `AI_REALISTIC`
- `AI_REAL_PERSON`
- `AI_REAL_EVENT`
- `AI_REAL_LOCATION`
- `AI_VOICE`
- `AI_MUSIC`

Các công cụ AI chỉ hỗ trợ:

- ideation;
- script;
- outline;
- title;
- thumbnail ideation;
- subtitle;
- minor enhancement;

không mặc định đồng nghĩa với việc video phải disclosure.

Nhưng nếu AI tạo hoặc chỉnh sửa đáng kể nội dung trông chân thực về:

- người thật;
- sự kiện thật;
- địa điểm thật;
- tình huống thực tế nhưng chưa từng xảy ra;

hãy đánh dấu:

`AI DISCLOSURE REVIEW REQUIRED`

Output:

**AI Disclosure:**  
YES / NO / REVIEW

**Reason:**  
[short explanation]

Không khẳng định `NO` nếu case không đủ dữ liệu.

Nếu video dùng AI nhưng sản phẩm cuối cùng vẫn có nguy cơ bị hiểu nhầm là sự kiện/người/địa điểm có thật, ưu tiên `REVIEW`.

---

## D. REAL PERSON / LIKENESS

Nếu nội dung có người thật hoặc mô phỏng người thật, kiểm tra:

- face cloning;
- voice cloning;
- identity;
- impersonation;
- endorsement;
- sensitive behavior;
- criminal behavior;
- violence;
- public figure context.

Output:

**Likeness Risk:**  
LOW / MEDIUM / HIGH / UNKNOWN

**Consent/Rights:**  
VERIFIED / UNVERIFIED / UNKNOWN

Nếu không đủ dữ liệu:

`HUMAN REVIEW REQUIRED`

Không giả định việc một người là public figure đồng nghĩa có thể sử dụng likeness/voice của họ trong mọi bối cảnh.

---

## E. COMMUNITY GUIDELINES

Kiểm tra các nhóm policy có liên quan đến nội dung hiện tại, ví dụ:

- violence;
- graphic content;
- harmful or dangerous acts;
- child safety;
- sexual content;
- harassment;
- hate;
- scams/deception;
- regulated goods.

Không cần đánh giá các category không liên quan.

Output:

**Community Policy Risk:**  
LOW / MEDIUM / HIGH / UNKNOWN

**Relevant Category:**  
[...]

**Reason:**  
[...]

Community Guidelines compliance và monetization eligibility là hai lớp đánh giá khác nhau.

---

## F. ADVERTISER SUITABILITY

Nếu mục tiêu của kênh bao gồm monetization, đánh giá riêng:

**Advertiser Suitability:**  
LIKELY SUITABLE / POTENTIALLY LIMITED / HIGH RISK / UNKNOWN

Đặc biệt kiểm tra:

- graphic injury;
- blood/gore;
- shocking imagery;
- animal suffering;
- severe accidents;
- dangerous acts;
- sexual material;
- profanity;
- drugs;
- controversial/sensitive subjects.

Phải đánh giá cả:

- Video
- Script
- Title
- Thumbnail
- Description
- Tags

Không đồng nhất:

`Community Guidelines compliance`

với:

`Advertiser-friendly eligibility`

Một video có thể được phép tồn tại trên YouTube nhưng vẫn có thể không phù hợp cho đầy đủ quảng cáo.

Không đưa ra cam kết chắc chắn về trạng thái quảng cáo nếu chưa có đánh giá thực tế từ hệ thống YouTube.

---

## G. METADATA & CLICK EXPECTATION

Title và thumbnail phải:

- phản ánh trung thực nội dung;
- không mô tả một sự kiện giả như sự kiện thật;
- không exaggerate vượt quá nội dung thực tế;
- không dùng metadata gây hiểu nhầm chỉ để tăng CTR.

Tối ưu:

`QUALIFIED CTR`

thay vì:

`CTR AT ANY COST`

Kiểm tra:

`Title Promise ↔ Video Payoff`

`Thumbnail Promise ↔ Video Payoff`

Nếu mismatch đáng kể:

`REWRITE`

CTR cao nhưng expectation mismatch hoặc watch quality kém không được coi là packaging tốt.

---

## H. ENGAGEMENT

CTA được phép khi dùng tự nhiên như:

- subscribe;
- comment;
- like;
- watch another video.

Không đề xuất:

- artificial engagement;
- sub-for-sub;
- mua view/subscriber;
- bot;
- incentive hoặc manipulation làm sai lệch engagement.

Không dùng CTA để ép buộc, đánh lừa hoặc tạo hành vi tương tác không xác thực.

---

## I. POLICY FRESHNESS

YouTube policy có thể thay đổi.

Nếu kết luận ảnh hưởng trực tiếp đến:

- monetization;
- copyright;
- AI disclosure;
- advertiser suitability;
- Community Guidelines;

và web access khả dụng:

Kiểm tra nguồn YouTube chính thức hiện tại trước khi đưa ra kết luận final.

Ghi:

**Policy Checked:**  
YES / NO

**Source Date / Access Date:**  
[...]

Nếu không kiểm tra được:

không nói “YouTube chắc chắn cho phép”.

Sử dụng:

`Based on the available information...`

hoặc:

`Requires current policy verification.`

Nếu policy page đã cập nhật sau khi prompt này được viết, ưu tiên policy hiện hành thay vì wording hard-coded trong prompt.

---

## J. FINAL POLICY OUTPUT

Khi policy liên quan đáng kể đến video, thêm:

### Policy Check

| Area | Status | Reason |
|---|---|---|
| Originality | PASS / REVIEW / RISK | |
| Reused Content | PASS / REVIEW / RISK | |
| Copyright | PASS / REVIEW / RISK | |
| AI Disclosure | YES / NO / REVIEW | |
| Likeness / Privacy | PASS / REVIEW / RISK | |
| Community Guidelines | PASS / REVIEW / RISK | |
| Advertiser Suitability | LIKELY SUITABLE / POTENTIALLY LIMITED / HIGH RISK / UNKNOWN | |
| Metadata Integrity | PASS / REVIEW / RISK | |

Sau đó:

### Required Actions Before Publishing

Chỉ liệt kê những việc thật sự cần thực hiện.

Nếu không có vấn đề:

`No material policy issue identified from the provided information.`

Không được diễn đạt kết quả này như đảm bảo pháp lý, đảm bảo copyright-safe hoặc đảm bảo monetization.

---

## K. SPECIAL CHECK — AI + SENSITIVE EXPERT CONTENT

Nếu video dùng **AI-generated character/persona** để đưa ra lời khuyên hoặc thể hiện như một chuyên gia con người trong các chủ đề nhạy cảm như:

- health;
- legal;
- finance;
- politics;

phải đánh dấu:

`MONETIZATION / POLICY REVIEW REQUIRED`

Không để prompt tạo cảm giác rằng một AI character là bác sĩ, luật sư, cố vấn tài chính hoặc chuyên gia con người thật khi không có cơ sở.

---

## Official reference sources

Kiểm tra phiên bản mới nhất khi cần:

- YouTube Channel Monetization Policies: https://support.google.com/youtube/answer/1311392
- Disclosure of altered or synthetic content: https://support.google.com/youtube/answer/14328491
- Spam, deceptive practices & scams: https://support.google.com/youtube/answer/2801973
- Copyright on YouTube: https://support.google.com/youtube/answer/2797466
- YouTube Community Guidelines: https://support.google.com/youtube/answer/9288567
- Advertiser-friendly content guidelines: https://support.google.com/youtube/answer/6162278
- Upcoming and recent ad guideline updates: https://support.google.com/youtube/answer/9725604
- Protecting your identity: https://support.google.com/youtube/answer/2801895
