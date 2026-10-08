# No prompt skill — README

Max Fashion Studio · approach 9 "No prompt" · documentation package (generated 2026-10-08)

## What is in this zip

| File | What it is |
|---|---|
| `README.md` | This file: what the skill does, how to use it, tips. |
| `NO_PROMPT_SKILL.md` | The full specification: libraries, selection, the vision reads, every fixed rule, image order, framing, engines, costs. |
| `SYSTEM_OVERVIEW.md` | The shape of the system the skill runs in: architecture, pipeline, data model, files, diagrams. |
| `examples/example-full-body-sun.txt` | The exact prompt the engine receives for a full-body shot in direct sun. |
| `examples/example-upper-body-overcast.txt` | The exact prompt for an upper-body shot on an overcast day. |

## The idea in one paragraph

No prompt is the fastest approach in the studio: nobody writes a prompt. You keep two libraries, **Backgrounds** (location photos) and **Poses** (photos of people standing in poses you like). For every product photo you upload, the system picks one background and one pose at random, reads both photos once with a vision model (light, shadows, camera, where a person would stand; stance, hands, head, gaze), and sends the engine three images plus a fixed set of rules. The engine keeps the model, face, hair and outfit from your photo, re-lights the person with the location's own light, and returns one editorial fashion photograph.

## How to use it

1. Open the studio, choose the approach card **No prompt**.
2. Fill the **Backgrounds** library (20 photos is a good size). Any location works: streets, interiors, beaches, rooftops. Daylight photos with a clear ground plane and visible shadows give the best integration.
3. Fill the **Poses** library (10 to 16 photos). Each pose photo is classified at upload as full body, three-quarter, upper body or lower body; an upload only ever borrows a pose with the same framing, so cover every framing you shoot.
4. Upload the product photos (the usual folder or file upload; names like `170005174_01.jpg` form sets per product).
5. Pick the engine and size. Recommended: **Nano Banana Pro at 2K** or **Seedream 5 Pro at 4K**. 1K gives visibly weaker blending and shadows.
6. Press **Generate**. There is no prompt box and no prompt builder: every image goes straight to the engine.
7. Review the results. Opening an image shows the **No prompt plan** (framing, what was read from the background and the pose) and the exact prompt used.
8. If an image still looks pasted on, press the **Blend with scene** revision preset: it re-lights the model with the scene's light and adds the correct ground shadow, keeping face, outfit, pose and framing.

## What the skill guarantees

- Same person: exact facial structure and hairstyle, no beautifying, tattoos removed.
- Same outfit: nothing added, removed or restyled; nothing worn that is not in the product photo.
- Same crop: full body stays full body, upper body stays upper body (and so on); back views stay back views.
- Hands out of pockets unless the product photo shows a hand in a pocket.
- One model, centred.
- Random background and pose, with no repeats inside a batch until the whole library has been used once. Retrying an image keeps its background and pose.

## Costs and speed

- Each image sends the engine three references (model photo, background, pose); the price list counts two extra references for this approach.
- Each library photo is read once by the vision model (a few cents); the read is cached and reused by every batch.
- No prompt builder runs, so images start within seconds of pressing Generate and run in parallel.

## Tips for better results

- Backgrounds: shoot or choose photos at eye level with a normal lens and a free spot on the ground where a person can stand. Hard sunlight with visible shadows produces the most convincing results; overcast works too and gets a soft-shadow rule instead.
- Poses: plain, well-lit photos of one person; the clothing is ignored, only the body pose and gaze are copied.
- Deleting a library photo is safe; images already generated keep their stored plan.

---

## دليل سريع بالعربي

- **الفكرة:** لا تكتب برومبت. لكل صورة منتج يختار النظام خلفية وبوز عشوائياً من مكتبتيك، ويقرأ الصورتين مرة واحدة (الضوء والظل والكاميرا ومكان الوقوف؛ الوقفة واليدين والرأس والنظرة)، ويرسل للمحرك ثلاث صور مع قواعد ثابتة.
- **الاستخدام:** اختر بطاقة No prompt، ارفع الخلفيات (20) والبوزات (10 إلى 16)، ارفع صور المنتجات، اختر المحرك والحجم (Nano Banana Pro 2K أو Seedream 5 Pro 4K)، اضغط Generate.
- **الضمانات:** نفس الوجه والشعر، نفس الملابس، نفس التأطير، بلا وشوم، موديل واحد في المنتصف، خلفية وبوز عشوائيان بلا تكرار داخل الدفعة.
- **إذا طلعت الصورة ملصوقة:** زر **Blend with scene** في نافذة المراجعة.
