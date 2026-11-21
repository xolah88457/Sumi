# Synthesizes the 51 s soundtrack for the Sumi ad: a solo piano theme over soft strings, in D major.
# The harmony changes with the scenes, the left hand rolls a pedalled arpeggio, the right hand carries
# the melody, and the strings grow from almost nothing to a full swell as the ensō is drawn. Quiet
# interface sounds (a brush under the intro's ink stroke, clicks, key taps) stay in sync with the
# picture. Writes a 48 kHz stereo 16-bit WAV. Needs numpy.
#   python3 docs/ad/music.py music.wav
import sys
import wave

import numpy as np

SR = 48000
DUR = 51.0
N = int(SR * DUR)
rng = np.random.default_rng(5)

# Must match CLICK_AT in stage.html and the typing in render.mjs.
CLICKS = [15.2, 16.3, 22.0, 22.8, 25.4, 26.35, 29.8, 31.6, 37.05, 37.85, 38.5, 40.05, 40.7]
QUESTION = "Which setups make me the most money?"
TYPE_START, TYPE_STEP = 31.95, 0.055
STROKE = (0.15, 2.05)  # the intro's brush stroke
ENSO = 47.25  # the ensō starts drawing on the end card
EIGHTH = 0.4  # 75 bpm


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


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
    i = int(round(start * SR))
    if i < 0:  # starts before the track: keep only the part that falls inside it
        sig, i = sig[-i:], 0
    j = min(N, i + len(sig))
    if j <= i:
        return
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    L[i:j] += sig[: j - i] * gain * l * 1.414
    R[i:j] += sig[: j - i] * gain * r * 1.414


# ---------- piano: stretched partials, two detuned strings, two-stage decay, a felt hammer
_cache = {}


def piano(m, hold, vel):
    key = (m, round(hold, 2), round(vel, 2))
    if key in _cache:
        return _cache[key]
    f0 = midi(m)
    ring = min(hold + 0.35, 7.5)
    n = int(ring * SR)
    t = np.arange(n) / SR
    B = 0.00012 * (f0 / 262) ** 0.7  # inharmonicity: upper partials run sharp, more so up high
    tau = 2.6 * (262 / f0) ** 0.55 + 0.6  # seconds; low notes ring longer
    bright = 0.55 + 0.45 * vel
    sig = np.zeros(n)
    for k in range(1, 18):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        if fk > 12000:
            break
        amp = k**-1.15 * np.exp(-(k - 1) * (1.15 - bright) * 0.55)
        if k == 1:
            amp *= 0.85
        rate = (1 + 0.32 * (k - 1)) / tau
        decay = 0.62 * np.exp(-t * rate * 3.2) + 0.38 * np.exp(-t * rate * 0.7)
        for cents in (-0.9, 0.9):
            sig += amp * decay * np.sin(2 * np.pi * fk * 2 ** (cents / 1200) * t + rng.uniform(0, 6.28))
    hn = int(0.03 * SR)
    hammer = bandpass(rng.standard_normal(hn), 300, 1500 + 3500 * vel) * np.exp(-np.arange(hn) / SR * 160)
    sig[:hn] += hammer * 0.5 * vel
    env = np.ones(n)
    a = int(0.003 * SR)
    env[:a] = np.linspace(0, 1, a)
    damp = int(hold * SR)
    if damp < n:  # the damper falls: a quick but not instant fade
        env[damp:] *= np.exp(-np.arange(n - damp) / SR * 14)
    out = sig * env * (0.35 + 0.65 * vel) / 3
    _cache[key] = out
    return out


def play(m, at, hold, vel, pan=None):
    if pan is None:
        pan = np.clip((m - 60) / 40, -0.45, 0.45)  # low notes left, high notes right, like sitting at the keys
    add(piano(m, hold, vel), at, 1.0, pan)


