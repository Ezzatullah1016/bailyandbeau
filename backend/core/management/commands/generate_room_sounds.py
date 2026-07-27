"""Synthesise the reading-room sound set as WAV files.

The room needs a handful of very short, soft cues (page turn, activity
complete, someone joining or leaving, a gentle nudge when time is nearly up).
Generating them here keeps the sounds in the repo with no third-party asset
licence to track and no external host that can disappear — the same failure that
blanked the book pages and the hotspot image.

Everything is deliberately quiet and low-frequency: this plays while a small
child is being read to, so cues should register without startling.

    python manage.py generate_room_sounds
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

from django.core.management.base import BaseCommand

SAMPLE_RATE = 44100


def _envelope(i: int, total: int, attack: float = 0.02, release: float = 0.6) -> float:
    """Fade in and out so a cue never clicks at its edges."""
    pos = i / max(1, total - 1)
    if pos < attack:
        return pos / attack
    if pos > 1 - release:
        return max(0.0, (1 - pos) / release)
    return 1.0


def _tone(freq: float, seconds: float, gain: float = 0.25, harmonic: float = 0.0):
    """A soft sine, optionally with a quiet octave above for a little body."""
    total = int(SAMPLE_RATE * seconds)
    for i in range(total):
        t = i / SAMPLE_RATE
        value = math.sin(2 * math.pi * freq * t)
        if harmonic:
            value += harmonic * math.sin(4 * math.pi * freq * t)
        yield value * gain * _envelope(i, total)


def _noise_sweep(seconds: float, gain: float = 0.16):
    """Filtered noise — the closest thing to paper moving against paper."""
    total = int(SAMPLE_RATE * seconds)
    # A simple one-pole low-pass over a deterministic pseudo-random sequence
    # keeps the result identical on every run (no seeding surprises in CI).
    state = 0.0
    value = 0.12345
    for i in range(total):
        value = (value * 1103515245 + 12345) % 1.0 if value else 0.5
        value = (value * 9301 + 49297) % 233280 / 233280.0
        white = value * 2 - 1
        state = state + 0.06 * (white - state)
        # Sweep the amplitude so it reads as a single stroke, not a hiss.
        stroke = math.sin(math.pi * (i / total))
        yield state * gain * stroke * _envelope(i, total, attack=0.05, release=0.5)


def _mix(*streams):
    for values in zip(*streams):
        yield sum(values)


def _write(path: Path, samples) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = bytearray()
    for value in samples:
        clipped = max(-1.0, min(1.0, value))
        frames += struct.pack("<h", int(clipped * 32767))
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(bytes(frames))


def _page_turn():
    return _noise_sweep(0.34, gain=0.20)


def _activity_complete():
    # A small rising third — resolved, not triumphant.
    return list(_tone(523.25, 0.22, gain=0.18, harmonic=0.12)) + list(
        _tone(659.25, 0.42, gain=0.20, harmonic=0.12)
    )


def _join():
    return list(_tone(587.33, 0.18, gain=0.14)) + list(_tone(880.00, 0.30, gain=0.15))


def _leave():
    return list(_tone(587.33, 0.18, gain=0.13)) + list(_tone(392.00, 0.34, gain=0.14))


def _time_warning():
    # Two soft low pulses: noticeable to an adult, easy for a child to ignore.
    pulse = list(_tone(392.00, 0.26, gain=0.14))
    gap = [0.0] * int(SAMPLE_RATE * 0.16)
    return pulse + gap + pulse


SOUNDS = {
    "page-turn": _page_turn,
    "activity-complete": _activity_complete,
    "participant-join": _join,
    "participant-leave": _leave,
    "time-warning": _time_warning,
}


class Command(BaseCommand):
    help = "Generate the reading-room sound set into frontend/public/sounds/."

    def add_arguments(self, parser):
        parser.add_argument(
            "--out",
            default="",
            help="Output directory (defaults to frontend/public/sounds relative to the repo root).",
        )

    def handle(self, *args, **options):
        from django.conf import settings

        out = Path(options["out"]) if options["out"] else (
            Path(settings.BASE_DIR).parent / "frontend" / "public" / "sounds"
        )

        for name, build in SOUNDS.items():
            path = out / f"{name}.wav"
            _write(path, build())
            self.stdout.write(f"{path.name}  ({path.stat().st_size // 1024} KB)")

        self.stdout.write(self.style.SUCCESS(f"Wrote {len(SOUNDS)} sound(s) to {out}"))
