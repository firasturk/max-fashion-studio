# Max Fashion Image Studio — Claude implementation brief

Build and maintain a real batch fashion image application branded for Max Fashion. The accompanying repository is a working implementation, not just a UI mockup. Keep its actual workflows and backend operations when adapting it in Claude Code.

## Required product behaviour

1. **Fully AI-generated cards.** One uploaded product or mannequin reference produces exactly six outputs: five lifestyle images and one fabric close-up. Generate card 1 first, then use it as the identity and environment reference for cards 2–5. Fabric details must be grounded in the original garment reference.
2. **AI lifestyle first card + real model shoot.** Generate only the lead images. Let users mark other uploaded photographs as supporting; leave those unchanged. Include original photography in the exported ZIP in an `originals/` directory.
3. **Same approach using the real model’s face.** Require a consenting adult model identity reference and use it with the garment image for the first card. Preserve original photographs and let the user review face/body differences before approval.
4. **Enhance backgrounds only.** Require existing model photography. Instruct the image model to preserve the person, pose and all product details while improving the background. Make clear that a generative edit cannot guarantee pixel-identical subject preservation. A later implementation of true foreground compositing requires an accurate segmentation mask and should preserve source pixels inside that mask.

Allow model photographs, mannequins and flat lays in workflows 1–3. Workflow 4 accepts model photography. Categories: denim, active wear, casual, formal, dresses, knitwear, outerwear and custom/other. Category presets populate an editable background/lifestyle prompt. The user can control aspect ratio, resolution and model direction.

Accept many images in a single selection or drag/drop. Upload images sequentially so large batches do not exceed Worker memory. Preserve the original bytes, filename and MIME type. Create a separate smaller reference for inference. Reject duplicate output stems before upload rather than silently overwriting results. Save batch settings and source/result metadata durably. Keep each generated revision separately in object storage; the visible result points to the latest revision. Never overwrite the original.

Provide original/result comparison for every generated image, its centering/product review, a per-image revision prompt, and approve-for-export control. Revisions must include the original garment, appropriate identity reference and latest result; changing one image must not rerun the whole batch. A revision consumes another paid generation.

## Nano Banana Pro connection

Image engine: Google Gemini API `gemini-3-pro-image` (Nano Banana Pro), through the current Interactions API at `https://generativelanguage.googleapis.com/v1beta/interactions`. Do not silently substitute a different engine.

Use a server-side `GEMINI_API_KEY` secret, or a session-only password field whose value is sent to the application backend. Never commit credentials, expose a server key to the browser, write keys to logs or persist session keys in localStorage. Send the Google key in `x-goog-api-key`; set `store:false`.

Image inputs use `{type:'image', mime_type:'image/jpeg', data:'BASE64'}`. Image output uses `response_format:{type:'image',mime_type:'image/png',aspect_ratio:'2:3',image_size:'2K'}`. Extract the final image from `steps` with `type:'model_output'`, ignoring thought images. Consult current official Google documentation before changing the contract.

Use Gemini 2.5 Flash for product comparison and full-person bounding-box review. For structured output, use `response_format:{type:'text',mime_type:'application/json',schema:...}`. Bounding boxes are `[ymin,xmin,ymax,xmax]`, normalised to 0–1000. Offset is `abs((xmin+xmax)/2 - 500)/10` percent. One person within 1% of the horizontal centre passes the initial automated review; this is an estimate, not proof of exact pixel centering. Retry generation once when a detected model is off centre. If alignment is still uncertain or product changes are detected, hold the result for human review. Fabric macro cards do not require a person. Do not claim product colour or facial identity is guaranteed.

For stricter exact centering, add verified segmentation followed by deterministic canvas composition and an explicit padding/crop policy that never clips clothes or body parts. Do not solve centering by stretching the model.

## Queue and persistence

The current repository uses Vinext/React, Cloudflare Workers, D1 for metadata and R2 for image blobs. Protect every batch/source/result read and write with the current authenticated owner. Queries use prepared statements. The current deployment is private and uses the platform-provided ChatGPT sign-in. When moving to another host, implement an equivalent authentication boundary; never remove authorization to make deployment easier.

A batch runs one task at a time. Persist queued/processing/ready/review/approved/failed states. Use a server lease to prevent concurrent duplicate generation. Pause after the current image, retry failures, and resume saved batches. Currently the browser coordinates processing, so the tab must stay open. Closing it preserves the records but does not guarantee unattended completion. For unattended large-volume processing, implement a durable job queue/worker; do not pretend a browser loop is a background service.

## ZIP naming

For a single output, `MAX_001.jpg` becomes `MAX_001-AI.png`. Output bytes are PNG; never retain `.jpg` on a PNG file. Preserve the source basename and Unicode. Six-card sets use separate folders:

- `MAX_001/card-01/MAX_001-AI.png`
- `MAX_001/card-02/MAX_001-AI.png`
- through card 06.

Each generated filename still ends in `-AI`. Original photographs remain untouched under `originals/` for workflows 2 and 3. Export ready and explicitly approved results. Exclude unapproved review/failed/queued entries. Include a mapping/review manifest. Stream each image into an uncompressed ZIP entry. The current browser download has a 512 MB archive cap; select smaller groups when needed. For unlimited-size batches, implement object-storage multipart ZIP creation or File System Access streaming without accumulating the whole archive in browser memory.

## UI and branding

An English working dashboard with a blue Max Fashion wordmark, white surfaces, compact mode cards, a left creative-direction panel, originals/results tabs, image thumbnails, progress/status, saved batches, per-image revision dialog and ZIP controls. The UI must be responsive and keyboard accessible. Use real uploaded product images; never show fabricated generated results as if a paid API ran. Connection status must distinguish a key merely entered from a verified server connection.

## Acceptance checks

- A mannequin reference in workflow 1 creates six tasks, with a fabric macro last.
- Supporting photos in workflows 2/3 never trigger generation.
- Workflow 3 requires identity reference; workflow 4 rejects mannequin/flat-lay input.
- Another owner cannot read or mutate a batch or its original/result files.
- Two parallel process requests cannot both acquire an active task.
- An invalid key/rate limit creates a clear failure and stops repeated paid requests.
- Unknown centering or product differences produce review status, not automatic approval.
- A revision changes only that task and preserves its original.
- ZIP names, MIME types and contents match the naming rules; duplicates cannot overwrite files.
- Original uploaded bytes remain unchanged.
- Missing credentials never fall back to fabricated images.

API generation still needs a valid paid Google key. Build/type checks and fixture-based integration checks cannot establish actual generation quality; validate with a small real product batch before expanding production volume.

Official references: https://ai.google.dev/gemini-api/docs/image-generation and https://ai.google.dev/api/interactions-api