# ---------- strings: a small ensemble of detuned saws, darkened, with slow vibrato
def strings_note(f, length, attack=1.4, release=1.8):
    n = int((length + release) * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for v in range(5):
        det = 1 + (v - 2) * 0.0019
        vib = 1 + 0.0026 * np.sin(2 * np.pi * (4.6 + 0.3 * v) * t + rng.uniform(0, 6.28))
        phase = 2 * np.pi * f * det * np.cumsum(vib) / SR + rng.uniform(0, 6.28)
        for k in range(1, 10):
            if f * k > 7000:
                break
            sig += k**-1.7 * np.sin(k * phase)
    env = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    env[:a] = (1 - np.cos(np.linspace(0, np.pi, a))) / 2
    env[-r:] *= np.linspace(1, 0, r) ** 1.5
    return sig * env / 5


# ---------- the score. Chords: (time, length, bass, arpeggio tones, string voicing, strings level)
CHORDS = [
    (0.0, 4.4, 35, None, [47, 54, 62], 0.18),  # Bm      intro: the ink stroke
    (4.4, 4.6, 31, [43, 50, 55, 59], [43, 55, 59, 62], 0.3),  # Gmaj   window reveal
    (9.0, 2.9, 42, [45, 50, 54, 57], [50, 54, 57, 62], 0.4),  # D/F#   dashboard
    (11.9, 2.9, 33, [45, 52, 57, 61], [49, 52, 57, 64], 0.42),  # A
    (14.8, 3.2, 35, [47, 54, 59, 62], [50, 54, 59, 66], 0.46),  # Bm     calendar
    (18.0, 3.2, 31, [43, 50, 55, 59], [50, 55, 59, 67], 0.48),  # G
    (21.2, 1.95, 38, [45, 50, 54, 57], [50, 54, 57, 66], 0.5),  # D      trade review
    (23.15, 1.95, 37, [45, 52, 57, 61], [49, 52, 57, 64], 0.5),  # A/C#
    (25.1, 1.95, 35, [47, 54, 59, 62], [50, 54, 59, 66], 0.52),  # Bm
    (27.05, 1.95, 31, [43, 50, 55, 59], [50, 55, 59, 67], 0.52),  # G
    (29.0, 2.4, 40, [47, 52, 55, 59], [52, 55, 59, 64], 0.42),  # Em7    ask your journal
    (31.4, 2.3, 31, [43, 50, 55, 59], [50, 55, 59, 62], 0.36),  # G      (typing: thinner)
    (33.7, 2.3, 33, [45, 52, 57, 61], [49, 52, 57, 64], 0.44),  # A
    (36.0, 2.5, 31, [43, 50, 55, 59], [50, 55, 59, 67], 0.48),  # G      day and night
    (38.5, 2.2, 42, [45, 50, 54, 57], [54, 57, 62, 66], 0.5),  # D/F#   (light)
    (40.7, 1.5, 33, [45, 52, 57, 61], [49, 52, 57, 64], 0.5),  # A      (back to dark)
    (42.2, 1.6, 35, [47, 54, 59, 62], [50, 54, 59, 66], 0.62),  # Bm     local first: building
    (43.8, 1.6, 31, [43, 50, 55, 59], [50, 55, 59, 67], 0.72),  # G
    (45.4, 0.8, 33, [45, 50, 52, 57], [50, 52, 57, 62], 0.82),  # Asus4
    (46.2, 1.05, 33, [45, 49, 52, 57], [49, 52, 57, 64], 0.88),  # A
]

# right-hand melody: (time, midi, hold, velocity)
MELODY = [
    # intro: single notes that follow the brush
    (0.15, 78, 1.0, 0.55), (1.0, 74, 0.6, 0.45), (1.6, 76, 0.5, 0.5), (2.1, 78, 2.0, 0.62),
    # reveal
    (5.2, 74, 0.8, 0.5), (6.0, 71, 0.8, 0.45), (6.8, 74, 0.8, 0.5), (7.6, 76, 1.4, 0.56),
    # dashboard
    (9.0, 78, 1.5, 0.62), (10.6, 76, 0.4, 0.5), (11.0, 74, 0.9, 0.52), (11.9, 73, 1.6, 0.56),
    (13.5, 76, 0.5, 0.5), (14.0, 69, 0.8, 0.46),
    # calendar
    (14.8, 74, 0.8, 0.55), (15.6, 78, 0.8, 0.58), (16.4, 83, 1.6, 0.66), (18.0, 81, 0.8, 0.6),
    (18.8, 79, 0.8, 0.56), (19.6, 78, 0.8, 0.54), (20.4, 74, 0.8, 0.5),
    # trade review
    (21.2, 78, 0.8, 0.6), (22.0, 79, 0.4, 0.55), (22.4, 81, 0.75, 0.64), (23.15, 76, 0.85, 0.56),
    (24.0, 81, 1.1, 0.6), (25.1, 78, 0.8, 0.58), (25.9, 74, 0.4, 0.5), (26.3, 76, 0.75, 0.54),
    (27.05, 71, 1.15, 0.52), (28.2, 74, 0.8, 0.5),
    # ask your journal: sparse while the question is typed
    (29.0, 79, 0.8, 0.56), (29.8, 78, 0.8, 0.52), (30.6, 76, 0.8, 0.52), (31.4, 74, 2.3, 0.5),
    (33.7, 73, 0.8, 0.52), (34.5, 76, 0.8, 0.55), (35.3, 81, 0.7, 0.6),
    # day and night
    (36.0, 83, 0.8, 0.62), (36.8, 81, 0.8, 0.56), (37.6, 79, 0.9, 0.54), (39.3, 78, 1.4, 0.56),
    (40.7, 76, 0.8, 0.54), (41.5, 73, 0.7, 0.52),
    # local first: the line climbs and leans into the resolution
    (42.2, 78, 0.8, 0.64), (43.0, 83, 0.8, 0.68), (43.8, 83, 0.8, 0.66), (44.6, 81, 0.8, 0.64),
    (45.4, 81, 0.4, 0.66), (45.8, 79, 0.4, 0.62), (46.2, 76, 0.5, 0.64), (46.7, 73, 0.55, 0.62),
]

for at, length, bass, tones, voicing, level in CHORDS:
    pedal = length + 0.15
    play(bass, at, pedal, 0.55 + 0.25 * level)
    play(bass + 12, at + 0.01, pedal, 0.35 + 0.2 * level)
    if tones:  # rolling eighths: bass, up through the chord, and back
        seq = tones + tones[-2:0:-1]
        k = 1
        while k * EIGHTH < length - 0.05:
            m = seq[(k - 1) % len(seq)]
            vel = 0.3 + 0.18 * level + (0.06 if k % 4 == 0 else 0)
            play(m, at + k * EIGHTH + rng.uniform(-0.008, 0.008), pedal - k * EIGHTH, vel)
            k += 1
    for j, m in enumerate(voicing):
        add(strings_note(midi(m), length + 0.4), at - 0.25, 0.045 * level, pan=-0.5 + j / (len(voicing) - 1))
    add(strings_note(midi(bass + 12), length + 0.4), at - 0.25, 0.05 * level, pan=0.0)

for at, m, hold, vel in MELODY:
    play(m, at, hold, vel)
    if vel >= 0.6:  # stronger notes get a soft octave below, the way a pianist thickens a line
        play(m - 12, at + 0.006, hold, vel * 0.55)

# light mode: a quick high rolled D major; back to dark: a deep D octave
for i, m in enumerate([86, 90, 93, 98]):
    play(m, 38.5 + i * 0.07, 1.2, 0.42 - i * 0.04)
play(26, 40.7, 1.5, 0.5)
play(38, 40.71, 1.5, 0.4)

# end card: a full, rolled D major as the ensō is drawn, strings swelling under it, then a high answer
END = [26, 38, 45, 50, 54, 57, 62, 66, 69, 74, 78, 81]
for i, m in enumerate(END):
    play(m, ENSO + i * 0.035, 3.6, 0.78 if m < 60 else 0.68)
for j, m in enumerate([50, 54, 57, 62, 66, 69]):
    add(strings_note(midi(m), 3.0, attack=0.9, release=2.4), ENSO - 0.4, 0.06, pan=-0.6 + j * 0.24)
add(strings_note(midi(38), 3.0, attack=0.9, release=2.4), ENSO - 0.4, 0.07)
play(86, 48.7, 2.2, 0.42)
play(81, 49.1, 1.8, 0.36)


# ---------- quiet interface sounds, tucked under the music
def brush(length, lo, hi):
    n = int(length * SR)
    u = np.arange(n) / n
    grain = 1 + 0.6 * (onepole_lp(rng.standard_normal(n), 60) * 9) ** 2
    return bandpass(rng.standard_normal(n) * grain, lo, hi) * np.sin(np.pi * np.clip(u * 1.15, 0, 1)) ** 1.5


def tick():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1900 * t) * np.exp(-t * 140) + bandpass(rng.standard_normal(n), 1500, 6000) * np.exp(-t * 320) * 0.6


