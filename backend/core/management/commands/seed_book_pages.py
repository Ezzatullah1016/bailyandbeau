"""Generate local placeholder page images for books that have none.

Existing demo data points every BookPage at ``https://placehold.co/...``. That
host is a third-party service: when it is slow, blocked, or rate-limited, every
page in the reading room renders blank with no error — the book simply looks
empty. The same class of failure already killed the hotspot activity image
(via.placeholder.com, now defunct).

This command renders the placeholder pages locally into MEDIA_ROOT and rewrites
the affected BookPage rows to point at them, so a reading session never depends
on an external host to show its book.
"""

from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from core.models import Book, BookPage

# Hosts whose URLs we replace. Anything already local is left alone.
EXTERNAL_HOSTS = ("placehold.co", "placeholder.com", "via.placeholder.com")

PAGE_W, PAGE_H = 800, 1100
BG = (238, 241, 255)
INK = (49, 52, 60)
ACCENT = (118, 79, 132)


def _font(size: int):
    """Best available font — falls back to the bitmap default."""
    from PIL import ImageFont

    for name in ("seguisb.ttf", "segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _render_page(title: str, page_number: int, total: int, dest: Path) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (PAGE_W, PAGE_H), BG)
    draw = ImageDraw.Draw(img)

    # Soft page border so the spread reads as paper rather than a flat fill.
    draw.rectangle([(24, 24), (PAGE_W - 24, PAGE_H - 24)], outline=(206, 214, 244), width=4)

    title_font = _font(52)
    page_font = _font(260)
    small_font = _font(30)

    def centered(text, font, y, fill):
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        draw.text(((PAGE_W - (right - left)) / 2, y), text, font=font, fill=fill)

    # A big tinted block behind the page number keeps each page visually
    # distinct when the spread is scaled down to fit the reading stage.
    band_top, band_bottom = 250, 720
    draw.rectangle([(70, band_top), (PAGE_W - 70, band_bottom)], fill=(222, 229, 252))
    draw.rectangle([(70, band_top), (PAGE_W - 70, band_top + 12)], fill=ACCENT)

    centered(title, title_font, 130, INK)
    centered(str(page_number), page_font, band_top + 90, ACCENT)
    centered(f"Page {page_number} of {total}", small_font, band_bottom + 60, (110, 116, 132))

    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG", optimize=True)


class Command(BaseCommand):
    help = "Render local placeholder page images for books whose pages point at external hosts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--all",
            action="store_true",
            help="Regenerate every page, not only those pointing at an external host.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing files or rows.",
        )
        parser.add_argument(
            "--base-url",
            default="",
            help=(
                "Absolute origin to prefix onto page URLs, e.g. http://127.0.0.1:8300. "
                "Required in development because the Next.js dev server does not serve "
                "Django's MEDIA_URL, so a host-relative /media/... path 404s."
            ),
        )

    def handle(self, *args, **options):
        regenerate_all = options["all"]
        dry_run = options["dry_run"]

        media_root = Path(settings.MEDIA_ROOT)
        media_url = settings.MEDIA_URL if settings.MEDIA_URL.endswith("/") else settings.MEDIA_URL + "/"
        base_url = options["base_url"].rstrip("/")

        total_pages = 0
        touched_books = 0

        for book in Book.objects.all().order_by("title"):
            pages = list(BookPage.objects.filter(book=book).order_by("page_number"))
            if not pages:
                continue

            targets = [
                p
                for p in pages
                if regenerate_all or any(host in (p.image_url or "") for host in EXTERNAL_HOSTS)
            ]
            if not targets:
                continue

            touched_books += 1
            self.stdout.write(f"{book.title}: {len(targets)}/{len(pages)} page(s)")

            for index, page in enumerate(targets, start=1):
                # Render against the page's position in the book. `page_number`
                # can be an arbitrary stored value (one seeded book had 261 for
                # its only page), which produced captions like "261 of 1".
                display_number = index if page.page_number > len(pages) else page.page_number
                rel = f"book-pages/{book.id}/page-{display_number:03d}.png"
                if not dry_run:
                    _render_page(book.title, display_number, len(pages), media_root / rel)
                    page.image_url = f"{base_url}{media_url}{rel}"
                    page.save(update_fields=["image_url"])
                total_pages += 1

        verb = "Would render" if dry_run else "Rendered"
        self.stdout.write(
            self.style.SUCCESS(f"{verb} {total_pages} page image(s) across {touched_books} book(s).")
        )
