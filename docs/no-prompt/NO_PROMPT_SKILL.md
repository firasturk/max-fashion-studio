# No prompt skill — full specification

Approach id `9` · constants `NO_PROMPT_MODE = "9"`, `NP_BACKGROUNDS = "np-bg"`, `NP_POSES = "np-pose"`.

## 1. Inputs

| Input | Where it lives | Notes |
|---|---|---|
| Product photos | `sources` table + R2 | The usual upload; sets per product from the file name (`ProductID_01`, `ProductID_02`). |
| Backgrounds library | `refs` rows with `skill = 'np-bg'` + R2 `refs/np-bg/<id>` | Location photos. Read once at upload (see §3). |
| Poses library | `refs` rows with `skill = 'np-pose'` + R2 `refs/np-pose/<id>` | Pose photos. Classified at upload (framing) and read once (see §3). |
| Engine + size | batch config | Any engine the studio supports: Nano Banana Pro / 2 / 2.1 (Google), GPT Image (OpenAI), Seedream (fal.ai), Higgsfield. |

There is no prompt field, no prompt builder, no saved look and no skill text for this approach. The client hides the prompt block when the mode is `9`.

## 2. The framing check on the product photo

Every upload is classified once (cached in `sources.framing` as `framing|face|pockets|back|garments`). The instruction sent to the vision model:

> Look at the attached product photo and answer with JSON only. headVisible: true only if the head (face or back of the head) is inside the picture. kneesVisible: true only if the knees are inside the picture. feetVisible: true only if the feet, shoes or ankles are inside the picture. backView: true only if the person is seen from behind (back of the head, back of the garments, no face). framing follows from those facts: FULL_BODY when head and feet are both inside; THREE_QUARTER when the head is inside, the feet are NOT inside, and the picture ends between mid-thigh and just below the knees; UPPER_BODY when the head is inside and the picture ends at the waist or hips with no legs below the hips; LOWER_BODY when the head is NOT inside and the picture shows legs and/or footwear from the waist, hips or chest down, even if a sliver of a top is visible at the top edge. Decide from what is actually inside the picture, never from what the garment would need. faceVisible: true only if a face is clearly visible. handsInPockets: true only if at least one hand is inside a pocket in the photo. garments: a short comma-separated list of the clothing, footwear and accessories actually visible. Keys: framing, headVisible, kneesVisible, feetVisible, backView, faceVisible, handsInPockets, garments.