def tap():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return bandpass(rng.standard_normal(n), 2000, 9000) * np.exp(-t * 280) * 2.0


add(brush(STROKE[1] - STROKE[0] + 0.35, 900, 5000), STROKE[0], 0.05)
for tc in CLICKS:
    add(tick(), tc, 0.035, pan=rng.uniform(-0.15, 0.15))
for i, ch in enumerate(QUESTION):
    if ch != " ":
        add(tap(), TYPE_START + i * TYPE_STEP, 0.018, pan=rng.uniform(-0.25, 0.25))


# ---------- hall: a warm, long room with a pre-delay
def reverb(x, seed):
    n = int(3.2 * SR)
    t = np.arange(n) / SR
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t * 2.0)
    ir = onepole_lp(ir, 5200)
    ir = np.concatenate([np.zeros(int(0.025 * SR)), ir])
    ir /= np.sqrt((ir**2).sum())
    size = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]


outL = L * 0.72 + reverb(L, 1) * 0.5
outR = R * 0.72 + reverb(R, 2) * 0.5

fade = np.ones(N)
fo = int(1.6 * SR)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
out = np.stack([outL, outR], 1) * fade[:, None]
out = np.tanh(out * 1.1 / np.abs(out).max())
out *= 10 ** (-1 / 20) / np.abs(out).max()
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("peak", round(float(np.abs(out).max()), 3), "rms dB", round(float(20 * np.log10(np.sqrt((out**2).mean()))), 1))
