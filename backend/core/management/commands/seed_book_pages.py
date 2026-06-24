"""
Seed placeholder page images for published books that have none.

Why: the reading room renders `BookPage` rows. Demo books shipped with a
`page_count` but zero actual pages, so the room fell back to a broken
client-side placeholder PDF and hung on "Loading placeholder book…".
Giving each book real, loadable page images fixes the happy path.

Usage:
    python manage.py seed_book_pages            # only books with no pages
    python manage.py seed_book_pages --force    # overwrite existing pages
"""

from django.core.management.base import BaseCommand

from core.models import Book, BookPage


def _page_image_url(book: Book, page_number: int) -> str:
    # placehold.co renders a labelled placeholder image at request time.
    # image_url is a URLField, so a plain https URL is all we need.
    label = f"{book.title} - Page {page_number}".replace(" ", "+").replace("&", "and")
    return f"https://placehold.co/800x1100/eef1ff/31343c/png?text={label}"


class Command(BaseCommand):
    help = "Seed placeholder page images for published books that have none."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Recreate pages even for books that already have some.",
        )
        parser.add_argument(
            "--pages",
            type=int,
            default=0,
            help="Force a specific page count (0 = use the book's page_count).",
        )

    def handle(self, *args, **options):
        force = options["force"]
        forced_pages = options["pages"]
        created = 0
        touched_books = 0

        for book in Book.objects.filter(published=True):
            if book.pages.exists() and not force:
                continue

            if force:
                book.pages.all().delete()

            count = forced_pages or book.page_count or 6
            count = max(1, min(count, 30))  # keep demos sane

            for i in range(1, count + 1):
                BookPage.objects.update_or_create(
                    book=book,
                    page_number=i,
                    defaults={"image_url": _page_image_url(book, i)},
                )
                created += 1

            book.asset_type = Book.AssetType.IMAGES
            book.page_count = count
            book.save(update_fields=["asset_type", "page_count", "updated_at"])
            touched_books += 1
            self.stdout.write(f"  {book.title}: {count} pages")

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {created} pages across {touched_books} book(s)."
            )
        )
