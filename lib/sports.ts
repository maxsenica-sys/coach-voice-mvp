// Comprehensive sports list used across signup, transcription context, and athlete profiles.
// Grouped by category for display; exported flat for dropdowns.

export const SPORTS_BY_CATEGORY: Record<string, string[]> = {
  'Team Ball Sports': [
    'Soccer / Football',
    'American Football',
    'Basketball',
    'Baseball',
    'Softball',
    'Ice Hockey',
    'Field Hockey',
    'Cricket',
    'Rugby Union',
    'Rugby League',
    'Volleyball',
    'Beach Volleyball',
    'Handball',
    'Water Polo',
    'Lacrosse',
    'Australian Rules Football (AFL)',
    'Gaelic Football',
    'Hurling',
    'Netball',
    'Futsal',
    'Floorball',
    'Ultimate Frisbee',
    'Flag Football',
    'Touch Rugby',
    'Kabaddi',
    'Polo',
  ],
  'Racket Sports': [
    'Tennis',
    'Badminton',
    'Squash',
    'Table Tennis',
    'Racquetball',
    'Padel',
    'Pickleball',
  ],
  'Combat & Martial Arts': [
    'Boxing',
    'Kickboxing',
    'Muay Thai',
    'MMA (Mixed Martial Arts)',
    'Judo',
    'Brazilian Jiu-Jitsu (BJJ)',
    'Wrestling (Freestyle)',
    'Wrestling (Greco-Roman)',
    'Karate',
    'Taekwondo',
    'Fencing',
    'Jiu-Jitsu',
    'Sambo',
    'Sumo Wrestling',
    'Kung Fu / Wushu',
    'Aikido',
  ],
  'Athletics & Track': [
    '100m Sprint',
    '200m Sprint',
    '400m',
    '800m',
    '1500m',
    '5000m',
    '10000m',
    'Marathon',
    'Half Marathon',
    'Hurdles (110m / 100m)',
    '400m Hurdles',
    '3000m Steeplechase',
    'High Jump',
    'Long Jump',
    'Triple Jump',
    'Pole Vault',
    'Shot Put',
    'Discus Throw',
    'Hammer Throw',
    'Javelin Throw',
    'Decathlon',
    'Heptathlon',
    'Race Walking',
    'Cross Country Running',
    'Trail Running',
    'Ultramarathon',
  ],
  'Swimming & Water': [
    'Swimming (Pool)',
    'Open Water Swimming',
    'Diving (Platform / Springboard)',
    'Synchronised Swimming',
    'Triathlon',
    'Duathlon',
    'Aquathlon',
    'Surf Lifesaving',
    'Canoeing / Kayaking (Sprint)',
    'Canoeing / Kayaking (Slalom)',
    'Rowing',
    'Dragon Boat Racing',
    'Stand Up Paddleboarding',
    'Sailing',
    'Windsurfing',
    'Kitesurfing',
    'Surfing',
  ],
  'Gymnastics & Movement': [
    'Artistic Gymnastics',
    'Rhythmic Gymnastics',
    'Trampoline',
    'Acrobatic Gymnastics',
    'Aerobic Gymnastics',
    'Parkour / Freerunning',
    'Cheerleading',
    'Dance Sport',
    'Breakdancing (Breaking)',
  ],
  'Cycling': [
    'Road Cycling',
    'Mountain Biking (XC)',
    'Mountain Biking (Downhill)',
    'Track Cycling',
    'BMX Racing',
    'BMX Freestyle',
    'Cyclocross',
    'Gravel Cycling',
  ],
  'Equestrian': [
    'Dressage',
    'Show Jumping',
    'Eventing (3-Day)',
    'Endurance Riding',
  ],
  'Winter Sports': [
    'Alpine Skiing',
    'Cross-Country Skiing',
    'Biathlon',
    'Ski Jumping',
    'Nordic Combined',
    'Speed Skating',
    'Short Track Speed Skating',
    'Figure Skating',
    'Ice Dancing',
    'Curling',
    'Bobsled',
    'Luge',
    'Skeleton',
    'Snowboarding (Halfpipe)',
    'Snowboarding (Slopestyle)',
    'Snowboarding (Alpine)',
    'Freestyle Skiing (Moguls)',
    'Freestyle Skiing (Aerials)',
    'Ski Cross',
  ],
  'Strength & Fitness': [
    'Weightlifting (Olympic)',
    'Powerlifting',
    'CrossFit',
    'Strongman / Strongwoman',
    'Bodybuilding',
    'Functional Fitness',
  ],
  'Other Sports': [
    'Golf',
    'Archery',
    'Shooting (Rifle)',
    'Shooting (Pistol)',
    'Shooting (Shotgun / Trap / Skeet)',
    'Sport Climbing',
    'Bouldering',
    'Skateboarding',
    'Roller Derby',
    'Inline Speed Skating',
    'Modern Pentathlon',
    'Darts',
    'Tenpin Bowling',
    'Esports',
    'Motorsport (Karting)',
    'Motorsport (Formula)',
  ],
}

