# Synthesizes the 51 s soundtrack for the Sumi ad: warm pad chords that change with the scenes, a quiet
# plucked arpeggio, sub bass, a whoosh for the window reveal, soft UI clicks and key taps timed to the
# on-screen ones, and a bell on the logo. Writes a 48 kHz stereo 16-bit WAV. Needs numpy.
#   python3 docs/ad/music.py music.wav
import sys
import wave

import numpy as np

SR = 48000
DUR = 51.0
N = int(SR * DUR)
rng = np.random.default_rng(11)

# Must match CLICK_AT in stage.html and the typing in render.mjs.
CLICKS = [15.2, 16.3, 22.0, 22.8, 25.4, 26.35, 29.8, 31.6, 37.05, 37.85, 38.5, 40.05, 40.7]
QUESTION = "Which setups make me the most money?"
TYPE_START, TYPE_STEP = 31.95, 0.055


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


def pad_note(f, length, detune=0.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for h, amp in [(1, 1.0), (2, 0.3), (3, 0.12), (4, 0.05)]:
        for d in (-detune, detune):
            sig += amp * np.sin(2 * np.pi * f * h * (1 + d) * t + rng.uniform(0, 6.28))
    lfo = 1 + 0.06 * np.sin(2 * np.pi * 0.21 * t + rng.uniform(0, 6.28))
    return sig * lfo * env(n, 1.4, 1.8) / 2


# scene chords (start, length, midi notes), in D major
chords = [
    (0.0, 4.9, [38, 50, 57, 61, 64]),  # Dmaj9 under the calendar-grid intro
    (4.4, 4.9, [43, 55, 59, 62, 66]),  # Gmaj7 window reveal
    (9.0, 6.0, [47, 54, 57, 62, 64]),  # Bm11 dashboard
    (14.8, 6.6, [43, 55, 59, 62, 64]),  # G6 calendar
    (21.2, 8.0, [45, 52, 57, 61, 64]),  # A trade review
    (29.0, 7.2, [42, 54, 57, 61, 64]),  # F#m7 ask your journal
    (36.0, 6.4, [43, 55, 59, 62, 66]),  # Gmaj7 day & night
    (42.2, 5.0, [45, 57, 61, 64, 67]),  # A7 local first
    (47.0, 4.0, [38, 50, 57, 62, 64, 66]),  # Dadd9 end card
]
for start, length, notes in chords:
    for k, m in enumerate(notes):
        g = 0.055 if m < 47 else 0.045
        add(pad_note(midi(m), length + 1.6, 0.0016 + 0.0007 * k), start, g, pan=(-0.5 + k / max(1, len(notes) - 1)) * 0.7)
    n = int((length + 1.2) * SR)
    t = np.arange(n) / SR
    add(np.sin(2 * np.pi * midi(notes[0] - 12) * t) * env(n, 0.6, 1.2), start, 0.1)


def pluck(f, length=1.6):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    return s * np.exp(-t * 4.2) * env(n, 0.004, 0.05)


step = 0.375
for start, length, notes in chords[1:-1]:
    upper = [m + 12 for m in notes[1:]]
    seq = upper + upper[-2:0:-1]
    k = 0
    tt = start + 0.2
    while tt < start + length - 0.1:
        add(pluck(midi(seq[k % len(seq)])), tt, 0.028 if k % 4 else 0.04, pan=0.35 * np.sin(k * 1.3))
        k += 1
        tt += step

# whoosh for the window reveal: noise through a rising low-pass
n = int(2.2 * SR)
noise = rng.standard_normal(n)
sweep = np.concatenate([onepole_lp(noise[: n // 2], 900), onepole_lp(noise[n // 2 :], 2600)])
add(sweep * np.sin(np.linspace(0, np.pi, n)) ** 2, 3.15, 0.05)
# soft shimmer as the intro's trading days fill in
for i in range(14):
    add(pluck(midi(86 + [0, 2, 4, 7, 9][i % 5]), 0.9), 0.3 + i * 0.12, 0.012, pan=-0.6 + i * 0.09)
# a bright shimmer when the app flips to light, a low swell when it goes back to dark
for i in range(6):
    add(pluck(midi(81 + [0, 4, 7, 12, 16, 19][i]), 1.2), 38.5 + i * 0.06, 0.018, pan=-0.4 + i * 0.16)
n = int(2.4 * SR)
t = np.arange(n) / SR
add(np.sin(2 * np.pi * midi(31) * t) * np.sin(np.linspace(0, np.pi, n)) ** 2, 40.5, 0.08)


def click(freq=2300, body=0.4):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 160) + rng.standard_normal(n) * np.exp(-t * 300) * body


for tc in CLICKS:
    add(click(), tc, 0.085)
for i, ch in enumerate(QUESTION):
    if ch != " ":
        add(click(3200 + rng.uniform(-300, 300), 0.6), TYPE_START + i * TYPE_STEP, 0.03, pan=rng.uniform(-0.2, 0.2))


def bell(f, length=4.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 1.1), (2.0, 0.5, 1.8), (2.76, 0.3, 2.6), (5.4, 0.12, 4)])
    return s * env(n, 0.003, 0.4)


add(bell(midi(74)), 47.45, 0.07)
add(bell(midi(81)), 47.5, 0.04, pan=0.3)


def reverb(x, seed):
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t * 2.4)
    ir = onepole_lp(ir, 5200)
    ir /= np.sqrt((ir**2).sum())
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]


outL = L * 0.75 + reverb(L, 1) * 0.55
outR = R * 0.75 + reverb(R, 2) * 0.55

fade = np.ones(N)
fi, fo = int(0.3 * SR), int(2.5 * SR)
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
