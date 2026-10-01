/**
 * Ready-made prompt-builder skills. Each skill is a set of written instructions a vision model
 * follows for every uploaded photo: it analyses the outfit, picks a fresh scene/pose/light
 * combination from the skill's library and writes a long image prompt in the shared template.
 * The Fashion Editorial skill is the original one; the others reuse its analysis and template
 * rules with their own creative direction and library.
 */
import { EDITORIAL_LIBRARY, EDITORIAL_SKILL, EDITORIAL_TEMPLATE } from "./editorial-skill";

export interface SkillDef {
  id: string;
  title: string;
  /** Short tagline under the title. */
  caption: string;
  /** One or two sentences shown when the skill is selected. */
  description: string;
  /** The full skill text handed to the prompt builder. */
  instructions: string;
  /** The scene / pose / light library handed to the prompt builder. */
  library: string;
  /** Prompt template the builder fills in. */
  template: string;
}

/**
 * Rules every derived skill shares with the editorial one: how to read the upload, the face
 * policy, how to rotate scenes between runs and the shape of the final prompt.
 */
const CORE_RULES = `## Inputs

- Required: one image of a model wearing the outfit (plain background, any gender/age).
- Optional: market look preference for a generated face (Arab / European / mixed), a city or mood preference, aspect ratio.

## Step 1 — Analyze the upload (always)

1. **Subject class**: adult woman / adult man / child (estimate age band). Body type and height impression.
2. **Face visibility**: \`FACE_VISIBLE\`, \`FACE_PARTIAL\` or \`NO_FACE\`. Treat FACE_PARTIAL as NO_FACE for identity, but keep any visible chin/hair traits consistent.
3. **Outfit inventory — garment by garment, top to bottom** (the most important part). For each item: garment type, exact colour names, fabric and finish, fit and silhouette, length, neckline/collar, sleeves and cuffs, closures (number, colour, material), pockets, seams and topstitching, hems, waist treatment, prints (motif, scale, repeat, colours), graphics or embroidery (exact position and size, text spelled exactly), trims, layering order, how it is worn. Footwear and accessories only if they appear in the upload, otherwise "not supplied".
4. **Styling gaps**: which parts of the look are missing. They may be completed only with neutral, non-competing pieces that never distract from the product.

## Step 2 — Pick a fresh creative combination

Choose ONE scene family, ONE pose (matching the subject class), ONE light, ONE camera/framing and ONE colour grade from this skill's library. Never reuse a scene family or pose already used for this outfit in an earlier run. You may invent a new scene within this skill's world as long as it is described with the same density (surfaces, depth layers, background activity, weather, time of day, shadows).

## Step 3 — Write the prompt

Fill the template section by section:

- **OUTFIT — CRITICAL**: the full inventory from Step 1 in precise words, then the lock clause: reproduce exactly; no redesign, recolour, simplification, added logos, removed buttons, changed length or fit; realistic drape, folds, tension and gravity for the new pose; print scale and position unchanged; garment text spelled exactly as in the reference.
- **FACE**: \`FACE_VISIBLE\` → preserve the exact facial identity (face shape, eyes, brows, nose, lips, jawline, skin tone, marks); only expression, gaze, makeup intensity and hairstyle may change. \`NO_FACE\` / \`FACE_PARTIAL\` → create a professional model face following the market preference (alternate Arab / European across runs when "auto"). Always add the realism block: visible pores, subtle asymmetry, peach fuzz, natural under-eye detail, no plastic, waxy, beauty-filter or CGI skin, no uncanny eyes.
- **POSE**: from this skill's library, with weight distribution, torso rotation, each arm and hand, head angle and gaze, and how the pose shows the garment's key details. Never a stiff straight-on stance with arms at the sides unless the skill asks for catalogue poses.
- **ENVIRONMENT**: foreground, midground and background layers, materials and textures, weather, softly blurred background activity, no readable signage or text.
- **CAMERA & COMPOSITION**, **LIGHTING**, **COLOR GRADE** and the **AVOID** block as in the template.
- Opening line (always): "Use the attached image as the single source of truth for the outfit[ and the model's facial identity]. Replace the plain background completely with the new setting described below."

Kids rules (mandatory when the subject is a child): playful, natural, age-appropriate poses only; bright friendly places; no adult styling, makeup or mature expressions.

Styling rules for missing pieces: complete the look only with neutral basics in colours that support the product and state in the prompt that they are secondary styling items.

Prompt length target: 600-1100 words, in English.`;

