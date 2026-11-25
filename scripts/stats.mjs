// Renders the profile README cards (almanac, commit hours, the year, pet) from
// the GitHub GraphQL API, in rudnam.com's quiet look: ivory paper, espresso ink,
// a muted bronze accent, PT Serif, and one idea per card.
// Usage: GITHUB_TOKEN=... node scripts/stats.mjs [outDir]
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
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
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
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23", weekday: "short",
});
function local(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
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
    calendar: cc.contributionCalendar.weeks.map((w) => w.contributionDays),
    commits,
  };
}

// ---------- shared ----------

// The site's palette (src/styles/global.css in rudnam-site).
const THEMES = {
  light: { paper: "#fbf9f4", hair: "#e3ddd1", ink: "#211e1a", body: "#47423b", muted: "#7c7468", faint: "#a69e90", accent: "#8a7154" },
  dark:  { paper: "#161412", hair: "#2a2622", ink: "#f2eee7", body: "#d2cabc", muted: "#a69e90", faint: "#766f64", accent: "#c4ad8c" },
};
const SERIF = `'PT Serif', Georgia, 'Times New Roman', serif`;
const W = 480, H = 220, PAD = 32;

// PT Serif (OFL, see fonts/OFL.txt), subset to ASCII and embedded:
// SVGs shown as images can't load external fonts.
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const FONT_FACES = (await Promise.all([["normal", "400"], ["italic", "400i"]].map(async ([style, file]) => {
  const b64 = (await readFile(join(FONT_DIR, `ptserif-${file}.woff2`))).toString("base64");
  return `@font-face{font-family:'PT Serif';font-weight:400;font-style:${style};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}))).join("");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Every card has the same bones: a small-caps label, an italic aside, one large
// line (the headline) with an italic note under it, and one quiet graphic below.
const HEAD_Y = 96, NOTE_Y = 118;

function card(t, title, eyebrow, aside, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>
${FONT_FACES}
text{font-family:${SERIF};fill:${t.ink};font-variant-numeric:lining-nums tabular-nums}
.b{fill:${t.body}}.m{fill:${t.muted}}.f{fill:${t.faint}}.a{fill:${t.accent}}.i{font-style:italic}
.sc{font-size:9.5px;letter-spacing:.16em;fill:${t.muted}}
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="3" fill="${t.paper}" stroke="${t.hair}"/>
<text x="${PAD}" y="44" class="sc">${esc(eyebrow.toUpperCase())}</text>
<text x="${W - PAD}" y="44" font-size="11.5" class="m i" text-anchor="end">${esc(aside)}</text>
${body}
</svg>`;
}

const headline = (text, size = 26) => `<text x="${PAD - 1}" y="${HEAD_Y}" font-size="${size}">${text}</text>`;
const note = (text) => `<text x="${PAD}" y="${NOTE_Y}" font-size="12.5" class="m i">${esc(text)}</text>`;

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

// en-GB puts the day first ("25 November"); en-US keeps "Sep" short.
const dateFmt = (opts, locale = "en-GB") => new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });

function languageLine(commits, lead = "Mostly") {
  const langs = new Map();
  for (const c of commits) langs.set(c.lang, (langs.get(c.lang) ?? 0) + 1);
  const top = [...langs].sort((a, b) => b[1] - a[1]).map(([l]) => l).filter((l) => l !== "Other").slice(0, 3);
  if (!top.length) return "";
  return `${lead} ${top[0]}${top.length > 1 ? `, then ${top.slice(1).join(" and ")}` : ""}`;
}

// ---------- almanac (coding weather) ----------

// Line icons on a 24-unit grid (Feather, MIT).
const ICONS = {
  clear: `<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  drizzle: `<path d="M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>`,
  rain: `<path d="M16 13v8M8 13v8M12 15v8M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>`,
  storm: `<path d="M19 16.9A5 5 0 0 0 18 7h-1.3a8 8 0 1 0-11.6 9"/><path d="M13 11l-4 6h6l-4 6"/>`,
};

function icon(kind, x, y, size, color, width = 1) {
  const s = size / 24;
  return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${s})" fill="none" stroke="${color}" stroke-width="${width / s}" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</g>`;
}

function condition(count) {
  if (count === 0) return ["clear", "Clear skies"];
  if (count <= 3) return ["drizzle", "Light drizzle"];
  if (count <= 9) return ["rain", "Steady rain"];
  return ["storm", "Thunderstorms"];
}

