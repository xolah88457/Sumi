# Synthesizes the 51 s soundtrack for the Sumi ad. The palette is ink and paper: a low breathing
# drone in open fifths (D dorian) that moves with the scenes, sparse plucked-string phrases in
# D minor pentatonic, a brush swish as the intro's ink stroke crosses the screen, wooden ticks and
# paper taps timed to the on-screen clicks and typing, and a singing bowl as the ensō is drawn.
# Writes a 48 kHz stereo 16-bit WAV. Needs numpy.
#   python3 docs/ad/music.py music.wav
import sys
import wave

import numpy as np

SR = 48000
DUR = 51.0
N = int(SR * DUR)
rng = np.random.default_rng(23)

# Must match CLICK_AT in stage.html and the typing in render.mjs.
CLICKS = [15.2, 16.3, 22.0, 22.8, 25.4, 26.35, 29.8, 31.6, 37.05, 37.85, 38.5, 40.05, 40.7]
QUESTION = "Which setups make me the most money?"
TYPE_START, TYPE_STEP = 31.95, 0.055
# The intro's brush stroke, in stage.html: it eases in and out over these seconds.
STROKE = (0.15, 2.05)
ENSO = 47.25


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na) ** 2
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr) ** 1.6
    return e


def onepole_lp(x, cutoff):
    # y[n] = (1-a) x[n] + a y[n-1], done as an IIR via cumulative sums in blocks to stay fast
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    s = 0.0
    blk = max(16, min(2048, int(200 * np.log(10) / -np.log(a))))  # keep a**blk well inside float range
    powers = a ** np.arange(1, blk + 1)
    for i in range(0, len(x), blk):
        seg = x[i : i + blk] * (1 - a)
        k = len(seg)
        p = powers[:k]
        acc = np.cumsum(seg / p) * p
        y[i : i + k] = acc + s * p
        s = y[i + k - 1]
    return y


def bandpass(x, lo, hi):
    return onepole_lp(x, hi) - onepole_lp(x, lo)


L = np.zeros(N)
R = np.zeros(N)


def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    if j <= i:
        return
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    L[i:j] += sig[: j - i] * gain * l * 1.414
    R[i:j] += sig[: j - i] * gain * r * 1.414


