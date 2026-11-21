# Sumi ad

The ad in the README (`.github/assets/sumi-ad.mp4`) is rendered from the real app, frame by frame. Nothing in the window is mocked: the dashboard, calendar, trade review, Ask your journal and the theme switch are the production build running on demo data.

| File         | What it does                                                                                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage.html` | A 1920x1080 stage. The app sits in an iframe inside a window frame; around it are the backdrop, camera moves, headlines, cursor and click ripples. `window.__render(t)` draws the stage at time `t`. The camera and cursor follow live elements in the app, not fixed pixels. |
| `render.mjs` | Starts the production server on a free port with a throwaway data dir and demo data, opens the stage in Playwright and steps a fake clock 1/30 s per frame. A real mouse follows the drawn cursor, so hovers, tooltips, menus and clicks happen in the app itself.            |
| `music.py`   | Synthesizes the soundtrack with numpy: a breathing open-fifth drone per scene, sparse plucked-string phrases, a brush swish under the intro's ink stroke, wooden ticks and paper taps on the on-screen clicks and keys, and a singing bowl when the ensō is drawn.            |

## Render

```sh
pnpm --filter web build
node docs/ad/render.mjs /tmp/sumi-ad/frames          # about 1,530 JPEG frames
python3 docs/ad/music.py /tmp/sumi-ad/music.wav
ffmpeg -framerate 30 -i /tmp/sumi-ad/frames/%05d.jpg -i /tmp/sumi-ad/music.wav \
  -c:v libx264 -preset slow -crf 19 -tune animation -pix_fmt yuv420p \
  -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 192k -shortest -movflags +faststart \
  .github/assets/sumi-ad.mp4
ffmpeg -ss 49.5 -i .github/assets/sumi-ad.mp4 -frames:v 1 -q:v 3 .github/assets/sumi-ad-poster.jpg
```

To check a few moments without rendering everything, pass `--preview 9.5,18,25.5`. To reuse a server that is already running, pass `--url http://127.0.0.1:4310`.

Click times live in `CLICK_AT` in `stage.html`; `music.py` repeats them so the click sounds land on the frame. If a click target never appears (a route or label changed), the render stops and names it.
