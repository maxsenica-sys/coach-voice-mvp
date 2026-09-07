# Brief: twelve sport silhouettes for the CoachVoice opening montage

Paste everything below the line into Claude Design (or any illustrator).
It is written to be self-contained — it assumes no knowledge of this repo.

## Status

A first set landed and is live: fourteen drawings in `tools/silhouette-art/`,
named in montage order by `tools/silhouette-order.json`. They replaced the
generated figures entirely.

Against the twelve asked for below, the set that came back drops **volleyball**
and **sprinting** and adds **baseball, ice hockey, javelin** and
**skateboarding**. That is a fair trade — sprinting is the one sport in the
original list with no prop at all, which is exactly what the brief says tests
badly — but volleyball is worth asking for again: it is the sport this app's
first users actually play.

One defect to fix rather than live with: **cricket has no bat.** The batter's
raised hand grips nothing, and the only cricket-specific object in the frame is
the stumps. At a tenth of a second, next to a baseball frame that does have a
bat, it reads as baseball twice. Everything else in the set is sound.

What comes back gets dropped into `tools/silhouette-art/<sport>.svg` and framed
by `node tools/register-silhouettes.mjs`, which measures each drawing in a real
browser and applies the transform that keeps all twelve on one optical centre.
So the artwork does **not** need to solve framing. It needs to solve anatomy.

---

## The job

Twelve flat silhouettes of athletes, one per sport, for the two-and-a-half
second animation that plays when a coaching app opens. They appear one at a
time in the same spot on a dark screen — the first holds for 320ms, each one
after is slightly faster, the last flicks past in 105ms. The effect being aimed
for is a Marvel title card: a book of pages being flipped, accelerating.

Because they occupy the same spot and change that fast, the eye does not read
twelve pictures. It reads **one figure moving through twelve sports**. That is
the whole design problem, and it drives every rule below.

**Audience:** athletes aged 13–18 and their coaches, on a phone, held at
arm's length, often outdoors in daylight. Assume the figure is about 260px
tall and the viewer has one third of a second.

## The twelve

Archery · Cycling · Volleyball · Rowing · Weightlifting · Sprinting ·
Basketball · Skiing · Tennis · Cricket · Football · Boxing

These were picked for **prop strength**, not for coverage. A sport is
recognised by the object it uses — the bow, the bike, the barbell, the bat —
far more than by the body's shape. Sports with no distinctive object
(swimming, gymnastics, trampoline) test badly at a glance and are already cut.
Do not substitute sports. If one of the twelve genuinely cannot be made to read
in a third of a second, say which and why rather than swapping it.

## Format

- **One SVG per sport.** `viewBox="0 0 120 170"`, portrait.
- **The athlete is a single closed `<path>`** — all limbs, torso, head, hands
  and feet fused into one mass under nonzero fill. Not a group of parts, not
  strokes, not separate shapes per limb.
- **The prop is separate paths**, in the same file, after the body. It may be
  stroked (`fill="none" stroke="currentColor"`) where that is the honest way to
  draw it — a bicycle frame, a racket head, a bow.
- **No colour, no gradients, no opacity below 1**, with one exception: a
  ground or net band may sit at `opacity="0.45"` as a second element.
  Everything else must be pure `currentColor`. Colour is applied downstream and
  is a safety constraint, not a style choice — see below.
- **No `<image>`, no embedded raster, no filters, no clip paths.** These get
  inlined into a React component and rendered thousands of times.
- Fill the frame confidently. Bleeding a deliberately frame-spanning element
  off the edge (a net line, a pair of oars, the ground) is fine and welcome.
  A **prop bleeding off by accident is not** — a bat with its blade cut off, a
  bow with a clipped limb, reads as a mistake and kills the recognition the
  prop exists to provide.

## Anatomy — where the current set fails

The set being replaced was generated from joint coordinates, and it reads as
sticks with discs at the joints. The specific failures, all of which have been
measured, are the specific things to fix:

1. **Joints were perfect circles of exactly the limb's half-width**, so all 120
   joints in the set were the same cap. Real joints are wider across the bend
   than along it and sit toward the extensor side — a knee bulges forward of
   the shin, an elbow behind the forearm.
2. **Limbs were straight dowels of constant taper.** A thigh has a belly about
   a third of the way down; a calf's belly is higher than its midpoint; a
   forearm is wider at the elbow than a bicep is at the shoulder.
