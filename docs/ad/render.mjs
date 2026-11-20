// Renders the Sumi ad frame by frame. stage.html holds the live app in an iframe and draws everything
// around it (backdrop, camera, words, cursor). App time runs on Playwright's fake clock, so frames are
// exactly 1/FPS apart however long a screenshot takes. The cursor is a real mouse: hovers, tooltips,
// menus and clicks all happen in the app itself.
//
//   node docs/ad/render.mjs <outDir> [--url http://127.0.0.1:4310] [--preview 9.5,17.5,25]
//
// Without --url it builds nothing: it starts the production server from apps/web (run
// `pnpm --filter web build` first) on a free port with an empty temp data dir and loads demo data.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const FPS = 30;
const DURATION = 51;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const out = path.resolve(
  args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "frames",
);
const preview = flag("--preview")?.split(",").map(Number) ?? null;
const stage = fs.readFileSync(path.join(here, "stage.html"), "utf8");
const fontDir = path.join(root, "apps/web/src/app/fonts");

// ---------- server
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let server = null;
let dataDir = null;
function cleanup() {
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

async function startServer() {
  const port = await freePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sumi-ad-"));
  const web = path.join(root, "apps/web");
  server = spawn(
    path.join(web, "node_modules/.bin/next"),
    ["start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: web,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        NODE_ENV: "production",
        JOURNAL_DATA_DIR: dataDir,
        JOURNAL_PASSWORD: "",
      },
    },
  );
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const demo = await fetch(`${url}/api/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!demo.ok) throw new Error(`demo data: ${demo.status}`);
  return url;
}

// ---------- what happens in the app. Clicks must match CLICKS in stage.html.
const appCss = `
  * { cursor: none !important; }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
  nextjs-portal { display: none !important; }`;

const QUESTION = "Which setups make me the most money?";

(async () => {
  const base = flag("--url") ?? (await startServer());
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem("journal-theme-v1"))
        localStorage.setItem("journal-theme-v1", "dark");
    } catch {}
  });
  await page.clock.install();
  await page.route(`${base}/__stage`, (r) => r.fulfill({ contentType: "text/html", body: stage }));
  await page.route(`${base}/__stage/font/*`, (r) =>
    r.fulfill({
      contentType: "font/woff2",
      body: fs.readFileSync(path.join(fontDir, path.basename(new URL(r.request().url()).pathname))),
    }),
  );
  await page.goto(`${base}/__stage`);
  const frame = await (await page.waitForSelector("#app")).contentFrame();
  await frame.waitForSelector("nav a", { state: "attached" });
  await frame.addStyleTag({ content: appCss });
  await page.evaluate(() => document.fonts.ready);
  await frame.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500); // let the dashboard's data land and charts finish their first draw
  await page.clock.pauseAt(Date.now() + 1000);

  const clicks = await page.evaluate(() => window.__clickAt);
  const actions = clicks.map(([t, target]) => [t, "click", target]);
  [...QUESTION].forEach((ch, i) => actions.push([31.95 + i * 0.055, "type", ch]));
  actions.sort((a, b) => a[0] - b[0]);

  let mouseOn = false;
  async function syncMouse() {
    const c = await page.evaluate(() => window.__cursor());
    if (c) {
      await page.mouse.move(c.x, c.y);
      mouseOn = true;
    } else if (mouseOn) {
      await page.mouse.move(1910, 6); // park on the backdrop so hovers end
      mouseOn = false;
    }
  }

  let last = 0;
  const advance = async (t) => {
    const ms = Math.round(t * 1000) - last;
    if (ms > 0) {
      // step in small slices so fetches that resolve meanwhile get rendered in order
      for (let left = ms; left > 0; left -= 50) await page.clock.runFor(Math.min(50, left));
      last += ms;
    }
  };

  const total = Math.round(DURATION * FPS);
  const times = preview ?? Array.from({ length: total }, (_, i) => i / FPS);
  let next = 0;
  let n = 0;
  for (const t of times) {
    while (next < actions.length && actions[next][0] <= t) {
      const [at, kind, arg] = actions[next++];
      await advance(at);
      await page.evaluate((x) => window.__render(x), at);
      await syncMouse();
      if (kind === "click") {
        // the app fetches in real time while its clock is paused: wait for the target to be there
        for (let i = 0; !(await page.evaluate((n) => window.__live(n), arg)); i++) {
          if (i > 100)
            throw new Error(`click at ${at}: ${arg} never appeared (app at ${frame.url()})`);
          await page.waitForTimeout(100);
        }
        await page.evaluate((x) => window.__render(x), at);
        await syncMouse();
        if (process.env.DEBUG) {
          const c = await page.evaluate(() => window.__cursor());
          const hit =
            c &&
            (await page.evaluate(
              ([x, y]) => {
                const f = document.querySelector("#app");
                const r = f.getBoundingClientRect();
                const el = document.elementFromPoint(x, y);
                return el?.id + " / " + (el === f ? "iframe" : el?.tagName);
              },
              [c.x, c.y],
            ));
          console.log("click", at, arg, JSON.stringify(c), hit, frame.url());
        }
        await page.mouse.down();
        await page.clock.runFor(60);
        await page.mouse.up();
        last += 60;
      } else if (kind === "type") await page.keyboard.type(arg);
    }
    await advance(t);
    await page.evaluate((x) => window.__render(x), t);
    await syncMouse();
    await page.evaluate((x) => window.__render(x), t); // hovers can move layout; draw again
    const name = preview ? `p-${t.toFixed(2)}.jpg` : `${String(n).padStart(5, "0")}.jpg`;
    await page.screenshot({ path: path.join(out, name), type: "jpeg", quality: 93 });
    n++;
    if (!preview && n % 150 === 0) console.log(`${n}/${total}`);
  }
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
