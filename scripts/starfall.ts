// Redraws assets/starfall.svg from the public contribution graph: `bun scripts/starfall.ts`.
// GitHub's image proxy blocks fetches from inside an SVG, so the fonts are inlined as data URIs,
// and all motion is CSS keyframes (no JS in <img>).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const GITHUB_USER = "Jordan-Kowal";

const C = {
  surface: "#1d1814",
  line: "#342b22",
  muted: "#a89a8b",
  accent: "#ffc83d",
  onAccent: "#1a1204",
  star: "#ff8a4c",
};

const font = (file: string) =>
  readFileSync(join(ROOT, "fonts", file)).toString("base64");

const FONT_FACE = `@font-face{font-family:Pixelify;font-weight:400;src:url(data:font/woff2;base64,${font("pixel400.woff2")}) format("woff2")}@font-face{font-family:Nunito;font-weight:400;src:url(data:font/woff2;base64,${font("sans400.woff2")}) format("woff2")}`;
const BASE_CSS = `.px{font-family:Pixelify,ui-monospace,monospace}.sans{font-family:Nunito,-apple-system,"Segoe UI",sans-serif}`;

type Day = { row: number; col: number; level: number };

const fetchContributions = async () => {
  const html = await (
    await fetch(`https://github.com/users/${GITHUB_USER}/contributions`)
  ).text();
  const days: Day[] = [];
  for (const [tag] of html.matchAll(/<td[^>]*ContributionCalendar-day[^>]*>/g)) {
    const id = tag.match(/contribution-day-component-(\d+)-(\d+)/);
    const level = tag.match(/data-level="(\d)"/);
    if (id && level)
      days.push({ row: Number(id[1]), col: Number(id[2]), level: Number(level[1]) });
  }
  const total = html.match(/([\d,]+)\s+contributions?\s+in the last year/)?.[1];
  // A changed page layout must fail the run, not commit an empty graph.
  if (days.length < 300 || !total) throw new Error(`Parsed ${days.length} days, total ${total}`);
  return { days, total };
};

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { days, total } = await fetchContributions();
const PITCH = 14;
const CELL = 11;
const X0 = 40;
const Y0 = 64;
const COLS = Math.max(...days.map((day) => day.col)) + 1;
const GRID_END = X0 + COLS * PITCH;
const W = 896;
const H = Y0 + 7 * PITCH + 52;
const LOOP_S = 12;
const START_X = X0 - 26;
// Seeded by the day, so a rerun on the same day draws the same sky and commits nothing.
const random = mulberry32(Math.floor(Date.now() / 86_400_000));
const cellX = (col: number) => X0 + col * PITCH;
const laneY = (row: number) => Y0 + row * PITCH + CELL / 2;
const levels = ["#262019", "#4d3615", "#80581a", "#c48a1c", C.accent];

// Catchers are the busiest days. Fall back to level 2 when the year is quiet.
let catchers = days.filter((day) => day.level >= 3);
if (catchers.length < 12) catchers = days.filter((day) => day.level >= 2);
const catcherReady = new Map<Day, number>();
// A star needs several catches to land, so it crosses a good part of the year first.
const stars = Array.from({ length: 22 }, (_, index) => ({
  index,
  row: Math.floor(random() * 7),
  spawn: random() * 5.5,
  speed: 105 + random() * 45,
  weight: 2 + Math.floor(random() * 6),
  end: 0,
  endX: 0,
  isCaught: false,
}));
type Catch = { star: (typeof stars)[number]; catcher: Day; time: number };
const candidates: Catch[] = [];
for (const star of stars)
  for (const catcher of catchers)
    if (Math.abs(catcher.row - star.row) <= 1)
      candidates.push({
        star,
        catcher,
        time: star.spawn + (cellX(catcher.col) + CELL / 2 - START_X) / star.speed,
      });
candidates.sort((first, second) => first.time - second.time);
const pulls: Catch[] = [];
const left = new Map(stars.map((star) => [star, star.weight]));
for (const pull of candidates) {
  const remaining = left.get(pull.star) ?? 0;
  if (remaining <= 0 || (catcherReady.get(pull.catcher) ?? 0) > pull.time) continue;
  pulls.push(pull);
  catcherReady.set(pull.catcher, pull.time + 0.7);
  const strength = pull.catcher.level === 4 ? 2 : 1;
  left.set(pull.star, remaining - strength);
  if (remaining - strength <= 0) {
    pull.star.isCaught = true;
    pull.star.end = pull.time;
    pull.star.endX = START_X + (pull.time - pull.star.spawn) * pull.star.speed;
  }
}
for (const star of stars)
  if (!star.isCaught) {
    star.endX = GRID_END + 30;
    star.end = star.spawn + (star.endX - START_X) / star.speed;
  }
const pct = (seconds: number) => ((seconds / LOOP_S) * 100).toFixed(3);
const css: string[] = [];
const shapes: string[] = [];

