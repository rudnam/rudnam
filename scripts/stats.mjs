// Renders the profile README cards (coding weather, pixel pet, commit clock)
// from the GitHub GraphQL API. Usage: GITHUB_TOKEN=... node scripts/stats.mjs [outDir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = "rudnam";
const TZ = "Asia/Tokyo";
const PLACE = "Nagoya"; // shown on the cards; TZ only sets the clock
const PET_NAME = "gopher";
const OUT = process.argv[2] ?? "dist";

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

const DAY = 86_400_000;
const now = new Date();

// ---------- data ----------

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data;
}

async function fetchProfile() {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        id createdAt
        contributionsCollection {
          contributionCalendar { totalContributions }
          restrictedContributionsCount
        }
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false,
                     orderBy: { field: PUSHED_AT, direction: DESC }) {
          nodes { name pushedAt primaryLanguage { name } }
        }
      }
    }`,
    { login: USER },
  );
  return user;
}

async function fetchCommits(repo, authorId, since) {
  const commits = [];
  let after = null;
  do {
    const { repository } = await gql(
      `query($owner: String!, $name: String!, $author: ID!, $since: GitTimestamp!, $after: String) {
        repository(owner: $owner, name: $name) {
          defaultBranchRef { target { ... on Commit {
            history(first: 100, after: $after, since: $since, author: { id: $author }) {
              pageInfo { hasNextPage endCursor }
              nodes { committedDate }
            }
          } } }
        }
      }`,
      { owner: USER, name: repo, author: authorId, since: since.toISOString(), after },
    );
    const history = repository.defaultBranchRef?.target?.history;
    if (!history) break;
    commits.push(...history.nodes.map((n) => new Date(n.committedDate)));
    after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
  } while (after);
  return commits;
}

// Local-time parts of a date in TZ.
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
});
function local(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}

const LANGUAGE_NAMES = { HCL: "Terraform" };

async function collect() {
  const profile = await fetchProfile();
  const since = new Date(now - 365 * DAY);
  const repos = profile.repositories.nodes.filter((r) => new Date(r.pushedAt) >= since);

  const commits = [];
  for (const repo of repos) {
    const lang = repo.primaryLanguage?.name;
    for (const date of await fetchCommits(repo.name, profile.id, since)) {
      commits.push({ date, repo: repo.name, lang: LANGUAGE_NAMES[lang] ?? lang ?? "Other", ...local(date) });
    }
  }
  commits.sort((a, b) => b.date - a.date);

  const cc = profile.contributionsCollection;
  return {
    createdAt: new Date(profile.createdAt),
    yearTotal: cc.contributionCalendar.totalContributions,
    yearPrivate: cc.restrictedContributionsCount,
    commits,
  };
}

// ---------- shared ----------

const THEMES = {
  light: { bg: "#ffffff", border: "#d1d9e0", text: "#1f2328", muted: "#59636e", faint: "#818b98",
           hair: "#e8ecf0", panel: "#f6f8fa", accent: "#8250df" },
  dark:  { bg: "#0d1117", border: "#3d444d", text: "#f0f6fc", muted: "#9198a1", faint: "#656c76",
           hair: "#21262d", panel: "#151b23", accent: "#a371f7" },
};
const SANS = `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`;
const W = 480, H = 244, PAD = 24;

// Inter (OFL, see fonts/OFL.txt), subset to ASCII and embedded: SVGs shown as
// images can't load external fonts.
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const FONT_FACES = (await Promise.all([300, 400, 500, 600].map(async (w) => {
  const b64 = (await readFile(join(FONT_DIR, `inter-${w}.woff2`))).toString("base64");
  return `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}))).join("");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function card(t, title, eyebrow, aside, body, style = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
${FONT_FACES}
text{font-family:${SANS};fill:${t.text};font-variant-numeric:tabular-nums}
.m{fill:${t.muted}}.f{fill:${t.faint}}.mono{font-family:${MONO}}
.eb{font-size:10px;font-weight:600;letter-spacing:.09em;fill:${t.muted}}
${style}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
<text x="${PAD}" y="36" class="eb">${esc(eyebrow.toUpperCase())}</text>
<text x="${W - PAD}" y="36" font-size="11" class="f" text-anchor="end">${esc(aside)}</text>
${body}
</svg>`;
}

const hairline = (t, y, x1 = PAD, x2 = W - PAD) => `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${t.hair}"/>`;

// Uppercase label over a value.
const stat = (x, y, label, value, size = 15) =>
  `<text x="${x}" y="${y}" class="eb">${esc(label.toUpperCase())}</text><text x="${x}" y="${y + size + 7}" font-size="${size}">${value}</text>`;

// Calendar days (YYYY-MM-DD in TZ) going back from today, newest first.
function lastDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now - i * DAY);
    return { ...local(d), date: d };
  });
}