interface Draft {
  id: string;
  title: string;
  caption: string;
  description: string;
  goal: string;
  library: string;
}

function derive(d: Draft): SkillDef {
  return {
    id: d.id,
    title: d.title,
    caption: d.caption,
    description: d.description,
    instructions: `# ${d.title} Prompt Builder\n\n${d.goal}\n\n${CORE_RULES}`,
    library: d.library,
    template: EDITORIAL_TEMPLATE,
  };
}

const EDITORIAL: SkillDef = {
  id: "editorial",
  title: "Fashion editorial",
  caption: "Zara / Splash campaign look",
  description:
    "Luxury on-location campaign imagery: city streets, stone facades, terraces and lobbies with real editorial poses. The original prompt-builder skill.",
  instructions: EDITORIAL_SKILL,
  library: EDITORIAL_LIBRARY,
  template: EDITORIAL_TEMPLATE,
};

const ECOMMERCE = derive({
  id: "ecommerce-studio",
  title: "E-commerce studio",
  caption: "Clean PDP shots · neutral backdrop",
  description:
    "Product-page imagery on a seamless neutral studio backdrop with even light and simple catalogue poses that show the garment clearly. Same model look across the set.",
  goal: `Goal: from ONE product-on-model photo write ONE prompt for a clean e-commerce product-page image. The garment is the hero; the setting is a seamless studio backdrop and the pose is a simple, readable catalogue pose. Across runs rotate the backdrop tone, the pose and the framing so the set covers front, three-quarter, side and detail views. Catalogue poses ARE allowed here (standing straight is fine for run 1), but each run must differ in pose or framing.`,
  library: `# E-commerce studio library

## Backdrops (pick one family per run)
1. Pure white seamless paper, soft floor gradient, no horizon line.
2. Warm off-white / ivory seamless with a faint contact shadow.
3. Light warm grey seamless, slightly darker toward the floor.
4. Soft beige seamless with a subtle vignette.
5. Pale sage or stone studio wall with an even wash of light.
6. Cool light grey cyclorama with a gentle gradient.

## Poses
- Run 1: front-facing, weight even, arms relaxed slightly away from the body so the silhouette reads.
- Three-quarter turn, one hand lightly in a pocket or on the hip, gaze to camera.
- Side profile with a slight step forward to show the garment's length and drape.
- Back view with head turned over the shoulder.
- Walking step toward the camera, relaxed arms, natural motion.
- Seated on a low white cube or stool, legs angled, hands resting on the knee.
- Hands adjusting a cuff, collar or hem to show the detail.

## Light
- Large softbox key at 45°, white fill opposite, soft shadows, even exposure on the fabric.
- Two large diffused sources for near-shadowless catalogue light.
- Slight top light with a soft rim to separate the garment from the backdrop.

## Camera
- 85 mm equivalent, camera at chest height, straight-on, full-length or three-quarter crop, subject centred, generous head and foot room.
- 50 mm equivalent for a seated or detail crop.

## Colour grade
- Neutral, true-to-life colours, clean whites, no colour cast, minimal contrast, fabric detail preserved in highlights.

## Avoid
- Props, location backgrounds, dramatic shadows, colour casts, heavy retouching, cropped feet in full-length runs.`,
});