# ---------- drone: open fifths that breathe, with a little bowed noise on top
def drone_voice(f, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(2 * np.pi * 2 * f * t + 1.1)
    breath = bandpass(rng.standard_normal(n), f * 0.9, f * 1.6) * 3.2
    swell = 1 + 0.22 * np.sin(2 * np.pi * 0.11 * t + rng.uniform(0, 6.28))
    return (tone + breath) * swell * env(n, 2.2, 2.4)


scenes = [
    (0.0, 4.6, [38, 45, 50]),  # D: intro, the brush stroke
    (4.4, 4.8, [38, 45, 52]),  # D(9): window reveal
    (9.0, 6.0, [41, 48, 55]),  # F(9): dashboard
    (14.8, 6.6, [36, 43, 50]),  # C(9): calendar
    (21.2, 8.0, [34, 41, 48]),  # Bb(9): trade review
    (29.0, 7.2, [43, 50, 57]),  # G(9): ask your journal
    (36.0, 6.4, [41, 48, 57]),  # F(add 3rd): day and night
    (42.2, 5.0, [45, 52, 60]),  # Am: local first
    (47.0, 4.0, [38, 45, 50, 57]),  # D: end card
]
for start, length, notes in scenes:
    for k, m in enumerate(notes):
        add(drone_voice(midi(m), length + 2.2), start, 0.07 if k == 0 else 0.045, pan=(k - 1) * 0.35)


# ---------- plucked string (Karplus-Strong, one period per vectorized step)
def string(f, length=2.6, bright=0.55, bend=0.0):
    n = int(length * SR)
    p = max(2, int(round(SR / f)))
    buf = bandpass(rng.standard_normal(p * 4), 60, 1800 + 5000 * bright)[-p:]
    buf -= buf.mean()  # the loop keeps any DC forever
    out = np.zeros(n + p)
    out[:p] = buf
    decay = 0.996 ** (220 / f)
    for i in range(p, n + p, p):
        prev = out[i - p : i]
        nxt = 0.5 * (prev + np.roll(prev, 1)) * decay
        k = min(p, n + p - i)
        out[i : i + k] = nxt[:k]
    # the loop sounds at SR / (p + 0.5); resample so the note lands in tune
    ratio = f * (p + 0.5) / SR
    y = np.interp(np.arange(n) * ratio, np.arange(n), out[p:], right=0.0)
    if bend:
        # a pressed string: starts a touch flat and settles, like a hand bending it into tune
        t = np.arange(n) / SR
        warp = np.cumsum(1 + bend * np.exp(-t * 9)) - 1
        y = np.interp(np.clip(warp, 0, n - 1), np.arange(n), y)
    return y * env(n, 0.002, 0.3)


# phrases: (time, midi, gain, bend). Sparse, unhurried, D minor pentatonic.
P = [62, 65, 67, 69, 72, 74, 77, 79, 81]
phrases = [
    (5.0, [(0.0, 69, 1), (0.55, 72, 0.8), (1.3, 74, 1), (2.6, 72, 0.6)]),
    (9.6, [(0.0, 74, 1), (0.4, 72, 0.7), (0.8, 69, 0.8), (2.0, 67, 0.9), (3.4, 69, 0.6)]),
    (15.6, [(0.0, 67, 0.9), (0.45, 69, 0.7), (1.2, 72, 1), (2.6, 74, 0.7), (3.1, 77, 0.8), (4.6, 74, 0.5)]),
    (22.4, [(0.0, 65, 0.8), (0.9, 67, 0.7), (1.35, 69, 1), (3.0, 72, 0.8), (4.6, 69, 0.6), (5.2, 67, 0.5)]),
    (30.2, [(0.0, 74, 0.9), (0.5, 79, 0.8), (1.4, 77, 0.8), (3.6, 74, 0.6), (4.4, 72, 0.6)]),
    (42.8, [(0.0, 69, 0.8), (0.6, 72, 0.7), (1.1, 76, 0.8), (2.4, 74, 0.7)]),
]
for start, notes in phrases:
    for j, (dt, m, g) in enumerate(notes):
        bend = -0.035 if j % 3 == 2 else 0.0
        add(string(midi(m), bend=bend), start + dt, 0.11 * g, pan=-0.35 + 0.7 * ((m - 62) / 19))
        if j == 0:
            add(string(midi(m - 12), 3.2, 0.3), start + dt, 0.05 * g, pan=0.0)  # low octave doubles the first note

# light mode: a quick upward strum; back to dark: a low string and the drone settles
for i, m in enumerate([69, 74, 77, 81, 86]):
    add(string(midi(m), 1.8, 0.8), 38.5 + i * 0.045, 0.06, pan=-0.4 + i * 0.2)
add(string(midi(50), 3.4, 0.25), 40.7, 0.12)


# ---------- brush: noise through a band that opens with the stroke's speed
def brush(length, speed, lo, hi, grain=0.0):
    n = int(length * SR)
    noise = rng.standard_normal(n)
    if grain:  # bristles dragging over paper
        noise *= 1 + grain * (onepole_lp(rng.standard_normal(n), 60) * 9) ** 2
    return bandpass(noise, lo, hi) * speed(np.arange(n) / n)


s0, s1 = STROKE
# the stroke eases in and out (cubic), so its speed is a smooth hump; dry tail gets grainier
add(brush(s1 - s0 + 0.35, lambda u: np.sin(np.pi * np.clip(u * 1.15, 0, 1)) ** 1.5, 700, 5200, grain=0.6), s0, 0.1)
add(brush(1.6, lambda u: np.sin(np.pi * u) ** 2, 300, 1800), 3.25, 0.07)  # the window lifts in


# ---------- interface sounds: a wooden tick for clicks, a paper tap for keys
def wood(freq=1150):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * freq * t) * np.exp(-t * 70) + 0.5 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 120)
    knock = bandpass(rng.standard_normal(n), 600, 3500) * np.exp(-t * 400) * 0.8
    return body + knock


def tap():
    n = int(0.035 * SR)
    t = np.arange(n) / SR
    return bandpass(rng.standard_normal(n), 1800, 9000) * np.exp(-t * 260) * 2.2


for tc in CLICKS:
    add(wood(1150 + rng.uniform(-60, 60)), tc, 0.075, pan=rng.uniform(-0.15, 0.15))
for i, ch in enumerate(QUESTION):
    if ch != " ":
        add(tap(), TYPE_START + i * TYPE_STEP, 0.035, pan=rng.uniform(-0.25, 0.25))


# ---------- singing bowl as the ensō is drawn: inharmonic partials in beating pairs, a long ring
def bowl(f, length=6.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for r, a, d in [(1, 1, 0.55), (2.71, 0.55, 0.9), (5.15, 0.28, 1.5), (8.13, 0.12, 2.4)]:
        for beat in (-0.35, 0.35):
            sig += a * np.sin(2 * np.pi * (f * r + beat * r) * t) * np.exp(-t * d)
    return sig * env(n, 0.006, 0.8) / 2


add(bowl(midi(62)), ENSO + 0.2, 0.09)
add(brush(1.25, lambda u: np.sin(np.pi * u) ** 1.2, 900, 4200, grain=0.5), ENSO, 0.12, pan=0.2)


# ---------- room: a darker, longer space than a plain hall
def reverb(x, seed):
    n = int(3.4 * SR)
    t = np.arange(n) / SR
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t * 1.9)
    ir = onepole_lp(ir, 3600)
    ir /= np.sqrt((ir**2).sum())
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]


outL = L * 0.7 + reverb(L, 3) * 0.6
outR = R * 0.7 + reverb(R, 4) * 0.6

fade = np.ones(N)
fi, fo = int(0.15 * SR), int(2.5 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
out = np.stack([outL, outR], 1) * fade[:, None]
out = np.tanh(out * 1.2 / np.abs(out).max())
out *= 10 ** (-1 / 20) / np.abs(out).max()
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("peak", round(float(np.abs(out).max()), 3), "rms dB", round(float(20 * np.log10(np.sqrt((out**2).mean()))), 1))
