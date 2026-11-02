// 프로필 README용 대시보드 카드(SVG) 생성 — GitHub Actions에서 매일 실행
// 외부 카드 서비스 없이 GitHub API 공개 데이터만 사용합니다.
import { writeFileSync, mkdirSync } from 'node:fs';

const USER = process.env.GH_USER || 'donghoim';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || 'assets';
const TZ_OFFSET = 9; // Asia/Seoul

const C = { dark: '#2C3E50', accent: '#1ABC9C', sub: '#7F8C8D', line: '#E5E8EB', bg: '#FFFFFF' };
const FONT = "'Segoe UI','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";

const headers = { 'User-Agent': USER, Accept: 'application/vnd.github+json', ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }) };

async function rest(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return { data: await res.json(), link: res.headers.get('link') || '' };
}

async function restAll(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const { data, link } = await rest(`${path}${sep}per_page=100&page=${page}`);
    out.push(...data);
    if (!link.includes('rel="next"')) return out;
  }
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers, body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n.toLocaleString('en-US');

function card(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="${C.bg}" stroke="${C.line}"/>
  <text x="24" y="38" font-size="17" font-weight="700" fill="${C.dark}">${esc(title)}</text>
  <rect x="24" y="48" width="28" height="3" rx="1.5" fill="${C.accent}"/>
${body}
</svg>
`;
}

// 1. 활동 요약
function statsCard(s) {
  const rows = [
    ['공개 저장소', s.repos],
    ['총 커밋', s.commits],
    [`${s.year}년 기여`, s.contributions],
    ['커밋한 날', s.days],
    ['최근 커밋', s.last],
  ];
  const body = rows.map(([label, value], i) => {
    const y = 84 + i * 28;
    return `  <circle cx="30" cy="${y - 5}" r="4" fill="${C.accent}"/>
  <text x="44" y="${y}" font-size="14" fill="${C.dark}">${esc(label)}</text>
  <text x="${400 - 24}" y="${y}" font-size="14" font-weight="700" fill="${C.dark}" text-anchor="end">${typeof value === 'number' ? fmt(value) : esc(value)}</text>`;
  }).join('\n');
  return card(400, 230, 'GitHub 활동 요약', body);
}

// 2. 사용 언어 (공개 저장소 코드량 기준)
function langCard(langs) {
  const total = langs.reduce((a, l) => a + l.bytes, 0) || 1;
  const palette = [C.dark, C.accent, '#2980B9', '#E67E22', '#95A5A6'];
  const barW = 400 - 48;
  let x = 24;
  const bar = langs.map((l, i) => {
    const w = Math.max(2, (l.bytes / total) * barW);
    const r = `  <rect x="${x.toFixed(1)}" y="70" width="${w.toFixed(1)}" height="10" fill="${palette[i]}"/>`;
    x += w;
    return r;
  }).join('\n');
  const legend = langs.map((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 24 + col * 180, ly = 112 + row * 28;
    return `  <circle cx="${lx + 5}" cy="${ly - 5}" r="5" fill="${palette[i]}"/>
  <text x="${lx + 16}" y="${ly}" font-size="14" fill="${C.dark}">${esc(l.name)} <tspan fill="${C.sub}">${((l.bytes / total) * 100).toFixed(1)}%</tspan></text>`;
  }).join('\n');
  return card(400, 230, '사용 언어', `  <clipPath id="b"><rect x="24" y="70" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#b)">
${bar}
  </g>
${legend}`);
}

// 3. 커밋 시간대 (productive-box 방식)
function timeCard(slots) {
  const total = slots.reduce((a, s) => a + s.count, 0) || 1;
  const top = slots.reduce((a, s) => (s.count > a.count ? s : a));
  const barX = 210, barW = 820 - 24 - barX - 190;
  const body = slots.map((s, i) => {
    const y = 90 + i * 30;
    const pct = s.count / total;
    return `  <text x="24" y="${y}" font-size="14" fill="${C.dark}">${esc(s.label)}</text>
  <text x="120" y="${y}" font-size="13" fill="${C.sub}">${esc(s.range)}</text>
  <rect x="${barX}" y="${y - 11}" width="${barW}" height="12" rx="6" fill="${C.line}"/>
  <rect x="${barX}" y="${y - 11}" width="${Math.max(pct > 0 ? 6 : 0, pct * barW).toFixed(1)}" height="12" rx="6" fill="${s === top ? C.accent : C.dark}"/>
  <text x="${820 - 24}" y="${y}" font-size="14" fill="${C.dark}" text-anchor="end"><tspan font-weight="700">${fmt(s.count)}</tspan> <tspan fill="${C.sub}">commits · ${(pct * 100).toFixed(1)}%</tspan></text>`;
  }).join('\n');
  return card(820, 220, `커밋 시간대 — 주로 ${top.label.split(' ')[1]}에 작업합니다`, body);
}

async function main() {
  const year = new Date().getUTCFullYear();
  const repos = (await restAll(`/users/${USER}/repos?type=owner`)).filter((r) => !r.fork);

  const { user } = await graphql(
    `query($login:String!){ user(login:$login){
       contributionsCollection{ totalCommitContributions totalPullRequestContributions totalIssueContributions totalRepositoryContributions } } }`,
    { login: USER },
  );
  const cc = user.contributionsCollection;

  const langBytes = {};
  const hours = new Array(24).fill(0);
  let commits = 0, last = 0;
  const days = new Set();
  for (const r of repos) {
    const { data: langs } = await rest(`/repos/${r.full_name}/languages`);
    for (const [k, v] of Object.entries(langs)) langBytes[k] = (langBytes[k] || 0) + v;
    if (r.size === 0) continue;
    const list = await restAll(`/repos/${r.full_name}/commits?author=${USER}`);
    commits += list.length;
    for (const c of list) {
      const d = new Date(c.commit.author.date);
      const kst = new Date(d.getTime() + TZ_OFFSET * 3600e3);
      hours[kst.getUTCHours()]++;
      days.add(kst.toISOString().slice(0, 10));
      last = Math.max(last, kst.getTime());
    }
  }

  const sorted = Object.entries(langBytes).sort((a, b) => b[1] - a[1]);
  const langs = sorted.slice(0, 4).map(([name, bytes]) => ({ name, bytes }));
  const rest_ = sorted.slice(4).reduce((a, [, b]) => a + b, 0);
  if (rest_ > 0) langs.push({ name: '기타', bytes: rest_ });

  const sum = (a, b) => hours.slice(a, b).reduce((x, y) => x + y, 0);
  const slots = [
    { label: '🌞 아침', range: '06–12시', count: sum(6, 12) },
    { label: '🌆 오후', range: '12–18시', count: sum(12, 18) },
    { label: '🌃 저녁', range: '18–24시', count: sum(18, 24) },
    { label: '🌙 새벽', range: '00–06시', count: sum(0, 6) },
  ];

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/stats.svg`, statsCard({
    repos: repos.length,
    commits,
    year,
    contributions: cc.totalCommitContributions + cc.totalPullRequestContributions + cc.totalIssueContributions + cc.totalRepositoryContributions,
    days: days.size,
    last: last ? new Date(last).toISOString().slice(0, 10).replace(/-/g, '.') : '-',
  }));
  writeFileSync(`${OUT}/languages.svg`, langCard(langs));
  writeFileSync(`${OUT}/commit-time.svg`, timeCard(slots));
  console.log({ repos: repos.length, commits, langs: langs.map((l) => l.name), slots: slots.map((s) => s.count) });
}

main().catch((e) => { console.error(e); process.exit(1); });