const STREET = derive({
  id: "street-style",
  title: "Street style",
  caption: "Candid urban · daylight",
  description:
    "Candid city imagery in the style of street-style photography: sidewalks, crosswalks, cafes, brick and railings, with natural mid-stride and leaning poses.",
  goal: `Goal: write ONE prompt for a candid street-style image shot on a real city street in daylight. The energy is spontaneous and off-duty: walking, waiting, leaning, crossing. The outfit stays exactly as supplied; the city, pose and light change every run.`,
  library: `# Street style library

## Scene families
1. Crosswalk on a wide avenue, zebra stripes, blurred traffic and pedestrians, overcast daylight.
2. Brick side street with a metal railing, parked bicycle, a cafe awning in the background.
3. Pale limestone facade with tall arched doorway and a stone step, morning sun.
4. Glass office tower entrance with revolving doors and reflections, bright overcast.
5. Covered arcade with repeating columns and patterned tiled floor, soft bounced light.
6. Corner cafe terrace with bistro chairs, a takeaway cup, late-afternoon sun.
7. Pedestrian bridge or stairs with concrete balustrade and a hazy skyline.
8. Tree-lined residential street with low walls, dappled light through leaves.

## Poses
- Mid-stride walk toward the camera, one hand holding a tote or phone, gaze slightly off camera.
- Leaning on a railing with one elbow, weight on one hip, looking down the street.
- Stepping off a kerb, coat or jacket caught in motion.
- Waiting at a crossing with hands in pockets, head turned to the side.
- Sitting on a stone step, one knee up, coffee in hand.
- Turning over the shoulder as if called, hair in motion.
- Adjusting sunglasses or a collar with one hand, candid half-smile.

## Light
- Bright overcast sky, soft wrap-around light, gentle shadows.
- Low morning sun from one side, long soft shadows on the pavement.
- Open shade on the shadow side of the street with bright bounced light from the opposite facade.

## Camera
- 35 mm equivalent, camera at waist height, slight low angle, full-length, subject on a third with street depth behind.
- 50 mm equivalent, three-quarter crop, shallow depth of field with blurred passers-by.

## Colour grade
- Natural film look, muted greys and stone tones, slightly lifted blacks, true skin tones.

## Avoid
- Readable signs or logos, posed studio stance, empty sterile streets, harsh midday top light.`,
});

const RESORT = derive({
  id: "resort",
  title: "Resort & summer",
  caption: "Beach, marina, pool · golden light",
  description:
    "Warm-weather imagery for linen, dresses, swim cover-ups and summer sets: beaches, marinas, white stucco, pool decks and palm shade with golden-hour light.",
  goal: `Goal: write ONE prompt for a sunlit resort / summer image. Think Gulf coast and Mediterranean holiday: white stucco, sea haze, palms, marinas and pool decks. The look is relaxed and luxurious; the garment stays exactly as supplied and must read clearly against bright backgrounds.`,
  library: `# Resort & summer library

## Scene families
1. White stucco villa wall with a blue wooden door and bougainvillea, hard afternoon sun.
2. Beach boardwalk with pale sand, sea haze and a distant pier.
3. Marina promenade with white yachts, teak decking and a bright sky.
4. Hotel pool deck with loungers, a palm shadow across travertine.
5. Coastal road at golden hour with low sun and a pale sky.
6. Rooftop terrace with rattan furniture and a sea horizon.
7. Shaded palm garden path with terracotta pots and dappled light.
8. Beach club entrance with linen curtains moving in a breeze.

## Poses
- Walking along the water's edge, one hand holding a hat or sunglasses.
- Leaning against a sun-warmed wall with one foot crossed, face turned to the sun.
- Sitting on the edge of a lounger or low wall, legs extended, relaxed shoulders.
- Standing on a boardwalk with fabric caught in a sea breeze, looking back.
- Holding a straw bag over the shoulder, mid-step, candid laugh.
- Resting on a railing looking out to sea, three-quarter back view.

## Light
- Golden hour, warm low sun from the side, long soft shadows.
- Bright open shade under a palm or awning with warm bounced light.
- Hard midday sun with crisp shadows, used only when the garment is light and matte.

## Camera
- 35 mm equivalent, full-length, slight low angle, horizon kept level.
- 85 mm equivalent, three-quarter crop, sea or stucco softly out of focus.

## Colour grade
- Warm whites, sand, aqua and terracotta accents, bright but not overexposed, sun-kissed skin.

## Avoid
- Blown-out highlights on white fabric, swimwear poses for non-swim garments, cluttered tourists, readable signage.`,
});