// Flat list for simple dropdowns (alphabetically sorted within each category, categories in order above)
export const ALL_SPORTS: string[] = Object.values(SPORTS_BY_CATEGORY).flat()

// Sport-specific terminology hints used in the AI transcription prompt
/* Every key here MUST be a string that appears in ALL_SPORTS.
 *
 * Two did not: 'Gymnastics (Artistic)' and 'Soccer / Football (Advanced)'. The
 * matcher used to reach them by partial match, so they looked like they worked
 * while being unreachable by exact name — and the second is not a sport at all,
 * it is a second opinion about the first one.
 *
 * verify:prompt now asserts this, so a key can never again describe a sport
 * that does not exist. */
export const SPORT_TERMINOLOGY: Record<string, string> = {
  'Soccer / Football': 'soccer, dribbling, pressing, offside, through ball, defensive shape, high press, tiki-taka, gegenpressing, false 9, overlapping runs, set pieces, corner kicks, VAR',
  'American Football': 'quarterback, snap, blitz, coverage, route running, zone defense, man coverage, red zone, audible, pocket, pass rush, offensive line, gap scheme, play action',
  'Basketball': 'pick and roll, iso, three-pointer, fast break, post up, help defense, switching, zone defense, transition offense, floater, mid-range, corner three, paint touches',
  'Baseball': 'pitch count, at-bat, ERA, OPS, batting average, fielding, pop time, exit velocity, launch angle, spin rate, changeup, curveball, slider, fastball, two-seamer',
  'Softball': 'pitch speed, drop ball, rise ball, screwball, bunting, slap hitting, infield, outfield, at-bat, fielding, pop time',
  'Ice Hockey': 'skating edges, crossovers, stick handling, wrist shot, slap shot, power play, penalty kill, forechecking, backchecking, neutral zone, faceoff, positioning',
  'Tennis': 'topspin, slice, volley, baseline, approach shot, serve and volley, break point, deuce, advantage, tiebreak, groundstroke, rally, net play',
  'Rugby Union': 'scrum, lineout, ruck, maul, breakdown, offload, kick chase, defensive line, blitz defense, gainline, carrying, tackle technique, set piece',
  'Rugby League': 'dummy half, play-the-ball, tackle count, kick on last, dummy, offload, line speed, ruck speed, defensive efficiency',
  'Swimming (Pool)': 'stroke rate, catch, pull, push, kick, flip turn, breakout, underwater dolphin kicks, DPS, pacing, splits, taper, stroke mechanics',
  'Triathlon': 'transitions, brick training, aero position, drafting, run-off-bike, brick session, VO2 max, threshold pace, swim-to-bike',
  '100m Sprint': 'block start, drive phase, acceleration, max velocity, top end speed, stride frequency, stride length, reaction time, taper',
  'Marathon': 'long slow distance, tempo run, threshold, VO2 max, aerobic base, glycogen, bonk/hitting the wall, negative split, pacing strategy',
  'CrossFit': 'WOD, AMRAP, EMOM, for time, metcon, Rx, scaled, gymnastics, weightlifting, HSPU, kipping, muscle up, clean, snatch, deadlift, squat, benchmark workouts',
  'Weightlifting (Olympic)': 'snatch, clean and jerk, clean, jerk, pull, catch, front squat, overhead squat, footwork, receiving position, bar path, hip contact',
  'Powerlifting': 'squat, bench press, deadlift, total, wilks, IPF, opener, attempt selection, bracing, arch, sticking point, lockout',
  'Artistic Gymnastics': 'release move, connection, amplitude, artistry, deduction, pike, tuck, layout, salto, twist, handstand, cast, giant, dismount, mount',
  'Boxing': 'jab, cross, hook, uppercut, body shot, combination, guard, slipping, rolling, footwork, southpaw, orthodox, clinch, ring IQ',
  'MMA (Mixed Martial Arts)': 'striking, grappling, takedown, guard, mount, back control, submission, choke, kimura, armbar, transition, cage work, dirty boxing',
  // Volleyball had NO entry, which is how the pinned golden prompt came to read
  // `SPORT: Volleyball` / `Common terms in this sport: athletic performance,
  // coaching cues, technique…`. That line was untrue, and it has been green in
  // the rig since the rig existed — the reviewed, gated "most consequential text
  // in the product" asserting something false about the sport this app was
  // built around.
  'Volleyball': 'serve receive, pass, set, hit, spike, tip, roll shot, block, touch, dig, platform, approach, transition, rotation, libero, setter dump, free ball, seam',
  'Beach Volleyball': 'serve receive, pass, set, hand set, bump set, cut shot, line shot, pokey, block, peel, dig, side out, wind, sand approach',
  'Netball': 'centre pass, footwork, obstruction, contact, held ball, zone defence, one-on-one defence, drive, dodge, feed, circle edge, shooting percentage',
  'Field Hockey': 'push pass, slap, hit, drag flick, penalty corner, 16-yard hit, tackle, jink, three-dimensional skills, press, outlet',
  'Cricket': 'line and length, seam, swing, spin, googly, doosra, front foot, back foot, cover drive, pull shot, sweep, field placement, powerplay, strike rotation',
  'Badminton': 'clear, drop shot, smash, net shot, lift, drive, footwork, split step, rally, front court, rear court, deception',
  'Table Tennis': 'topspin, backspin, sidespin, loop, block, flick, push, chop, serve receive, third ball attack, footwork, bat angle',
  'Water Polo': 'eggbeater, drive, set position, centre forward, wet pass, dry pass, counter attack, six on five, exclusion, press defence, zone',
  'Rowing': 'catch, drive, finish, recovery, ratio, rate, split, stroke rate, run, bladework, feathering, square blade, ergo, rig',
  'Golf': 'swing plane, takeaway, transition, impact position, club path, face angle, strike, short game, bunker play, putting stroke, course management',
}

