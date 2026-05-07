"""Create sample ActivityConfig rows for QA — safe to run multiple times."""

from django.core.management.base import BaseCommand

from core.models import ActivityConfig, Book


def _config(book: Book, activity_type: str, ui: dict, payload: dict) -> dict:
    return {
        "schema_version": ActivityConfig.SCHEMA_VERSION,
        "activity_type": activity_type,
        "book_id": str(book.id),
        "ui": {
            "title": ui["title"],
            "instructions": ui.get("instructions", ""),
            "theme": ui.get("theme", "default"),
        },
        "payload": payload,
        "validation": {},
    }


SAMPLES = [
    {
        "title": "QA Drawing Sandbox",
        "activity_type": ActivityConfig.ActivityType.DRAWING,
        "sort_order": 10,
        "ui": {
            "title": "Rainbow scribble test",
            "instructions": "Try each brush and colour — erase is optional.",
            "theme": "default",
        },
        "payload": {
            "palette": ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7"],
            "brush_sizes": [3, 6, 12, 24],
            "allow_eraser": True,
        },
    },
    {
        "title": "QA Quick Quiz",
        "activity_type": ActivityConfig.ActivityType.QUIZ,
        "sort_order": 11,
        "ui": {
            "title": "Which shape has three sides?",
            "instructions": "Tap the best answer.",
            "theme": "default",
        },
        "payload": {
            "question": "How many sides does a triangle have?",
            "options": ["Two", "Three", "Four"],
            "correct_index": 1,
            "reveal_mode": "instant",
        },
    },
    {
        "title": "QA Sort Shapes",
        "activity_type": ActivityConfig.ActivityType.DRAG_DROP,
        "sort_order": 12,
        "ui": {
            "title": "Match shapes to bins",
            "instructions": "Drag each label into the matching zone.",
            "theme": "default",
        },
        "payload": {
            "items": ["Circle", "Square", "Triangle"],
            "drop_zones": ["Round things", "Corners", "Three sides"],
        },
    },
    {
        "title": "QA Picture hotspots",
        "activity_type": ActivityConfig.ActivityType.HOTSPOT,
        "sort_order": 13,
        "ui": {
            "title": "Tap the animals",
            "instructions": "Explore each highlighted area.",
            "theme": "default",
        },
        "payload": {
            "image_url": "https://via.placeholder.com/640x360.png?text=QA+Hotspot+Image",
            "hotspots": [
                {
                    "id": "h1",
                    "x": 10,
                    "y": 15,
                    "w": 25,
                    "h": 30,
                    "content": "Sun — bright and warm.",
                },
                {
                    "id": "h2",
                    "x": 55,
                    "y": 40,
                    "w": 30,
                    "h": 35,
                    "content": "Grass — soft underfoot.",
                },
            ],
        },
    },
]


class Command(BaseCommand):
    help = "Upsert a handful of valid ActivityConfig rows for manual QA."

    def add_arguments(self, parser):
        parser.add_argument(
            "--slug",
            default="colour-adventure",
            help="Book slug to attach configs to (default: colour-adventure).",
        )

    def handle(self, *args, **options):
        slug = options["slug"]
        book = Book.objects.filter(slug=slug).first()
        if not book:
            book = Book.objects.order_by("title").first()
        if not book:
            self.stderr.write(self.style.ERROR("No books in database — run seed_demo_data first."))
            return

        created = updated = 0
        for row in SAMPLES:
            cfg_type = row["activity_type"]
            envelope = _config(book, cfg_type, row["ui"], row["payload"])
            obj, was_created = ActivityConfig.objects.update_or_create(
                book=book,
                title=row["title"],
                defaults={
                    "activity_type": cfg_type,
                    "config": envelope,
                    "sort_order": row["sort_order"],
                    "is_active": True,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Activity configs ready on book “{book.title}” ({book.slug}): "
                f"{created} created, {updated} updated."
            )
        )