const RAMADAN = derive({
  id: "ramadan-eid",
  title: "Ramadan & Eid",
  caption: "Festive evening · lanterns & courtyards",
  description:
    "Festive occasion imagery for the Ramadan and Eid season: lantern-lit courtyards, arched corridors, majlis interiors and dusk terraces with warm, elegant light.",
  goal: `Goal: write ONE prompt for an elegant Ramadan / Eid season image. The mood is warm, festive and family-oriented: lanterns, arches, courtyards, majlis seating and dusk skies. Styling and poses stay modest and graceful. The garment stays exactly as supplied.`,
  library: `# Ramadan & Eid library

## Scene families
1. Arched stone courtyard with hanging brass lanterns, warm bulbs, blue-hour sky.
2. Majlis interior with low cushioned seating, patterned rugs, soft lamp light.
3. Riad-style corridor with carved wooden doors and geometric tiles, late-afternoon shafts of light.
4. Hotel ballroom entrance with marble floor, palm arrangements and crescent-moon decor.
5. Terrace at dusk with a city skyline, string lights and a dates-and-tea table.
6. Traditional souk arcade with warm lanterns and soft blurred crowd.
7. Modern villa garden at sunset with a long dining table set for iftar.
8. Mosque-adjacent plaza with pale stone and soft evening light (no readable text).

## Poses
- Standing beside an arch with one hand resting on the stone, gaze to the lanterns.
- Walking slowly along a corridor, fabric flowing, head turned gently to camera.
- Seated on majlis cushions with hands resting in the lap, calm smile.
- Holding a small gift box or lantern at waist height, three-quarter stance.
- Leaning on a terrace balustrade at dusk, looking toward the skyline.
- Pausing on a step with one hand lifting the hem slightly, elegant posture.

## Light
- Blue hour: cool sky with warm lantern and lamp light on the subject.
- Golden low sun through arches, long shadows across tiles.
- Soft indoor lamp light with a gentle warm wrap and a cool window fill.

## Camera
- 50 mm equivalent, full-length or three-quarter, slight low angle, subject on a third with lanterns in soft focus.
- 85 mm equivalent for seated and detail crops.

## Colour grade
- Warm amber, deep teal and ivory palette, rich but natural skin tones, gentle contrast.

## Avoid
- Revealing poses, alcohol or party props, readable calligraphy or signage, over-saturated gold tones.`,
});

const MODEST = derive({
  id: "modest",
  title: "Modest fashion",
  caption: "Abaya, hijab & modest sets",
  description:
    "Elegant modest styling for abayas, kaftans, hijab looks and long sets: clean architecture, hotel lobbies, courtyards and desert light with flowing, graceful poses.",
  goal: `Goal: write ONE prompt for a refined modest-fashion image. Everything supplied in the reference is kept exactly, including hijab style, coverage and layering; never remove or shorten a layer. Poses are graceful and show the garment's drape and length. Generated faces follow the market preference and keep natural, understated makeup.`,
  library: `# Modest fashion library

## Scene families
1. Minimal white-arch architecture with clean shadows, late-afternoon sun.
2. Hotel lobby with pale marble, tall columns and soft daylight.
3. Desert dunes at golden hour, gentle wind, pale sky.
4. Courtyard with a reflecting pool and date palms.
5. Modern museum interior with concrete walls and skylight.
6. Palm-lined avenue with white villas, soft overcast light.
7. Sand-coloured alley with carved doors and bougainvillea.
8. Glass-walled cafe with linen chairs and a city view.

## Poses
- Walking toward the camera with the fabric flowing behind, hands relaxed.
- Standing in profile with one hand lightly holding the fabric at the hip, head turned to camera.
- Seated on a stone bench, posture upright, hands folded.
- Turning in place so the hem fans out, gaze down then up.
- Leaning gently on a column with one shoulder, serene expression.
- Mid-step on a wide staircase, one hand on the rail.

## Light
- Golden hour from the side, warm and soft.
- Bright overcast or open shade, even light that preserves fabric colour.
- Soft indoor daylight from tall windows.

## Camera
- 50 mm equivalent, full-length, camera at waist height, slight low angle to lengthen the silhouette.
- 85 mm equivalent, three-quarter crop with architecture softly blurred.

## Colour grade
- Sand, ivory, soft black and muted gold, clean neutral skin tones, calm contrast.

## Avoid
- Any change to coverage, hijab style or layering; tight or revealing poses; wind that exposes skin; readable text.`,
});

