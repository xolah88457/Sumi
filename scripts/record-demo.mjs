#!/usr/bin/env node
/**
 * Records the animated product showcase used by the README and release pages.
 *
 *   pnpm demo:record            build the app, record, encode
 *   pnpm demo:record --skip-build   reuse an existing apps/web/.next build
 *
 * What it does
 *   1. Builds the web app (`pnpm build`, a production build) and starts it with
 *      `next start` on a free port. The server gets a throwaway JOURNAL_DATA_DIR
 *      (the same variable the desktop app uses for its profile), so the repo's
 *      own data/ directory is never read or written. The directory is deleted
 *      and the server killed on every exit path.
 *   2. Loads the demo journal through the real `POST /api/demo` route, which is
 *      what the "Load demo data" button calls.
 *   3. Drives a scripted tour in headless Chromium at 1440x900 with Playwright's
 *      recordVideo. Headless recordings have no pointer, so a fake cursor
 *      overlay (with a click ripple) is injected and the mouse is moved in
 *      eased steps so hover states and tooltips really fire.
 *   4. Encodes with ffmpeg: .github/assets/demo.mp4 (H.264), demo.gif and
 *      demo-poster.png.
 *
 * Needs: Node >= 22, pnpm, Playwright (resolved from the global install or the
 * workspace) with a Chromium, and ffmpeg on PATH (or set FFMPEG).
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = fileURLToPath(new URL("..", import.meta.url));
const webDir = join(root, "apps/web");
const assets = join(root, ".github/assets");
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const skipBuild = process.argv.includes("--skip-build");
const GIF_MAX_BYTES = 8_000_000;
const W = 1440;
const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed (${r.status})`);
};

const size = (file) => statSync(file).size;
const mb = (bytes) => (bytes / 1048576).toFixed(2) + " MB";

/* ------------------------------------------------------------------ server */

let server;
let dataDir;
const cleanup = () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL"); // whole process group
    } catch {}
    server = undefined;
  }
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