function almanac(t, data) {
  const { commits } = data;
  const byDay = countByDay(commits);
  const week = lastDays(7).reverse();
  const last24 = commits.filter((c) => c.date >= now - DAY).length;
  const activeDays28 = lastDays(28).filter((d) => byDay.has(d.day)).length;
  const chance = Math.round((activeDays28 / 28) * 100);
  const dateLabel = dateFmt({ weekday: "long", day: "numeric", month: "long" }).format(now);
  const [kind, label] = condition(last24);

  // The week as a quiet row of numbers; today in bronze.
  const colW = (W - 2 * PAD) / 7;
  const days = week.map((d, i) => {
    const x = PAD + colW * i + colW / 2;
    const n = byDay.get(d.day) ?? 0;
    const today = i === week.length - 1;
    return `<text x="${x}" y="164" text-anchor="middle" class="sc"${today ? ` style="fill:${t.accent}"` : ""}>${today ? "TODAY" : d.weekday.toUpperCase()}</text>
<text x="${x}" y="186" text-anchor="middle" font-size="14" class="${today ? "a" : n ? "b" : "f"}">${n}</text>`;
  }).join("\n");

  const body = `
${headline(label)}
${note(`${plural(last24, "commit")} in the last day, ${chance}% chance tomorrow`)}
${icon(kind, W - PAD - 16, 88, 32, t.accent)}
${days}`;

  return card(t, `${USER}'s coding almanac`, "Coding almanac", `${dateLabel} · ${PLACE}`, body);
}

// ---------- commit hours ----------

function chronotype(byHour, total) {
  const share = (from, to) => {
    let n = 0;
    for (let h = from; h !== to; h = (h + 1) % 24) n += byHour[h];
    return n / total;
  };
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (share(22, 4) >= 0.35) return ["Night owl", `${pct(share(22, 4))} of commits after 22:00`];
  if (share(5, 9) >= 0.25) return ["Early bird", `${pct(share(5, 9))} of commits before 09:00`];
  if (share(9, 18) >= 0.6) return ["Nine-to-fiver", `${pct(share(9, 18))} of commits in office hours`];
  if (share(18, 22) >= 0.35) return ["Evening coder", `${pct(share(18, 22))} of commits from 18:00 to 22:00`];
  return ["Round the clock", "no hour of the day dominates"];
}

function hours(t, data) {
  const { commits } = data;
  const byHour = Array(24).fill(0);
  for (const c of commits) byHour[c.hour]++;
  const total = commits.length;
  const max = Math.max(1, ...byHour);
  const peak = byHour.indexOf(Math.max(...byHour));
  const [type, why] = total ? chronotype(byHour, total) : ["Hibernating", "no commits in the last year"];

  // One strip of hairline bars across the day.
  const base = 178, tall = 34;
  const step = (W - 2 * PAD) / 24;
  const nowH = local(now).hour;
  const bars = byHour.map((n, h) => {
    const x = PAD + step * h + step / 2;
    if (!n) return `<circle cx="${x.toFixed(1)}" cy="${base - 1}" r="0.9" fill="${t.faint}"/>`;
    const hgt = Math.max(2, (n / max) * tall);
    return `<rect x="${(x - 1.25).toFixed(1)}" y="${(base - hgt).toFixed(1)}" width="2.5" height="${hgt.toFixed(1)}" fill="${t.accent}"/>`;
  }).join("");
  const nowX = PAD + step * nowH + step / 2;
  const labels = [[0, "midnight"], [6, "6 am"], [12, "noon"], [18, "6 pm"]].map(([h, l]) =>
    `<text x="${(PAD + step * h + step / 2).toFixed(1)}" y="${base + 18}" font-size="10.5" class="f i" text-anchor="${h ? "middle" : "start"}"${h ? "" : ` dx="-1.5"`}>${l}</text>`).join("");

  const body = `
${headline(esc(type))}
${note(`${cap(why)}, busiest around ${String(peak).padStart(2, "0")}:00`)}
${bars}
<circle cx="${nowX.toFixed(1)}" cy="${base + 5}" r="1.6" fill="${t.ink}"/>
${labels}`;

  return card(t, `When ${USER} commits`, "Hours", `Last twelve months · ${PLACE}`, body);
}

// ---------- the year ----------

