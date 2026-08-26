"""Apply starter reading-room themes to the demo books.

Gives each seeded book its own world so the per-book theming is visible without
anyone having to build one by hand first. Themes are matched by book slug, and
anything already themed is left alone unless --overwrite is passed.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from core.models import Book, BookTheme

# Named presets, also usable as a starting point in the staff portal.
PRESETS = {
    # The room's own family, measured from the client's 2026-08 screens. It is
    # the default for every book that does not ask for a specific world: the
    # room used to default to "daylight", which is now one option among several
    # rather than the house style.
    "storynight": {
        "backdrop_kind": BookTheme.Backdrop.GRADIENT,
        "bg_color": "#2F2143",
        "bg_color_2": "#201A37",
        "gradient_angle": 170,
        "accent": "#F0C75E",
        "ink": "#F5EFF7",
        "chrome_mode": BookTheme.ChromeMode.DARK,
        "book_shadow": BookTheme.BookShadow.DEEP,
        "tilt_degrees": -2,
    },
    "daylight": {
        "backdrop_kind": BookTheme.Backdrop.GRADIENT,
        "bg_color": "#CFE6FB",
        "bg_color_2": "#A9D3F5",
        "gradient_angle": 170,
        "accent": "#3D3B62",
        "ink": "#23324A",
        "chrome_mode": BookTheme.ChromeMode.LIGHT,
        "book_shadow": BookTheme.BookShadow.SOFT,
        "tilt_degrees": -2,
    },
    "meadow": {
        "backdrop_kind": BookTheme.Backdrop.GRADIENT,
        "bg_color": "#DCF0D6",
        "bg_color_2": "#AFD9A6",
        "gradient_angle": 165,
        "accent": "#3B6A3A",
        "ink": "#22341F",
        "chrome_mode": BookTheme.ChromeMode.LIGHT,
        "book_shadow": BookTheme.BookShadow.SOFT,
        "tilt_degrees": -2,
    },
    "sunset": {
        "backdrop_kind": BookTheme.Backdrop.GRADIENT,
        "bg_color": "#FBD9C0",
        "bg_color_2": "#F3A9A0",
        "gradient_angle": 175,
        "accent": "#8F4314",
        "ink": "#3A1F16",
        "chrome_mode": BookTheme.ChromeMode.LIGHT,
        "book_shadow": BookTheme.BookShadow.SOFT,
        "tilt_degrees": -3,
    },
    "night": {
        "backdrop_kind": BookTheme.Backdrop.GRADIENT,
        "bg_color": "#2B3A63",
        "bg_color_2": "#141C33",
        "gradient_angle": 180,
        "accent": "#F0C75E",
        "ink": "#F2F6FF",
        "chrome_mode": BookTheme.ChromeMode.DARK,
        "book_shadow": BookTheme.BookShadow.DEEP,
        "tilt_degrees": -2,
    },
    "ocean": {
        "backdrop_kind": BookTheme.Backdrop.GRADIENT,
        "bg_color": "#BEE6EE",
        "bg_color_2": "#6FB6CC",
        "gradient_angle": 168,
        "accent": "#12556B",
        "ink": "#0F2E3A",
        "chrome_mode": BookTheme.ChromeMode.LIGHT,
        "book_shadow": BookTheme.BookShadow.SOFT,
        "tilt_degrees": -2,
    },
}

# Books whose subject suggests a particular world; everything else gets daylight.
# Books whose subject genuinely calls for a different world. The three seeded
# demo books used to be mapped here to daylight/sunset/night — the pastel end of
# the old palette — which meant the demo never showed the room's own look. They
# take the default now; the presets above stay available for a book that wants
# one, and the staff portal can still set any of them per book.
SLUG_PRESETS: dict[str, str] = {}


class Command(BaseCommand):
    help = "Apply starter reading-room themes to seeded books."

    def add_arguments(self, parser):
        parser.add_argument(
            "--overwrite",
            action="store_true",
            help="Replace themes on books that already have one.",
        )
        parser.add_argument(
            "--preset",
            choices=sorted(PRESETS),
            help="Force a single preset for every book instead of matching by slug.",
        )

    def handle(self, *args, **options):
        forced = options.get("preset")
        overwrite = options["overwrite"]
        applied = skipped = 0

        for book in Book.objects.all().order_by("title"):
            existing = BookTheme.objects.filter(book=book).first()
            if existing and not overwrite:
                skipped += 1
                continue

            name = forced or SLUG_PRESETS.get(book.slug, "storynight")
            fields = PRESETS[name]

            if existing:
                for key, value in fields.items():
                    setattr(existing, key, value)
                existing.save()
            else:
                BookTheme.objects.create(book=book, **fields)

            applied += 1
            self.stdout.write(f"{book.title}: {name}")

        self.stdout.write(
            self.style.SUCCESS(f"Applied {applied} theme(s); left {skipped} existing theme(s) alone.")
        )
