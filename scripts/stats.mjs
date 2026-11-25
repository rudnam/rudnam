// Renders the profile README cards (now building, commit hours, the year) from
// the GitHub GraphQL API, in rudnam.com's quiet look: ivory paper, espresso ink,
// a muted bronze accent, PT Serif, and one idea per card.
// Usage: GITHUB_TOKEN=... node scripts/stats.mjs [outDir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER = "rudnam";
const TZ = "Asia/Tokyo";
const PLACE = "Nagoya"; // shown on the cards; TZ only sets the clock
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
          nodes { name description isPrivate pushedAt primaryLanguage { name } }
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
              nodes { committedDate messageHeadline }
            }
          } } }
        }
      }`,
      { owner: USER, name: repo, author: authorId, since: since.toISOString(), after },
    );
    const history = repository.defaultBranchRef?.target?.history;
    if (!history) break;
    commits.push(...history.nodes.map((n) => ({ date: new Date(n.committedDate), message: n.messageHeadline })));
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
    for (const { date, message } of await fetchCommits(repo.name, profile.id, since)) {
      commits.push({ date, message, repo: repo.name, lang: LANGUAGE_NAMES[lang] ?? lang ?? "Other", ...local(date) });
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
    repos: profile.repositories.nodes,
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

// en-GB puts the day first ("25 November"); en-US keeps "Sep" short.
const dateFmt = (opts, locale = "en-GB") => new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });

function languageLine(commits, lead = "Mostly") {
  const langs = new Map();
  for (const c of commits) langs.set(c.lang, (langs.get(c.lang) ?? 0) + 1);
  const top = [...langs].sort((a, b) => b[1] - a[1]).map(([l]) => l).filter((l) => l !== "Other").slice(0, 3);
  if (!top.length) return "";
  return `${lead} ${top[0]}${top.length > 1 ? `, then ${top.slice(1).join(" and ")}` : ""}`;
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

// ---------- now building ----------

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// The project with the most commits this week, and the days it was touched.
function nowBuilding(t, data) {
  const week = data.commits.filter((c) => c.date >= now - 7 * DAY);
  const byRepo = new Map();
  for (const c of week) byRepo.set(c.repo, (byRepo.get(c.repo) ?? 0) + 1);
  const [repo, n] = [...byRepo].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const info = data.repos.find((r) => r.name === repo);
  // Commit messages only from public repos; a private one shows just its name.
  const latest = week.find((c) => c.repo === repo)?.message;
  const line = !repo ? "A quiet week, nothing in progress"
    : info?.description ? info.description
    : !info?.isPrivate && latest ? `Latest: ${latest}`
    : `${plural(n, "commit")} this week`;

  const days = lastDays(7).reverse();
  const touched = new Set(week.filter((c) => c.repo === repo).map((c) => c.day));
  const colW = (W - 2 * PAD) / 7;
  const dots = days.map((d, i) => {
    const x = PAD + colW * i + colW / 2;
    const on = touched.has(d.day);
    return `<circle cx="${x}" cy="168" r="3.5" fill="${on ? t.accent : "none"}" stroke="${on ? t.accent : t.faint}"/>
<text x="${x}" y="190" text-anchor="middle" class="sc"${i === 6 ? ` style="fill:${t.accent}"` : ""}>${i === 6 ? "TODAY" : d.weekday.toUpperCase()}</text>`;
  }).join("");

  const body = `
${headline(esc(repo ?? "Resting"))}
${note(trunc(line, 58))}
${dots}`;
  return card(t, `What ${USER} is building`, "Now building", repo ? `${plural(n, "commit")} this week` : "", body);
}

// ---------- main ----------

const data = await collect();
await mkdir(OUT, { recursive: true });
for (const [name, render] of Object.entries({ building: nowBuilding, hours, year })) {
  for (const [mode, theme] of Object.entries(THEMES)) {
    await writeFile(join(OUT, `${name}-${mode}.svg`), render(theme, data));
  }
}
console.log(`${data.commits.length} commits, ${data.yearTotal} contributions -> ${OUT}/`);