3. **Shoulders were a disc wider than the head.** Shoulder width should come
   from the deltoid corners, not from a ball at the joint. The trapezius line
   should read as a slope from neck to shoulder point, not as a circle.
4. **The head sat on the shoulder mass**, so every figure read as a snowman.
   There must be daylight — an actual neck — between the skull and the
   shoulder line in every pose, including crouched ones.
5. **Hands and feet were stubs.** A foot needs a heel projecting behind the
   ankle and a toe in front; a hand needs to read as a mass, especially where
   it grips the prop.

Aim for the density of a **1972 Munich Olympic pictogram** — Otl Aicher's
system — but with joints and muscle bellies rather than Aicher's pure
geometry. Munich is the reference for *clarity and weight*, not for the strict
45°/90° grid. Think closer to a modern federation logo: recognisably anatomical
at silhouette level, zero interior detail.

## Poses — go and look at reference first

For each sport, find the image that is already in people's heads. Not a
generic athlete doing the activity: the **one frame that sport is famous for**.
The pose does most of the identifying alongside the prop, and a merely
plausible pose is the difference between "someone with a stick" and "cricket".

Some that are known to work and known not to:

- **Archery** — full draw, bow arm locked and horizontal, string hand at the
  jaw. The bow should be tall and near-full-height. This one is strong.
- **Cycling** — deep drops position, back near horizontal, head low and
  forward. Both wheels fully in frame; the frame triangle must close.
- **Volleyball** — airborne spike at the top of the jump, hitting arm fully
  extended above the head, ball just above the hand, net band crossing low.
- **Rowing** — the only horizontal figure in the set, and it earns its place
  for exactly that reason: after eight uprights, a horizontal frame is a jolt.
  Oars spanning the full width, hull bleeding off both edges.
- **Weightlifting** — the overhead lockout, not the pull. Bar spanning the
  frame with visible plates. The most symmetrical figure in the set.
- **Sprinting** — mid-stride at full extension, trailing leg high behind.
  Currently the best figure in the set, because it is the only one with real
  daylight between head and shoulder. Use it as the anatomical benchmark.
- **Basketball** — the jump shot at release, not a dribble. Ball above and
  slightly ahead of the head, guide hand still on it. The hoop reads as a rim
  ellipse; do not draw a backboard.
- **Skiing** — a tucked or carving turn with both poles trailing back and skis
  angled. Not a straight downhill schuss, which reads as standing still.
- **Tennis** — the serve at full extension or an open-stance forehand. The
  racket must be entirely inside the frame including the head.
- **Cricket** — this was the weakest figure in the previous set and needs the
  most reference work. A bowler's delivery stride is more distinctive than a
  batter's shot, but a batter with stumps behind is more unambiguous. Try both
  and say which reads faster.
- **Football** (soccer) — the instep strike, plant foot planted, striking leg
  through the ball, arms out for balance.
- **Boxing** — the guard or a thrown cross, gloves clearly larger than the
  hands would be. Gloves are the prop here; make them read as gloves.

**Facing direction matters.** Roughly half should face left and half right,
alternating through the sequence, so consecutive frames do not read as a
repeated stamp. Say which way each of yours faces.

## Two hard constraints that are not negotiable

**Constant figure scale.** Every athlete must be drawn at the same scale as
every other — same head size, same limb lengths, same body mass. A crouched
cyclist will occupy a smaller box than a standing weightlifter, and that is
correct. What must not happen is the figures being individually resized to fill
the frame, which makes the montage pulse. Concretely: **draw every head at
roughly 14×17 units** in the 120×170 frame, and derive everything else from it.
If all twelve heads match, the set is in scale.

**Brightness ceiling.** These render at a fill that is deliberately only 7.6%
brighter than the background. WCAG 2.3.1 counts a large-area luminance swing of
10% or more, repeated more than three times a second, as a flash risk — and
this montage runs at up to nine frames a second for an audience aged 13–18. The
figures therefore cannot be made lighter to help them read. **Detail can grow;
brightness cannot.** If a figure is hard to read, the fixes available are: make
it larger, hold it longer, thicken the prop, or simplify the pose. Do not
compensate with contrast, and do not add a stroke, glow, or outline.

## Deliver

For each sport: the SVG, the facing direction, and one line on what reference
you worked from and what you traded off.

Then, before anything else, the two you are least confident in and why — that
is more useful than twelve confident files.
