#!/usr/bin/env python3
"""Builds rain.mp3, the room's rain loop. Needs numpy, scipy and ffmpeg.

    python3 build-rain.py "Light Rain Distant Thunder July 5th 2016.wav" rain.mp3

The source is a CC0 field recording by kvgarlic:
https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav
It keeps the steadiest 25 seconds and holds down the drops that land on the microphones,
so that nothing in the loop stands out enough to be heard coming round again.
"""
import subprocess, sys, tempfile
import numpy as np, scipy.io.wavfile as wav, scipy.signal as sig
from scipy.ndimage import maximum_filter1d, uniform_filter1d

START, END = 51.8, 77.3      # seconds: between the thunder and the bird
SPLIT = 700                  # Hz: thuds sit below this, the hiss of the rain above it
TARGET_RMS = -26.0           # dBFS


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)


def limit(x, sr, crest_db):
    """Holds peaks to crest_db over the average. One gain for both channels, eased over 20 ms."""
    ceiling = np.sqrt((x ** 2).mean()) * 10 ** (crest_db / 20)
    gain = np.minimum(1, ceiling / np.maximum(np.abs(x).max(1), 1e-12))
    hold, ramp = int(0.05 * sr) | 1, int(0.02 * sr) | 1
    return x * uniform_filter1d(-maximum_filter1d(-gain, size=hold), size=ramp)[:, None]


def level(x, sr, over_db=1.0):
    """Turns down any tenth of a second that is more than over_db louder than the rest."""
    win = int(0.1 * sr) | 1
    loud = np.sqrt(uniform_filter1d((x ** 2).mean(1), size=win))
    gain = np.minimum(1, np.median(loud) * 10 ** (over_db / 20) / loud)
    return x * uniform_filter1d(gain, size=int(0.05 * sr) | 1)[:, None]


sr, x = wav.read(sys.argv[1])
x = x.astype(np.float64)
x = sig.sosfiltfilt(sig.butter(4, 120, btype='high', fs=sr, output='sos'), x, axis=0)
low = sig.sosfiltfilt(sig.butter(2, SPLIT, btype='low', fs=sr, output='sos'), x, axis=0)
a, b = int(START * sr), int(END * sr)
out = level(limit(low[a:b], sr, 13) + limit((x - low)[a:b], sr, 20), sr)
out *= 10 ** ((TARGET_RMS - rms_db(out)) / 20)
print(f'{len(out) / sr:.1f} s, {rms_db(out):.1f} dBFS rms, peak {np.abs(out).max():.2f}')
with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
    wav.write(tmp.name, sr, out.astype(np.float32))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-ar', '32000',
                    '-c:a', 'libmp3lame', '-q:a', '5', '-map_metadata', '-1', sys.argv[2]], check=True)