for (const star of stars) {
  const y = laneY(star.row);
  const at = (x: number) => `transform:translate(${x.toFixed(1)}px,${y}px)`;
  css.push(
    `@keyframes m${star.index}{0%{opacity:0;${at(START_X)}}${pct(star.spawn)}%{opacity:0;${at(START_X)}}${pct(star.spawn + 0.01)}%{opacity:1;${at(START_X)}}${pct(star.end)}%{opacity:1;${at(star.endX)}}${pct(star.end + 0.05)}%{opacity:0;${at(star.endX)}}100%{opacity:0;${at(star.endX)}}}.m${star.index}{animation:m${star.index} ${LOOP_S}s linear infinite}`,
  );
  shapes.push(`<use href="#star" class="m${star.index} anim"/>`);
  if (!star.isCaught) continue;
  const cx = star.endX;
  css.push(
    `@keyframes c${star.index}{0%,${pct(star.end)}%{opacity:0;transform:translateY(0)}${pct(star.end + 0.02)}%{opacity:1;transform:translateY(0)}${pct(star.end + 0.8)}%{opacity:0;transform:translateY(-16px)}100%{opacity:0}}.c${star.index}{animation:c${star.index} ${LOOP_S}s ease-out infinite}`,
    `@keyframes r${star.index}{0%,${pct(star.end)}%{opacity:0;transform:scale(.2)}${pct(star.end + 0.02)}%{opacity:1;transform:scale(.4)}${pct(star.end + 0.45)}%{opacity:0;transform:scale(1.7)}100%{opacity:0}}.r${star.index}{animation:r${star.index} ${LOOP_S}s ease-out infinite;transform-origin:${cx}px ${y}px}`,
  );
  shapes.push(
    `<circle class="r${star.index} anim" cx="${cx}" cy="${y}" r="9" fill="none" stroke="${C.accent}" stroke-width="2" opacity="0"/>`,
    `<text class="px c${star.index} anim" x="${cx}" y="${y - 8}" font-size="11" fill="${C.accent}" text-anchor="middle" opacity="0">+1</text>`,
  );
}
// Each catch draws a short beam from the catcher to the star as it passes.
pulls.forEach((pull, index) => {
  const tx = cellX(pull.catcher.col) + CELL / 2;
  const ty = laneY(pull.catcher.row);
  const sx = START_X + (pull.time - pull.star.spawn) * pull.star.speed;
  const sy = laneY(pull.star.row);
  css.push(
    `@keyframes b${index}{0%,${pct(pull.time - 0.01)}%{opacity:0}${pct(pull.time)}%{opacity:.9}${pct(pull.time + 0.22)}%{opacity:0}100%{opacity:0}}.b${index}{animation:b${index} ${LOOP_S}s linear infinite}`,
  );
  shapes.push(
    `<line class="b${index} anim" x1="${tx}" y1="${ty}" x2="${sx}" y2="${sy}" stroke="${pull.catcher.level === 4 ? "#fff3c4" : C.accent}" stroke-width="${pull.catcher.level === 4 ? 2.5 : 1.5}" stroke-linecap="round" opacity="0"/>`,
  );
});

const grid = days
  .map((day) => {
    const fill = levels[day.level];
    const cell = `<rect x="${cellX(day.col)}" y="${Y0 + day.row * PITCH}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}"/>`;
    if (!catchers.includes(day)) return cell;
    const halo =
      day.level === 4
        ? `<rect class="halo" x="${cellX(day.col) - 2}" y="${Y0 + day.row * PITCH - 2}" width="${CELL + 4}" height="${CELL + 4}" rx="4" fill="none" stroke="${C.accent}" stroke-width="1.2"/>`
        : "";
    return `${halo}${cell}<rect x="${cellX(day.col) + 4}" y="${Y0 + day.row * PITCH + 4}" width="3" height="3" fill="${C.onAccent}"/>`;
  })
  .join("");
const style = `${FONT_FACE}${BASE_CSS}
.halo{animation:halo 1.6s ease-in-out infinite}
@keyframes halo{50%{opacity:.2}}
.twinkle{animation:twinkle .5s steps(2) infinite}
@keyframes twinkle{50%{opacity:.55}}
${css.join("\n")}
@media (prefers-reduced-motion: reduce){.anim{display:none}.halo,.twinkle{animation:none}}`;
const body = `
<defs>
  <linearGradient id="trail" x1="0" x2="1">
    <stop offset="0" stop-color="${C.star}" stop-opacity="0"/>
    <stop offset="1" stop-color="${C.star}" stop-opacity="0.7"/>
  </linearGradient>
  <g id="star">
    <rect x="-26" y="-1" width="24" height="2" fill="url(#trail)"/>
    <g class="twinkle">
      <rect x="-1" y="-5" width="2" height="10" fill="#fff3c4"/>
      <rect x="-5" y="-1" width="10" height="2" fill="#fff3c4"/>
      <rect x="-2" y="-2" width="4" height="4" fill="${C.accent}"/>
    </g>
  </g>
</defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="18" fill="${C.surface}" stroke="${C.line}" stroke-width="2"/>
<text class="px" x="${X0}" y="40" font-size="18" letter-spacing="3" fill="${C.accent}">STARFALL</text>
<text class="sans" x="${X0 + 122}" y="39" font-size="13" fill="${C.muted}">${total} contributions in the last year · the busiest days catch shooting stars</text>
${grid}
${shapes.join("")}
<text class="sans" x="${X0}" y="${H - 18}" font-size="12" fill="${C.muted}">Less</text>
${levels.map((fill, i) => `<rect x="${X0 + 32 + i * 15}" y="${H - 28}" width="11" height="11" rx="2.5" fill="${fill}"/>`).join("")}
<text class="sans" x="${X0 + 112}" y="${H - 18}" font-size="12" fill="${C.muted}">More · marked days are catchers, glowing ones pull twice as hard</text>`;
writeFileSync(
  join(ROOT, "assets", "starfall.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${style}</style>${body}</svg>`,
);
console.log({ days: days.length, catchers: catchers.length, total });