function year(t, data) {
  const weeks = data.calendar.slice(-53);
  const totals = weeks.map((w) => w.reduce((s, d) => s + d.contributionCount, 0));
  const activeDays = weeks.flat().filter((d) => d.contributionCount).length;
  const max = Math.max(1, ...totals);

  // Weekly totals as one thin line with a faint wash beneath it.
  const top = 142, base = 182;
  const step = (W - 2 * PAD) / (totals.length - 1);
  const pts = totals.map((n, i) => [PAD + i * step, base - (n / max) * (base - top)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const [lx, ly] = pts.at(-1);

  const first = weeks[0][0].date;
  const fmt = (d) => dateFmt({ month: "short", year: "numeric", timeZone: "UTC" }, "en-US").format(new Date(`${d}T00:00:00Z`));

  const body = `
${headline(`${data.yearTotal.toLocaleString("en-US")} contributions`)}
${note(`On ${activeDays} days of the last year`)}
<line x1="${PAD}" x2="${W - PAD}" y1="${base}" y2="${base}" stroke="${t.hair}"/>
<path d="${line}L${W - PAD} ${base}L${PAD} ${base}Z" fill="${t.accent}" fill-opacity=".08"/>
<path d="${line}" fill="none" stroke="${t.accent}" stroke-width="1.2" stroke-linejoin="round"/>
<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2" fill="${t.accent}"/>
<text x="${PAD}" y="${base + 18}" font-size="10.5" class="f i">${fmt(first)}</text>
<text x="${W - PAD}" y="${base + 18}" font-size="10.5" class="f i" text-anchor="end">now</text>`;

  return card(t, `${USER}'s year of contributions`, "The year", languageLine(data.commits), body);
}

// ---------- pet ----------

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
  if (daysSince < 7) return { mood: "hungry", line: "Hungry, a commit would help" };
  return { mood: "sleeping", line: "Asleep until the next commit" };
}

function pet(t, data) {
  const { commits } = data;
  const last = commits[0]?.date;
  const daysSince = last ? (now - last) / DAY : Infinity;
  const { mood, line } = petState(daysSince);
  const weekSnacks = commits.filter((c) => c.date >= now - 7 * DAY).length;
  const level = Math.max(1, Math.floor(Math.sqrt(data.yearTotal)));

  // A small ink stamp straight on the paper: espresso outline, bronze wash.
  const tone = { o: [t.ink, 0.8], k: [t.ink, 0.8], b: [t.accent, 0.16], n: [t.accent, 0.7], f: [t.accent, 0.5], w: [t.paper, 1], t: [t.paper, 1] };
  const frame = (over) => SPRITE.base.map((r, i) => over?.[i] ?? r);
  const PX = 4, S = 16 * PX;
  // `solid` backs each pixel with the paper so a frame can cover the one beneath it.
  const draw = (rows, solid = false) => rows.flatMap((row, y) => [...row].map((ch, x) => {
    if (ch === ".") return "";
    const [fill, op] = tone[ch];
    const at = `x="${x * PX}" y="${y * PX}" width="${PX - 0.4}" height="${PX - 0.4}"`;
    return `${solid ? `<rect ${at} fill="${t.paper}"/>` : ""}<rect ${at} fill="${fill}" fill-opacity="${op}"/>`;
  })).join("");
  const sprite = mood === "sleeping"
    ? draw(frame(SPRITE.closed))
    : `${draw(frame(mood === "hungry" ? SPRITE.hungry : null))}<g class="blink">${draw(frame(SPRITE.closed), true)}</g>`;

  const hrs = Math.floor(daysSince * 24);
  const ago = !last ? "never" : hrs < 1 ? "just now" : daysSince < 1 ? `${hrs} hours ago` : `${Math.floor(daysSince)} days ago`;

  const body = `
${headline(esc(cap(PET_NAME)))}
${note(line)}
<g transform="translate(${W - PAD - S} 68)">${sprite}</g>
<text x="${PAD}" y="164" class="sc">LAST FED</text>
<text x="${PAD}" y="186" font-size="14" class="b">${cap(ago)}</text>
<text x="${PAD + 130}" y="164" class="sc">THIS WEEK</text>
<text x="${PAD + 130}" y="186" font-size="14" class="b">${plural(weekSnacks, "commit")}</text>
<text x="${PAD + 260}" y="164" class="sc">LEVEL</text>
<text x="${PAD + 260}" y="186" font-size="14" class="b">${level}</text>`;

  return card(t, `${PET_NAME}, ${USER}'s commit-fed pet`, "Companion", "Feeds on commits",
    body + `<style>.blink{opacity:0;animation:blink 6s steps(1) infinite}@keyframes blink{0%,95%{opacity:0}96%,98%{opacity:1}}</style>`);
}

// ---------- main ----------

const data = await collect();
await mkdir(OUT, { recursive: true });
for (const [name, render] of Object.entries({ almanac, hours, year, pet })) {
  for (const [mode, theme] of Object.entries(THEMES)) {
    await writeFile(join(OUT, `${name}-${mode}.svg`), render(theme, data));
  }
}
console.log(`${data.commits.length} commits, ${data.yearTotal} contributions -> ${OUT}/`);