Decision rule (code wins over the model's label): no head but feet → LOWER_BODY; head and feet → FULL_BODY; head, no feet, knees visible → THREE_QUARTER; head alone → UPPER_BODY.

## 3. The reads on the library photos (`refs.notes`)

Each library photo is read once; the sentences are cached in `refs.notes` and reused by every batch. The read runs at upload, and a once-a-minute cron reads up to four photos that still have no notes (older uploads, or a read that failed).

### Background read

Instruction:

> You are a photographer's assistant reading a location photo that a fashion model will later be photographed in. Answer with JSON only, each value a short concrete phrase, decided from what is visible in the photo. location: what the place is (street, rooftop, beach, interior...) in a few words. timeOfDay: morning, midday, golden hour, blue hour, night or overcast day. lightSource: the main light (direct sun, overcast sky, open shade, window light, artificial lamps...). lightDirection: where the main light comes from relative to the camera (front, front-left, left, back-left, behind, back-right, right, front-right). lightHeight: low, mid or high. hardness: hard with crisp shadow edges, or soft with diffuse edges. colourTemperature: warm golden, neutral, cool blue or mixed. shadowDirection: which way the shadows on the ground fall in the picture (toward the camera, away from the camera, to the left, to the right, diagonal...). shadowLength: none, short, medium or long. groundSurface: the surface a person would stand on (asphalt, cobblestone, sand, wooden deck, tiles...). standingSpot: the one spot in the picture where a model would naturally stand so the composition works, described by what is around it (e.g. 'on the pavement in front of the arched doorway, left of the lamp post'). cameraHeight: eye level, low (below the waist) or high (above the head). lens: wide, normal or telephoto, judged from the perspective. depth: the foreground, midground and background layers in one short sentence. Keys: location, timeOfDay, lightSource, lightDirection, lightHeight, hardness, colourTemperature, shadowDirection, shadowLength, groundSurface, standingSpot, cameraHeight, lens, depth.

The JSON answer is turned into one paragraph, for example:

> Location: narrow old-town street; time of day: golden hour; main light: direct sun; coming from the back-left of the camera; at low height; hard with crisp shadow edges; warm golden in colour. Shadows on the ground fall toward the camera and to the right; and are long. Ground: cobblestone. The model stands in the middle of the lane in front of the blue door. Camera: eye level; normal lens. Depth: cobbles in front, facades mid, archway behind.

When the model answers "none" for the shadows (overcast, open shade) the paragraph says instead: *No cast shadows on the ground in this light, only a soft contact shadow under the feet.* That sentence switches the shadow rule (see §6).

### Pose read

Instruction:

> Describe only the body pose of the person in the attached photo, for another photographer to recreate with a different model. Answer with JSON only, each value one short concrete phrase. stance: legs and feet (standing, walking, leaning, feet apart, one foot forward, crossed...). weight: which leg carries the weight and how the hips sit. torso: angle of the torso to the camera (square, turned three-quarter left/right, profile) and whether it is upright or leaning. arms: what each arm does. hands: what each hand does and where it is (relaxed at the side, on the hip, touching the collar, in a pocket...). head: head angle (straight, turned, tilted, chin up or down). gaze: where the eyes look (into the camera lens, off to the left, off to the right, down, into the distance). expression: neutral, soft smile, serious, laughing. Never describe clothing, hair, face, body shape or the background. Keys: stance, weight, torso, arms, hands, head, gaze, expression.

Example paragraph:

> Stance: walking, one foot forward; weight: on the back leg; torso: turned three-quarter left, upright; arms: swinging naturally; hands: relaxed, open; head: turned slightly left; gaze: into the camera lens; expression: soft smile.

Vision provider: Google (`gemini-3.8-flash` → `gemini-3.5-flash` → `gemini-3-flash` → `gemini-2.5-flash`, structured JSON output) with fallback to OpenAI `gpt-4.1-mini` when Google is unavailable.

## 4. The plan for one image (`tasks.brief`)

When an image is first gathered, the engine builds and stores a plan on the task:

```json
{
  "np": true,
  "bg": "<refs.id of the background>",
  "pose": "<refs.id of the pose or null>",
  "framing": "FULL_BODY | THREE_QUARTER | UPPER_BODY | LOWER_BODY",
  "handsInPockets": false,
  "backView": false,
  "scene": "<background read>",
  "poseNotes": "<pose read>"
}
```

Selection:

- **Background:** random among the backgrounds used the fewest times so far in this batch (other tasks' plans are counted). Nothing repeats until every background has been used once.
- **Pose:** the pool is the poses whose framing equals the upload's framing; THREE_QUARTER falls back to FULL_BODY poses; an empty pool falls back to all poses. The pick is random among the least used, like the background.
- The plan is stored, so a retry or a revision of the same image keeps the same background and pose.
- No backgrounds in the library → the batch stops with the message *"The No prompt approach needs background photos: add them in the Backgrounds library first."*

## 5. Image order sent to the engine

| Position | Image | Why |
|---|---|---|
| 1 | **Background** (location photo) | First, so the engine treats the location as the photograph to add a person into, not the model photo as a cutout to re-background. |
| 2 | **Model** (product photo) | Identity, hair, outfit, framing. |
| 3 | **Pose** photo | Body pose and gaze only. |
| last | Existing result | Only on a revision. |

Without a background the model photo is image 1 and the pose image 2 (the prompt renumbers itself).

## 6. The fixed rules (the prompt)

The prompt is assembled by `buildNoPromptPrompt(framing, handsInPockets, backView, images, edit, notes)` in `shared/prompts.ts`. Order and text:

1. **Opening.** *Image 1 is a photograph of a LOCATION. Image 2 is a MODEL wearing an OUTFIT. Make the photograph that a professional fashion photographer would have taken if the model from image 2 had been standing in the location of image 1 at the moment image 1 was taken: one single editorial fashion photograph, shot in one exposure, with one light, one camera and one colour grade for the person and the place. Every garment, the footwear and any accessory from image 2 stay exactly as worn, nothing added, removed or restyled.*
2. **LOCATION.** *keep the place of image 1 recognisably the same: its architecture, surfaces, materials, props, time of day, weather and light. The scene may be re-framed and re-rendered around the model so that the model's crop fills the frame naturally; the camera stays at the height and distance a photographer would use for that crop. Add nothing that is not in the location and remove nothing from it.*
3. **RE-LIGHT.** RE-LIGHT: the model photo was taken in a studio under flat, even, shadowless light against a plain backdrop. That light does not exist in the output. Discard it completely and light the person and the garment only with the light of the location: the same source, direction, height, hardness and colour temperature as everything else in the scene, with real highlights and shadows on the face, the skin, the hair and the fabric, reflected light and ambient colour from the surroundings, the same exposure, contrast, grain and colour grade as the location. Keep the garment's true colour and print under that light. The person must look photographed in that place, never lifted from another photo.
4. **SCENE READ** (facts taken from the location photo): the background read from §3.
5. **SHADOWS**, one of two variants chosen by the scene read:
   - Sun / visible shadows: SHADOWS: the model casts exactly one shadow on the ground, in the same direction, length, softness and darkness as the shadows already present in the location photo; it starts at the feet or at the point of contact, lies flat on the ground surface and follows the ground's perspective. A soft contact shadow sits under the soles. The body's own shadows (under the chin, under the arms, inside folds, the far side of the face and garments) all follow the same light direction. No shadow falls toward the light, no second shadow, no missing shadow, no shadow from a light that is not in the scene.
   - Overcast / open shade: SHADOWS: the location has soft, diffuse light with no hard cast shadows, so the model has no hard shadow either: only a soft, dark contact shadow directly under the soles and between the feet, fading out within a short distance, exactly like the soft shadows under the objects already in the location photo. The body's own shading is soft and gentle, slightly darker under the chin, under the arms and inside folds, with the top of the head and shoulders a little brighter from the sky. No hard-edged shadow, no shadow from a sun that is not in the scene, no floating feet.
6. **SCALE AND PERSPECTIVE.** SCALE AND PERSPECTIVE: the model stands on the ground at the standing spot in the location photo, drawn at the right size for that distance from the camera; the location photo's camera height, lens perspective, horizon and vanishing lines apply to the model too, so feet, hips and head sit where a person that size would in that spot. Elements in front of that spot overlap the model naturally; elements behind stay behind. The model is in the scene's space, not in front of a picture of it.
7. **STYLE.** STYLE: a high-end editorial fashion photograph, not a catalogue cutout: shot on location with a full-frame camera and a 50-85 mm lens at a natural working distance, true-to-life skin texture, fabric weave and fibres, natural depth of field with the location still readable, honest colour and contrast as the scene gives them; no HDR glow, no over-smoothed skin, no studio flash, no stock-photo flatness.
8. **IDENTITY.** IDENTITY (highest priority): the model is the same person as in the reference photo (image 2), reproduced exactly: identical face and facial structure (face shape, jawline, nose, lips, eyes, eyebrows, cheekbones), identical skin tone, age and body; no identity change, no beautifying, no averaging, no different person. HAIRSTYLE: the same hairstyle as the reference photo, same length, colour, parting, texture and styling; do not restyle, cut, lengthen or recolour the hair. When the face is not visible in the reference photo, it is not visible in the output either.
9. **TATTOOS.** TATTOOS: if the person in the reference photo has any tattoo, it is removed in the output; the skin there is clean and natural, with no tattoo, ink, marking or trace of it anywhere on the body.
10. **POSE.** *Image 3 is the POSE reference: copy only the body pose from it: stance, weight distribution, torso angle, each arm and hand, leg positions, head angle and the direction of the gaze. Never copy its clothing, face, hair, body shape, accessories or background; the person in the output is the person from image 2 in the outfit from image 2.* Then **POSE READ** (facts taken from the pose photo): the pose read from §3. Without a pose photo: *POSE: keep the model's pose as in image 2, natural and relaxed.*
11. **EYES** (skipped for back views and lower-body crops). EYES: both eyes exactly as in image 2: the same shape, colour, size, spacing, eyelids and brows. Both eyes open, sharp and in focus, with the same catchlight from the scene's light in each; the pupils aligned and looking in the same direction, following the gaze described in the pose; a natural, alive expression. Never crossed, wall-eyed, asymmetric, enlarged, glassy, blank or looking in two directions.
12. **FRAMING LOCK**, one of four by the verified framing (full body / three-quarter / upper body / lower body), each ending with the hands line: *no hand in a pocket* unless the product photo shows one.
13. **BACK VIEW** (only when the product photo is a back view). BACK VIEW: the reference photo shows the model from behind. Keep exactly this back view: the model faces away from the camera, no face is shown, the back of the hairstyle and the back of every garment are what is seen; never turn the model around, never add a face or a profile.
14. **Composition.** Composition: exactly ONE model. Centre the midpoint of the full model bounding box at x=50% of frame width, equal margins left and right. Keep head, hands, garment and feet fully inside the frame.
15. **Revision lines** (only on a revision): *Revision of the existing result: <edit>. Change only what is requested; keep all other details.* and *The LAST image is the existing result to revise.*
16. **AVOID list.** different face, altered facial features, changed hairstyle, different hair length or colour; crossed eyes, asymmetric eyes, misaligned pupils, glassy or blank eyes, eyes looking in two directions; tattoos, tattoo, body ink; cutout look, pasted-on model, collage, photo montage, floating feet, missing contact shadow, mismatched lighting, halo edges, the studio lighting of the model photo kept; wrong shadow direction, shadow falling toward the light, double shadows, a shadow from a second light source; wrong scale, model too large or too small for the spot, model not on the ground plane; studio look, flat studio lighting, over-smoothed plastic skin, HDR glow; clothing or accessories from the pose photo, a second person; hands in pockets (unless allowed).

Typical length: about 1,100 words. Two complete rendered examples are in `examples/`.

## 7. Framing lock texts

- **UPPER_BODY:** upper body only, cropped at the same line as the model photo (around the waist or hips). Do not show or invent legs, trousers, skirts, footwear or anything below that line.
- **LOWER_BODY:** lower body only, from the waist down exactly as the model photo is cropped. Do not show or invent the face, the top garments or anything above that line. Hands visible inside the frame, relaxed and natural, in a position that fits the scene and the body's movement.
- **THREE_QUARTER:** from above the head down to the same line as the model photo (between mid-thigh and just below the knees). No feet or footwear.
- **FULL_BODY:** head to footwear completely inside the frame. Nothing worn that is not visible in the model photo.

## 8. Engines and retries

- Any engine. The same prompt and the same three images go to Google (Nano Banana Pro / 2 / 2.1), OpenAI (GPT Image), fal.ai (Seedream) and Higgsfield.
- The approach is not set-aware: both shots of a product generate in parallel (there is no lead image to wait for, since no prompt is written).
- Content-checker refusal of a photo → the per-image engine fallback applies (`gemini-3-pro-image` → `nano-banana-pro` → `gpt-image-1`), with the child-safe compact prompt where relevant.
- A failed image is retried with a fresh plan (the stored plan is cleared on retry).
- Lost submissions refund their estimate.

## 9. Revision presets relevant to this approach

- **Blend with scene:** *Re-light the model with the scene's own light: same direction, hardness and colour as the surroundings, real highlights and shadows on skin, hair and fabric, one ground shadow matching the scene's shadows plus a soft contact shadow under the feet, the same grain and colour grade as the background, no cutout edges. Keep the face, hair, outfit, pose and framing exactly.*
- Fix hands · Match colour · Centre model · Brighter · Cleaner background · Full garment · Same face · Less retouching.

## 10. Pricing

`referencesFor(config, card)` returns 3 for this approach (model + background + pose), 4 on a revision. No prompt-builder cost is added. Vision reads: one call per library photo, once.

## 11. Where the code is

| Piece | File |
|---|---|
| Mode constants, `isNoPrompt`, library skill ids | `shared/config.ts` |
| Prompt builder and all rule texts | `shared/prompts.ts` (`buildNoPromptPrompt`, `RELIGHT_RULE`, `SHADOW_RULE`, `SOFT_SHADOW_RULE`, `SCALE_RULE`, `EYES_RULE`, `EDITORIAL_STYLE_RULE`) |
| Reads: instructions, schemas, parsers | `server/editorial.ts` (`SCENE_READ_INSTRUCTION`, `POSE_READ_INSTRUCTION`, `parseSceneNotes`, `parsePoseNotes`, `FRAMING_CHECK_INSTRUCTION`) |
| Plan, selection, cached reads, image order | `server/engine.ts` (`noPromptPlan`, `pickLeastUsed`, `referenceNotes`, `runReferenceRead`, `readPendingReferences`, `runFramingCheck`) |
| Library upload / list / delete | `server/studio.ts` (`/api/studio/references`) |
| Cron warm-up of unread photos | `server/index.ts` (`scheduled`) |
| Client: approach card, libraries, plan box, Blend preset | `src/studio/constants.ts`, `src/studio/CreativePanel.tsx`, `src/studio/ReferenceLibrary.tsx`, `src/studio/ReviewDialog.tsx` |
| Migrations | `migrations/0014_ref_framing.sql` (`refs.framing`), `migrations/0015_ref_notes.sql` (`refs.notes`) |
| Tests | `tests/prompts.test.ts` ("no prompt approach"), `tests/editorial.test.ts` ("no prompt reference reads") |