/**
 * Get a brief vocabulary hint string for use in AI transcription prompts.
 * Falls back to a generic sports coaching hint if sport not found.
 */
/**
 * The sport-specific vocabulary to prime transcription and summarisation with,
 * or an empty string when we do not have any.
 *
 * ── Why there is no longer a partial match, and no longer a fallback ───────
 *
 * This value is spliced into a Whisper context prompt and into the summariser's
 * instruction to "interpret ambiguous or misheard words as {sport}
 * terminology". Both are token prefixes that bias decoding. So a wrong answer
 * here is worse than no answer: it actively pushes the transcript toward words
 * the coach never said.
 *
 * The partial matcher did exactly that. Measured against the real list:
 *
 *   Ice Dancing            -> Ice Hockey          (slap shot, power play, penalty kill)
 *   Synchronised Swimming  -> Swimming (Pool)
 *   Table Tennis           -> Tennis
 *   Rhythmic Gymnastics    -> Gymnastics (Artistic)
 *
 * An ice dancer's session was being transcribed with hockey vocabulary and then
 * summarised under instructions to read ambiguous words as hockey terms. That
 * is the volleyball-hardcoding bug from the deleted sessions/audio route,
 * reappearing one layer down.
 *
 * And the fallback — "athletic performance, coaching cues, technique, drills,
 * conditioning, tactical awareness, mental performance" — reached 123 of 154
 * sports while being presented to the model as "Key terms in this sport". It is
 * not terminology; it is the words a prompt uses to describe coaching. Priming
 * a padel transcript with them biases it toward generic sports commentary.
 *
 * Exact match or nothing. A caller with no hint says nothing about vocabulary,
 * which is the honest state for 123 sports and is strictly better than a
 * confident wrong one. Filling the table in is ordinary incremental work; the
 * rig asserts every key is a real sport so it cannot drift while being filled.
 */
export function getSportTerminologyHint(sport: string): string {
  if (!sport) return ''
  return SPORT_TERMINOLOGY[sport.trim()] ?? ''
}