function countByDay(commits) {
  const m = new Map();
  for (const c of commits) m.set(c.day, (m.get(c.day) ?? 0) + 1);
  return m;
}

function streak(byDay) {
  const days = lastDays(400);
  // Today without commits yet doesn't break the streak.
  let i = byDay.has(days[0].day) ? 0 : 1;
  let n = 0;
  while (i < days.length && byDay.has(days[i].day)) { n++; i++; }
  return n;
}

// ---------- weather ----------

// Line icons on a 24-unit grid (Feather, MIT).
const ICONS = {
  clear: `<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  drizzle: `<path d="M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>`,
  rain: `<path d="M16 13v8M8 13v8M12 15v8M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>`,
  storm: `<path d="M19 16.9A5 5 0 0 0 18 7h-1.3a8 8 0 1 0-11.6 9"/><path d="M13 11l-4 6h6l-4 6"/>`,
};

function icon(kind, x, y, size, color, width = 1.5) {
  const s = size / 24;
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${s})" fill="none" stroke="${color}" stroke-width="${width / s}" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</g>`;
}

function condition(count) {
  if (count === 0) return ["clear", "Clear skies"];
  if (count <= 3) return ["drizzle", "Light drizzle"];
  if (count <= 9) return ["rain", "Steady rain"];
  return ["storm", "Thunderstorms"];
}

function intensity(share) {
  if (share >= 0.6) return "heavy";
  if (share >= 0.3) return "steady";
  if (share >= 0.1) return "scattered";
  return "light";
}

function weather(t, data) {
  const { commits } = data;
  const byDay = countByDay(commits);
  const week = lastDays(7).reverse();
  const weekCommits = commits.filter((c) => c.date >= now - 7 * DAY);
  const last24 = commits.filter((c) => c.date >= now - DAY).length;

  const langs = new Map();
  for (const c of weekCommits) langs.set(c.lang, (langs.get(c.lang) ?? 0) + 1);
  const top = [...langs].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const summary = top.length
    ? top.map(([lang, n], i) => `${i ? intensity(n / weekCommits.length) : cap(intensity(n / weekCommits.length))} ${lang}`).join(", ")
    : "Calm week, nothing in the air";

  const activeDays28 = lastDays(28).filter((d) => byDay.has(d.day)).length;
  const chance = Math.round((activeDays28 / 28) * 100);
  const privatePct = data.yearTotal ? Math.round((data.yearPrivate / data.yearTotal) * 100) : 0;
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(now);

  const [kind, label] = condition(last24);
  const numW = String(last24).length * 26;

  const colW = (W - 2 * PAD) / 7;
  const days = week.map((d, i) => {
    const x = PAD + colW * i + colW / 2;
    const n = byDay.get(d.day) ?? 0;
    const today = i === week.length - 1;
    return `<text x="${x}" y="142" text-anchor="middle" class="eb"${today ? ` style="fill:${t.text}"` : ""}>${today ? "TODAY" : d.weekday.toUpperCase()}</text>
${icon(condition(n)[0], x, 164, 18, n ? (today ? t.accent : t.text) : t.faint)}
<text x="${x}" y="194" text-anchor="middle" font-size="12"${n ? "" : ` class="f"`}>${n}</text>`;
  }).join("\n");

  const body = `
<text x="${PAD - 2}" y="96" font-size="48" font-weight="300" letter-spacing="-1.5">${last24}</text>
<text x="${PAD + numW + 12}" y="74" font-size="15" font-weight="500">${label}</text>
<text x="${PAD + numW + 12}" y="94" font-size="12" class="m">commits in the last 24 hours  ·  ${chance}% chance tomorrow</text>
${icon(kind, W - PAD - 18, 76, 36, t.accent, 1.4)}
${hairline(t, 118)}
${days}
${hairline(t, 210)}
<text x="${PAD}" y="229" font-size="11" class="m">${esc(summary)}</text>
<text x="${W - PAD}" y="229" font-size="11" class="m" text-anchor="end">${streak(byDay)}-day streak  ·  ${privatePct}% private</text>`;

  return card(t, `${USER}'s coding forecast`, "Coding forecast", `${dateLabel} · ${PLACE}`, body);
}