const ACTIVEWEAR = derive({
  id: "activewear",
  title: "Activewear",
  caption: "Gym, track, yoga · dynamic",
  description:
    "Dynamic sport imagery for leggings, sets, trainers and performance tops: gyms, running tracks, yoga studios and outdoor stairs with motion and energy.",
  goal: `Goal: write ONE prompt for an energetic activewear image. Show the garment in motion or in a strong athletic stance that reveals fit, stretch and seams. Settings are gyms, tracks, studios and urban training spots. The garment stays exactly as supplied.`,
  library: `# Activewear library

## Scene families
1. Bright modern gym with rubber floor, racks softly blurred, daylight from high windows.
2. Outdoor running track at early morning, red lanes, light mist.
3. Yoga studio with wooden floor, white walls and large windows.
4. Urban park stairs or concrete steps in soft overcast light.
5. Rooftop training deck with a hazy skyline.
6. Coastal promenade at sunrise, empty and clean.
7. Indoor basketball court with warm wood floor and side light.
8. Boxing gym with a heavy bag and a single window light.

## Poses
- Mid-stride run toward the camera, arms pumping, hair in motion.
- Lunge or squat hold with a strong core, gaze forward.
- Stretching one arm across the chest, three-quarter stance.
- Seated on a bench tying a trainer, looking up.
- Walking with a water bottle and a towel over the shoulder, relaxed.
- Jumping onto a step mid-air, crisp motion.
- Yoga tree or warrior pose on a mat, calm expression.

## Light
- Bright directional window light with a soft rim on the shoulders.
- Early-morning sun from a low angle, long shadows on the track.
- Even overhead gym light with soft daylight fill.

## Camera
- 35 mm equivalent, low angle, full-length, strong diagonal composition.
- 85 mm equivalent, three-quarter crop with background softly blurred, fast shutter look.

## Colour grade
- Clean, punchy but natural, cool greys with the garment's colours vivid, true skin tones.

## Avoid
- Sweat-soaked fabric, distorted limbs in motion, fabric stretched into a different silhouette, readable branding.`,
});

const KIDS = derive({
  id: "kids",
  title: "Kids",
  caption: "Playful, bright, family-safe",
  description:
    "Family-catalogue imagery for babies, kids and teens: parks, sunny courtyards, playgrounds, classrooms and colourful doorways with natural playful poses.",
  goal: `Goal: write ONE prompt for a bright, playful kidswear image in a premium family-catalogue tone (Zara Kids, Mango Kids). Poses are natural and age-appropriate, settings are friendly and safe. No makeup, no adult styling, no mature expressions. The garment stays exactly as supplied.`,
  library: `# Kids library

## Scene families
1. Sunny park lawn with a wooden bench and trees, soft dappled light.
2. Colourful painted doorway on a quiet street, bright overcast.
3. Playground with a slide and soft rubber ground, morning sun.
4. Light classroom with wooden desks and a chalkboard (no readable text).
5. Family kitchen with white tiles and a fruit bowl, window light.
6. Beach at golden hour with a bucket and a kite.
7. Garden courtyard with terracotta pots and a hose.
8. Pastel-coloured wall with a scooter leaning against it.

## Poses
- Skipping toward the camera, big natural laugh.
- Sitting on a bench swinging the legs, holding an ice-cream or a book.
- Jumping off a low kerb mid-air.
- Holding a scooter handle with one hand, looking back.
- Crouching to look at something on the ground, curious.
- Standing with hands in pockets, shy smile.
- Teens: leaning on a wall with a backpack, relaxed and confident.

## Light
- Soft morning sun from the side, gentle shadows.
- Bright overcast, even and friendly.
- Window light indoors with a soft fill.

## Camera
- 35 mm equivalent at the child's eye level, full-length, slightly low.
- 50 mm equivalent, three-quarter crop with a blurred playful background.

## Colour grade
- Bright, clean and warm, cheerful colours without over-saturation, natural skin tones.

## Avoid
- Makeup, sunglasses posed seductively, mature expressions, unsafe situations, readable text.`,
});