async function startServer() {
  if (!skipBuild) run("pnpm", ["build"], { cwd: root });
  dataDir = mkdtempSync(join(tmpdir(), "sumi-demo-"));
  const port = await freePort();
  server = spawn(join(webDir, "node_modules/.bin/next"), ["start", "-p", String(port)], {
    cwd: webDir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      JOURNAL_DATA_DIR: dataDir,
      JOURNAL_PASSWORD: "",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return base;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Server not ready on ${base}:\n${log}`);
}

/* ------------------------------------------------------------------ cursor */

const CURSOR_SCRIPT = `(() => {
  if (window.__fakeCursor) return;
  window.__fakeCursor = true;
  const css = document.createElement("style");
  css.textContent = \`
    #__cur{position:fixed;left:0;top:0;width:28px;height:28px;margin:-3px 0 0 -3px;z-index:2147483647;
      pointer-events:none;transition:transform 45ms linear;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));will-change:transform}
    #__cur svg{display:block;transition:transform 120ms ease-out;transform-origin:3px 3px}
    #__cur.down svg{transform:scale(.82)}
    .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
      border:2px solid rgba(110,160,255,.95);background:rgba(110,160,255,.28);animation:__rip 520ms ease-out forwards}
    @keyframes __rip{to{transform:scale(3.6);opacity:0}}
  \`;
  const mount = () => {
    document.head.appendChild(css);
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 3 L3 22 L8.2 17.4 L11.8 25 L15.2 23.5 L11.7 16 L18.6 15.6 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    let x = Number(sessionStorage.getItem("__cx") ?? 760), y = Number(sessionStorage.getItem("__cy") ?? 460);
    const place = () => (c.style.transform = "translate(" + x + "px," + y + "px)");
    place();
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; place(); try { sessionStorage.setItem("__cx", x); sessionStorage.setItem("__cy", y); } catch {} }, true);
    addEventListener("mousedown", (e) => {
      c.classList.add("down");
      const r = document.createElement("div"); r.className = "__rip";
      r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);
})();`;

/* ------------------------------------------------------------------ driver */

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function makeDriver(page) {
  let cx = 760;
  let cy = 460;
  const moveTo = async (x, y, ms = 800) => {
    const steps = Math.max(8, Math.round(ms / 16));
    const [sx, sy] = [cx, cy];
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
      const wait = t0 + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
    [cx, cy] = [x, y];
  };
  const center = async (loc) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error("Target has no box");
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  return {
    pause: sleep,
    moveTo,
    /** Glide over a locator and rest on it (hover). */
    async hover(loc, ms = 800, dx = 0, dy = 0) {
      const [x, y] = await center(loc.first());
      await moveTo(x + dx, y + dy, ms);
    },
    /** Glide to a locator, press with a ripple and release. */
    async click(loc, ms = 800) {
      const [x, y] = await center(loc.first());
      await moveTo(x, y, ms);
      await sleep(120);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
    },
    /** Smooth wheel scroll of `dy` px over `ms`. */
    async scroll(dy, ms = 900) {
      const steps = Math.round(ms / 16);
      let sent = 0;
      for (let i = 1; i <= steps; i++) {
        const target = Math.round(dy * ease(i / steps));
        await page.mouse.wheel(0, target - sent);
        sent = target;
        await sleep(16);
      }
    },
    /** Drag across a horizontal span (e.g. scrub a chart). */
    async sweep(x1, x2, y, ms = 1400) {
      await moveTo(x1, y, 600);
      await moveTo(x2, y, ms);
    },
    pos: () => [cx, cy],
  };
}

const settle = async (page, selector) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  if (selector) await page.waitForSelector(selector, { timeout: 20000 });
};

/* -------------------------------------------------------------------- tour */

async function tour(page, d, base, mark) {
  const nav = (name) => page.locator("aside, nav").getByRole("link", { name, exact: true });

  /* 1. Dashboard: charts animate in, hover cards and the P&L chart, then day/night */
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await settle(page, "text=Edge Score");
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await sleep(500);
  mark(); // everything before this is trimmed from the video
  await sleep(1300); // let the charts finish animating
  await d.hover(page.getByText("Net P&L", { exact: true }).first(), 700, 0, 40);
  await sleep(300);
  const cumulative = page.getByText("Daily net cumulative P&L").first();
  const cb = await cumulative.boundingBox();
  if (cb) await d.sweep(cb.x + 40, cb.x + cb.width - 40, cb.y + 150, 1500);
  await sleep(200);

  /* Day / night: use the real appearance menu in the sidebar */
  const appearance = page.getByRole("button", { name: /^Appearance/ }).first();
  const pick = async (name) => {
    await d.click(appearance, 700);
    await d.click(page.getByRole("menuitem", { name }), 400);
  };
  await pick("Light");
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await sleep(1800);
  await pick("Dark");
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await sleep(300);
  await d.scroll(520, 800);
  await sleep(500);

  /* 2. Calendar: day tooltip, then insights */
  await d.click(nav("Calendar"), 700);
  await settle(page, ".journal-calendar-day[data-performance]");
  await sleep(500);
  const days = page
    .locator("a.journal-calendar-day[data-performance]")
    .filter({ hasText: /\d+ trades?/ });
  const n = await days.count();
  await d.hover(days.nth(Math.min(3, n - 1)), 600);
  await sleep(1200);
  await d.hover(days.nth(Math.min(6, n - 1)), 500);
  await sleep(1000);
  await d.scroll(620, 900);
  await sleep(1200);

  /* 3. Trades: sort, open a trade */
  await d.click(nav("Trades"), 700);
  await settle(page, "tbody tr");
  await sleep(400);
  await d.click(page.getByRole("button", { name: /Net P&L/ }), 600);
  await sleep(500);
  await d.click(page.getByRole("button", { name: /Net P&L/ }), 300);
  await sleep(700);
  // Open the first trade that has enough fills to draw a running P&L chart.
  for (let i = 0; i < 8; i++) {
    await d.click(page.locator("tbody tr").nth(i), i ? 400 : 600);
    await page.waitForURL(/\/trades\/[^/?]+/);
    const ok = await page
      .getByText("Running P&L", { exact: true })
      .waitFor({ timeout: 2500 })
      .then(
        () => true,
        () => false,
      );
    if (ok) break;
    await page.goBack();
    await settle(page, "tbody tr");
  }
  await settle(page, "text=Running P&L");
  await sleep(700);
  await d.scroll(560, 900);
  await sleep(400);
  const chart = page.getByText("Running P&L", { exact: true }).first();
  const rb = await chart.boundingBox();
  if (rb) await d.sweep(rb.x + 60, rb.x + 620, rb.y + 150, 1500);
  await sleep(500);

  /* 4. Daily journal */
  await d.click(nav("Daily journal"), 700);
  await settle(page, "text=Days in this view");
  await sleep(600);
  await d.click(page.locator('a[href^="/journal/20"]').nth(2), 700);
  await settle(page, "text=Day note");
  await sleep(1500);

  /* 5. Reports */
  await d.click(nav("Reports"), 700);
  await settle(page, "text=Trade time performance");
  await sleep(900);
  await d.scroll(430, 800);
  await sleep(600);
  await d.scroll(-430, 600);
  await d.click(page.getByText("Breakdowns", { exact: true }), 600);
  await page.getByText("Group by").first().waitFor({ timeout: 15000 });
  await d.moveTo(900, 640, 1000); // small drift so the clip doesn't end on the click
  await sleep(1300);
}

/* --------------------------------------------------------------- encoding */

function encode(webm, trimSeconds) {
  mkdirSync(assets, { recursive: true });
  const mp4 = join(assets, "demo.mp4");
  const gif = join(assets, "demo.gif");
  const poster = join(assets, "demo-poster.png");
  const ss = ["-ss", trimSeconds.toFixed(2)];
  const quiet = ["-hide_banner", "-loglevel", "error", "-y"];

  run(ffmpeg, [
    ...quiet,
    ...ss,
    "-i",
    webm,
    "-vf",
    `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "26",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ]);

  // GIF: keep it under 8,000,000 bytes by stepping down in size/frame rate if needed.
  const attempts = [
    [960, 14],
    [960, 12],
    [880, 12],
    [800, 12],
    [800, 10],
    [720, 10],
  ];
  for (const [width, fps] of attempts) {
    const filter =
      `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];` +
      `[a]palettegen=max_colors=128:stats_mode=diff[p];` +
      `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    run(ffmpeg, [...quiet, "-i", mp4, "-filter_complex", filter, "-loop", "0", gif]);
    console.log(`  gif ${width}px @ ${fps}fps -> ${size(gif)} bytes`);
    if (size(gif) <= GIF_MAX_BYTES) break;
  }

  // Poster: the dashboard once the charts have settled.
  run(ffmpeg, [...quiet, "-ss", "2.8", "-i", mp4, "-frames:v", "1", poster]);
  return { mp4, gif, poster };
}

function duration(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  return parseFloat(r.stdout);
}

/* -------------------------------------------------------------------- main */

async function main() {
  const base = await startServer();
  console.log(`Sumi running at ${base} with throwaway data in ${dataDir}`);

  const res = await fetch(`${base}/api/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Loading demo data failed: ${res.status} ${await res.text()}`);
  console.log("Demo data loaded:", await res.text());

  const videoDir = mkdtempSync(join(tmpdir(), "sumi-demo-video-"));
  const browser = await chromium.launch();
  let webm;
  let trim = 0;
  try {
    const t0 = Date.now();
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      recordVideo: { dir: videoDir, size: { width: W, height: H } },
    });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("journal-theme-v1", "dark");
        localStorage.setItem("sumi-demo", "1");
      } catch {}
    });
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    // Fail loudly rather than record an error overlay.
    page.on("pageerror", (e) => console.warn("  page error:", e.message));
    const d = makeDriver(page);
    await tour(page, d, base, () => (trim = (Date.now() - t0) / 1000));
    await sleep(300);
    await page.close();
    webm = await page.video().path();
    await context.close();
  } finally {
    await browser.close();
    if (!webm) rmSync(videoDir, { recursive: true, force: true });
  }

  const out = encode(webm, trim);
  rmSync(videoDir, { recursive: true, force: true });
  console.log(`\nmp4    ${mb(size(out.mp4))}  ${duration(out.mp4).toFixed(1)} s  ${out.mp4}`);
  console.log(`gif    ${mb(size(out.gif))}  ${duration(out.gif).toFixed(1)} s  ${out.gif}`);
  console.log(`poster ${mb(size(out.poster))}  ${out.poster}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