// ---------- commit clock ----------

function chronotype(byHour, total) {
  const share = (from, to) => {
    let n = 0;
    for (let h = from; h !== to; h = (h + 1) % 24) n += byHour[h];
    return n / total;
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (share(22, 4) >= 0.35) return ["Night owl", `${pct(share(22, 4))} of commits between 22:00 and 04:00`];
  if (share(5, 9) >= 0.25) return ["Early bird", `${pct(share(5, 9))} of commits before 09:00`];
  if (share(9, 18) >= 0.6) return ["Nine-to-fiver", `${pct(share(9, 18))} of commits in office hours`];
  if (share(18, 22) >= 0.35) return ["Evening coder", `${pct(share(18, 22))} of commits between 18:00 and 22:00`];
  return ["Round the clock", "No single time of day dominates"];
}

function clock(t, data) {
  const { commits } = data;
  const byHour = Array(24).fill(0);
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const byWeekday = Object.fromEntries(WEEKDAYS.map((d) => [d, 0]));
  for (const c of commits) { byHour[c.hour]++; byWeekday[c.weekday]++; }
  const total = commits.length;
  const max = Math.max(1, ...byHour);
  const peak = byHour.indexOf(Math.max(...byHour));
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const [type, why] = total ? chronotype(byHour, total) : ["Hibernating", "No commits in the last year"];

  const cx = 118, cy = 142, r0 = 22, r1 = 76;
  const pt = (r, a) => `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  const ang = (h) => (h / 24) * 2 * Math.PI - Math.PI / 2;
  const gap = 0.035;
  const wedges = byHour.map((n, h) => {
    if (!n) return "";
    const a0 = ang(h - 0.5) + gap, a1 = ang(h + 0.5) - gap;
    const r = r0 + 3 + (n / max) * (r1 - r0 - 3);
    return `<path d="M${pt(r0 + 3, a0)} L${pt(r, a0)} A${r} ${r} 0 0 1 ${pt(r, a1)} L${pt(r0 + 3, a1)} A${r0 + 3} ${r0 + 3} 0 0 0 ${pt(r0 + 3, a0)}Z" fill="${t.accent}" fill-opacity="${(0.25 + 0.75 * (n / max)).toFixed(2)}"/>`;
  }).join("");
  const rings = [r0, (r0 + r1) / 2, r1].map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.hair}"/>`).join("");
  const ticks = [0, 6, 12, 18].map((h) => {
    const [x, y] = pt(r1 + 13, ang(h)).split(" ").map(Number);
    return `<text x="${x}" y="${y + 3.5}" font-size="9" class="f mono" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
  }).join("");
  const nowA = ang(local(now).hour + new Date().getMinutes() / 60);
  const [hx, hy] = pt(r1, nowA).split(" ");
  const hand = `<circle cx="${hx}" cy="${hy}" r="5" fill="${t.bg}"/><circle class="pulse" cx="${hx}" cy="${hy}" r="3" fill="${t.text}"/>`;

  const X = 236;
  const wmax = Math.max(1, ...Object.values(byWeekday));
  const bw = (W - PAD - X) / 7;
  const week = WEEKDAYS.map((d, i) => {
    const h = Math.max(2, (byWeekday[d] / wmax) * 26);
    const x = X + i * bw;
    return `<rect x="${x}" y="${214 - h}" width="${bw - 8}" height="${h}" rx="1.5" fill="${t.accent}" fill-opacity="${(0.25 + 0.75 * (byWeekday[d] / wmax)).toFixed(2)}"/>
<text x="${x + (bw - 8) / 2}" y="229" font-size="9" class="f" text-anchor="middle">${d[0]}</text>`;
  }).join("");

  const body = `
${rings}${wedges}${ticks}${hand}
<text x="${X}" y="76" font-size="22" font-weight="500" letter-spacing="-.3">${esc(type)}</text>
<text x="${X}" y="96" font-size="12" class="m">${esc(why)}</text>
${stat(X, 128, "Peak hour", hh(peak))}
${stat(X + 112, 128, "Commits", total)}`
+ `\n${week}`;

  return card(t, `When ${USER} commits`, "Commit clock", `Last 12 months · ${PLACE}`, body,
    `.pulse{animation:pulse 2.4s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}`);
}

// ---------- pixel pet ----------

// 16x16 sprite. o outline, b body, w eye white, k pupil, n nose, t tooth, f paws.
const SPRITE = {
  base: [
    "..oo........oo..",
    ".obboooooooobbo.",
    ".obbbbbbbbbbbbo.",
    "obbwwwbbbbwwwbbo",
    "obwwwwwbbwwwwwbo",
    "obwwkkwbbwwkkwbo",
    "obwwkkwbbwwkkwbo",
    "obbwwwbnnbwwwbbo",
    "obbbbbnnnnbbbbbo",
    "obbbbbbttbbbbbbo",
    "obffbbbbbbbbffbo",
    "obbbbbbbbbbbbbbo",
    "obbbbbbbbbbbbbbo",
    ".obbbbbbbbbbbbo.",
    "..oooooooooooo..",
    "...ff......ff...",
  ],
  // Rows replaced per frame.
  closed: { 3: "obbbbbbbbbbbbbbo", 4: "obbbbbbbbbbbbbbo", 5: "obbooobbbbooobbo", 6: "obbbbbbbbbbbbbbo", 7: "obbbbbbnnbbbbbbo" },
  hungry: { 5: "obwwwwwbbwwwwwbo", 6: "obwwkkwbbwwkkwbo", 7: "obbwkkbnnbkkwbbo" },
};

function petState(daysSince) {
  if (daysSince < 1) return { mood: "happy", line: "Well fed and in high spirits" };
  if (daysSince < 3) return { mood: "content", line: "Full, and a little sleepy" };
  if (daysSince < 7) return { mood: "hungry", line: "Hungry. A commit would help" };
  return { mood: "sleeping", line: "Hibernating until the next commit" };
}

function pet(t, data) {
  const { commits } = data;
  const last = commits[0]?.date;
  const daysSince = last ? (now - last) / DAY : Infinity;
  const { mood, line } = petState(daysSince);
  const weekSnacks = commits.filter((c) => c.date >= now - 7 * DAY).length;
  const level = Math.max(1, Math.floor(Math.sqrt(data.yearTotal)));
  const ageYears = Math.floor((now - data.createdAt) / (365.25 * DAY));
  const fullness = Math.max(0, Math.min(5, Math.round(5 - daysSince)));

  // Two-tone LCD: ink for outlines, a light wash of ink for the body.
  const ink = t.text;
  const tone = { o: [ink, 0.9], k: [ink, 0.9], b: [ink, 0.1], n: [ink, 0.4], f: [ink, 0.4], w: [t.panel, 1], t: [t.panel, 1] };
  const frame = (over) => SPRITE.base.map((r, i) => over?.[i] ?? r);
  const PX = 7, S = 16 * PX;
  const LCD = { x: PAD, y: 54, w: 164, h: 166 };
  const ox = LCD.x + (LCD.w - S) / 2, oy = LCD.y + 22;
  // `solid` backs each pixel with the panel colour so a frame can cover the one beneath it.
  const draw = (rows, solid = false) => rows.flatMap((row, y) => [...row].map((ch, x) => {
    if (ch === ".") return "";
    const [fill, op] = tone[ch];
    const at = `x="${x * PX}" y="${y * PX}" width="${PX - 0.5}" height="${PX - 0.5}"`;
    return `${solid ? `<rect ${at} fill="${t.panel}"/>` : ""}<rect ${at} fill="${fill}" fill-opacity="${op}"/>`;
  })).join("");
  // Asleep: eyes stay closed. Awake: an open frame with a closed one flashed over it to blink.
  const sprite = mood === "sleeping"
    ? draw(frame(SPRITE.closed))
    : `${draw(frame(mood === "hungry" ? SPRITE.hungry : null))}<g class="blink">${draw(frame(SPRITE.closed), true)}</g>`;
  const extra = mood === "sleeping"
    ? ["z", "z", "Z"].map((z, i) => `<text class="zzz mono" style="animation-delay:${i * 0.8}s" x="${S - 6 + i * 8}" y="${10 - i * 9}" font-size="${9 + i * 2}">${z}</text>`).join("")
    : "";

  const hours = Math.floor(daysSince * 24);
  const ago = !last ? "Never" : hours < 1 ? "Just now" : daysSince < 1 ? `${hours}h ago` : `${Math.floor(daysSince)}d ago`;
  const X = 216;
  const segW = 36;
  const meter = [...Array(5)].map((_, i) =>
    `<rect x="${X + i * (segW + 4)}" y="148" width="${segW}" height="4" rx="2" fill="${i < fullness ? t.accent : t.hair}"/>`).join("");

  const body = `
<rect x="${LCD.x}" y="${LCD.y}" width="${LCD.w}" height="${LCD.h}" rx="8" fill="${t.panel}" stroke="${t.hair}"/>
<g transform="translate(${ox} ${oy})"><g class="${mood === "sleeping" ? "breathe slow" : "breathe"}">${sprite}</g>${extra}</g>
<text x="${X}" y="76" font-size="22" font-weight="500" letter-spacing="-.3">${esc(PET_NAME[0].toUpperCase() + PET_NAME.slice(1))}</text>
<text x="${X}" y="96" font-size="12" class="m">Level ${level}  ·  ${ageYears} years old</text>
<text x="${X}" y="134" class="eb">FULLNESS</text>
${meter}
<text x="${X}" y="174" font-size="12" class="m">${esc(line)}</text>
${hairline(t, 190, X)}
${stat(X, 208, "Last fed", ago, 13)}
${stat(X + 112, 208, "This week", plural(weekSnacks, "commit"), 13)}`;

  const style = `.breathe{animation:breathe 2.4s steps(1) infinite}.slow{animation-duration:4.8s}
@keyframes breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(${PX / 7}px)}}
.blink{opacity:0;animation:blink 6s steps(1) infinite}@keyframes blink{0%,95%{opacity:0}96%,98%{opacity:1}}
.zzz{fill:${t.muted};opacity:0;animation:zzz 2.4s ease-out infinite}@keyframes zzz{0%{opacity:0}30%{opacity:1}100%{opacity:0;translate:3px -8px}}`;
  return card(t, `${PET_NAME}, ${USER}'s commit-fed pet`, "Companion", "Feeds on commits", body, style);
}

// ---------- main ----------

const data = await collect();
await mkdir(OUT, { recursive: true });
for (const [name, render] of Object.entries({ weather, pet, clock })) {
  for (const [mode, theme] of Object.entries(THEMES)) {
    await writeFile(join(OUT, `${name}-${mode}.svg`), render(theme, data));
  }
}
console.log(`${data.commits.length} commits, ${data.yearTotal} contributions -> ${OUT}/`);