const EVENING = derive({
  id: "evening",
  title: "Evening & occasion",
  caption: "Hotel corridors, lounges, dusk",
  description:
    "Elegant imagery for dresses, suits and occasion wear: marble hotel corridors, lounges, grand staircases and dusk terraces with warm, cinematic light.",
  goal: `Goal: write ONE prompt for an elegant evening / occasion-wear image. Settings are refined interiors and dusk exteriors; light is warm and cinematic; poses are poised and show the garment's length, fabric sheen and construction. The garment stays exactly as supplied.`,
  library: `# Evening & occasion library

## Scene families
1. Hotel corridor with marble floor, wall sconces and tall doors.
2. Grand staircase with neutral stone and a brass handrail.
3. Luxury lounge with velvet seating, low lamps and a soft glow.
4. Restaurant entrance with warm evening light and blurred candlelight.
5. Modern atrium with tall columns and the last daylight.
6. Terrace at dusk with city lights in the distance.
7. Art-deco lift lobby with mirrored panels and warm bulbs.
8. Garden pavilion at night with string lights.

## Poses
- Descending a staircase with one hand on the rail, gaze ahead.
- Standing in a doorway with light behind, one hand on the frame.
- Seated on a velvet armchair, legs crossed, hand on the armrest.
- Turning back over the shoulder in a corridor, fabric swinging.
- Holding a clutch at the hip, three-quarter stance, chin slightly lifted.
- Men: adjusting a cuff or lapel, weight shifted, relaxed confidence.

## Light
- Warm tungsten lamps with a cool dusk window fill.
- Single soft key from a sconce with a gentle rim from behind.
- Last daylight through tall windows with warm interior fill.

## Camera
- 50 mm equivalent, full-length, slight low angle, symmetric architecture.
- 85 mm equivalent, three-quarter crop, shallow depth of field.

## Colour grade
- Warm amber and deep neutral palette, soft film roll-off, rich fabric detail, natural skin.

## Avoid
- Harsh flash look, over-glossy skin, cluttered party props, readable signage.`,
});

const WORKWEAR = derive({
  id: "workwear",
  title: "Office & workwear",
  caption: "Tailoring, shirts, smart casual",
  description:
    "Smart imagery for tailoring, shirts, blouses and smart-casual sets: office lobbies, co-working spaces, glass corridors and city business districts in clean daylight.",
  goal: `Goal: write ONE prompt for a polished office / workwear image. Settings are modern business environments; poses are confident and natural (walking, meeting, coffee). The garment stays exactly as supplied and its tailoring lines must read clearly.`,
  library: `# Office & workwear library

## Scene families
1. Glass office lobby with a long reception desk and daylight.
2. Co-working space with light wood tables and large windows.
3. Business-district sidewalk with glass towers and a crosswalk.
4. Glass corridor with city reflections and soft overcast light.
5. Boardroom with a long table and floor-to-ceiling windows.
6. Hotel breakfast cafe with marble tables and a coffee cup.
7. Underground car park entrance with clean concrete and a soft light wash.
8. Rooftop office terrace with planters and a skyline.

## Poses
- Walking with a laptop bag or tote, confident stride, gaze ahead.
- Standing at a window with arms loosely crossed, looking out.
- Leaning on a desk edge with one hand, half-smile to camera.
- Seated on a chair edge with a notebook, legs angled.
- Holding a coffee cup mid-conversation, three-quarter stance.
- Men: hands in trouser pockets, jacket open, weight on one leg.

## Light
- Bright window daylight with a soft interior fill.
- Overcast exterior light, clean and even.
- Late-afternoon sun through blinds with gentle stripes on the wall (never on the garment).

## Camera
- 50 mm equivalent, full-length or three-quarter, eye-level, clean verticals.
- 85 mm equivalent for seated or detail crops.

## Colour grade
- Neutral, crisp, cool-leaning whites and greys, true garment colours, natural skin.

## Avoid
- Cluttered desks, readable screens or signage, stiff corporate stock-photo poses, strong colour casts.`,
});

const SOCIAL = derive({
  id: "social",
  title: "Social media",
  caption: "Instagram & TikTok · bold, close, candid",
  description:
    "Scroll-stopping imagery for social feeds: tighter crops, bold colour, candid energy and striking backdrops like coloured walls, neon-free cafes and mirror selfies.",
  goal: `Goal: write ONE prompt for a social-media-first image: bold, close and candid, with a strong single colour or texture behind the subject and an expressive, natural moment. Keep crops tighter than a catalogue shot but never crop out the hero garment. The garment stays exactly as supplied.`,
  library: `# Social media library

## Scene families
1. Solid coloured wall (terracotta, sage, butter yellow, dusty pink) in hard sun with a crisp shadow.
2. Mirror selfie in a bright minimal room, phone partly visible, no readable screen.
3. Cafe counter with a pastel wall and a takeaway cup.
4. Car passenger seat with the window down and street blur.
5. Rooftop at golden hour with a plain sky.
6. Striped beach umbrella shade with bright sand.
7. Neutral corridor with a single strip of sunlight.
8. Flower-market stall with blurred colour behind.

## Poses
- Laughing mid-turn, hair in motion, close three-quarter crop.
- Hand on the back of the neck, gaze off camera, relaxed.
- Leaning into the frame with a tilted head, playful.
- Walking past the camera, caught mid-step.
- Sitting on the floor against the wall, knees up.
- Holding the hem or a strap to show the detail, looking down.

## Light
- Hard direct sun with sharp shadows, used for colour walls.
- Soft window light for indoor and mirror scenes.
- Golden hour backlight with a warm flare.

## Camera
- 35 mm equivalent, close three-quarter or waist-up, slight tilt, subject off centre.
- 50 mm equivalent, mid-length, shallow depth of field.

## Colour grade
- Vibrant, warm, slightly lifted shadows, strong but natural colour.

## Avoid
- Cropping out the hero garment, readable phone screens or signage, heavy filters that change garment colour.`,
});

const WINTER = derive({
  id: "winter",
  title: "Winter layering",
  caption: "Coats, knits, boots · cold light",
  description:
    "Cold-season imagery for coats, knitwear, scarves and boots: autumn city streets, misty parks, cabins and cafe windows with crisp overcast or low winter sun.",
  goal: `Goal: write ONE prompt for a winter / autumn layering image. Settings feel cool and cosy: stone streets, bare trees, mist, cafe windows and wooden cabins. Show the outer layer's weight and texture; keep every layer exactly as supplied.`,
  library: `# Winter layering library

## Scene families
1. Stone city street with bare trees and fallen leaves, crisp overcast.
2. Misty park path with wooden benches and soft fog.
3. Cafe window from outside, warm glow inside, cold light outside.
4. Wooden cabin porch with a stacked-log wall.
5. Cobbled old-town square with a fountain, low winter sun.
6. Train platform with a steel canopy and soft steam.
7. Mountain road viewpoint with a pale cold sky.
8. Brick alley with a hint of frost and warm shop lights.

## Poses
- Walking with hands in coat pockets, collar up, breath visible.
- Wrapping a scarf with both hands, glance to camera.
- Leaning on a cold railing holding a hot drink.
- Standing under a canopy with one shoulder forward, coat open to show the knit.
- Sitting on a wooden bench, legs crossed, boots visible.
- Turning back on cobbles, coat flaring.

## Light
- Crisp overcast with cool, even light and soft shadows.
- Low winter sun from the side, long shadows, warm highlights.
- Blue hour with warm shop-window fill.

## Camera
- 35 mm equivalent, full-length, slight low angle, street depth behind.
- 85 mm equivalent, three-quarter crop with fog or lights softly blurred.

## Colour grade
- Cool greys and blues with warm skin and warm accents, muted film look, texture preserved.

## Avoid
- Snow props that hide the garment, closed coats hiding a hero knit when the knit is the product, readable signage.`,
});

export const SKILLS: SkillDef[] = [
  EDITORIAL,
  ECOMMERCE,
  STREET,
  RESORT,
  RAMADAN,
  MODEST,
  ACTIVEWEAR,
  KIDS,
  EVENING,
  WORKWEAR,
  SOCIAL,
  WINTER,
];

export const DEFAULT_SKILL = EDITORIAL.id;

/** Starting text for Zaid's creative direction; replaced from the app with his own prompts. */
export const ZAID_DEFAULT_DIRECTION = `Brand feel: Max Fashion, premium high-street, warm and welcoming, Gulf and Levant customers.

Scenes to rotate between:
1. Bright modern villa living room with linen sofa, pale stone floor and tall windows.
2. Dubai marina promenade at golden hour, white railings, yachts softly blurred.
3. Sand-coloured old-town alley with carved wooden door and bougainvillea.
4. Minimal white-arch architecture with crisp afternoon shadows.
5. Rooftop cafe terrace with rattan chairs and a hazy skyline.
6. Clean beige seamless studio with soft window-style light.

Poses: natural and relaxed, mid-step or leaning, hands relaxed or in pockets, gaze to camera or just off it. No stiff catalogue stance, no exaggerated editorial drama.

Light: warm natural daylight, soft shadows, true skin tones. Colour grade: warm neutrals, sand, ivory, soft terracotta; never over-saturated.

Camera: 50 mm, waist height, slight low angle, full-length or three-quarter, model on a third with room for the environment.

Always: the garment exactly as supplied, fully visible, naturally worn.`;

/** Mode 7: the prompt builder follows a free-text creative direction instead of a fixed library. */
export function zaidSkill(direction: string): SkillDef {
  const text = direction.trim() || ZAID_DEFAULT_DIRECTION;
  return {
    id: "zaid",
    title: "Zaid creative direction",
    caption: "Custom direction · fresh scene each image",
    description:
      "The prompt builder follows Zaid's own creative direction text: scenes, poses, light, camera and mood as he wrote them.",
    instructions: `# Zaid creative direction Prompt Builder\n\nGoal: from ONE product-on-model photo write ONE long image prompt that follows the CREATIVE DIRECTION below exactly. The direction is the brief: use its scenes, poses, light, camera and colour notes as given, filling in any gaps with choices in the same spirit. Every run must still produce a different scene and pose combination. The garment is what the customer sells and is never changed.\n\n## Creative direction\n\n${text}\n\n${CORE_RULES}`,
    library: `# Library\n\nThe creative direction above is the library. If it lists numbered scenes, rotate through them; otherwise invent scenes consistent with it and describe them with full density (surfaces, depth layers, activity, weather, time of day, shadows).\n\n## Scene families\n${numberedLines(text)}`,
    template: EDITORIAL_TEMPLATE,
  };
}

/** Numbered lines of the direction, re-numbered, so the server can rotate scenes across runs. */
function numberedLines(text: string): string {
  const lines = [...text.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)].map((m) => m[1].trim());
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

export function skillById(id: string | undefined): SkillDef {
  return SKILLS.find((s) => s.id === id) ?? EDITORIAL;
}
