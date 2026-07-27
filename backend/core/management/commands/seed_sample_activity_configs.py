"""Create sample ActivityConfig rows for QA — safe to run multiple times."""

from django.core.management.base import BaseCommand

from core.models import ActivityConfig, Book


def _config(book: Book, activity_type: str, ui: dict, payload: dict, version: str = "1.0") -> dict:
    return {
        "schema_version": version,
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
            # Served from frontend/public — the old via.placeholder.com host is
            # dead and rendered a broken image in the activity picker.
            "image_url": "/activity-samples/hotspot-sample.png",
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
    # ─── Schema v1.1 samples (exercise every new renderer path) ───────────────
    {
        "title": "QA Story Quest",
        "activity_type": ActivityConfig.ActivityType.QUIZ,
        "sort_order": 20,
        "version": "1.1",
        "ui": {
            "title": "Story Quest",
            "instructions": "Read each question and choose the correct answer!",
            "theme": "default",
        },
        "payload": {
            "questions": [
                {
                    "id": "q1",
                    "image_url": "/activity-samples/quiz-sample.png",
                    "prompt": "What is the Chocolate Factory famous for?",
                    "options": [
                        "Making the best chocolate in the world",
                        "Making huge lollipops for everyone",
                        "Growing magical candy trees",
                    ],
                    "correct_index": 0,
                    "feedback_correct": "Correct!",
                    "feedback_wrong": "Not quite — try again!",
                },
                {
                    "id": "q2",
                    "prompt": "Which treat grows on the candy trees?",
                    "options": ["Lollipops", "Pretzels", "Ice cream"],
                    "correct_index": 0,
                    "feedback_correct": "Correct!",
                    "feedback_wrong": "Not quite — try again!",
                },
            ],
            "reveal_mode": "instant",
        },
    },
    {
        "title": "QA Place & Play",
        "activity_type": ActivityConfig.ActivityType.DRAG_DROP,
        "sort_order": 21,
        "version": "1.1",
        "ui": {
            "title": "Match the Feeling!",
            "instructions": "Drag each feeling word onto the character that shows it best.",
            "theme": "default",
        },
        "payload": {
            "image_url": "/activity-samples/dragdrop-sample.png",
            "labels": [
                {"id": "l1", "text": "Excited"},
                {"id": "l2", "text": "Curious"},
                {"id": "l3", "text": "Brave"},
                {"id": "l4", "text": "Surprised"},
            ],
            "drop_zones": [
                {"id": "z1", "x": 6, "y": 28, "w": 18, "h": 22, "label": "Child 1", "accepts": "l1"},
                {"id": "z2", "x": 28, "y": 28, "w": 18, "h": 22, "label": "Child 2", "accepts": "l2"},
                {"id": "z3", "x": 52, "y": 28, "w": 18, "h": 22, "label": "Child 3", "accepts": "l3"},
                {"id": "z4", "x": 76, "y": 28, "w": 18, "h": 22, "label": "Child 4", "accepts": "l4"},
            ],
        },
    },
    {
        "title": "QA Create Together",
        "activity_type": ActivityConfig.ActivityType.DRAWING,
        "sort_order": 22,
        "version": "1.1",
        "ui": {
            "title": "Let's get creative!",
            "instructions": "Draw or colour the Chocolate Factory any way you imagine.",
            "theme": "default",
        },
        "payload": {
            "background_url": "/activity-samples/coloring-sample.png",
            "palette": ["#000000", "#c84a71", "#f0c75e", "#3b85a6", "#764f84", "#22c55e"],
            "brush_sizes": [3, 6, 12, 24],
            "allow_eraser": True,
            "allow_fill": True,
            "allow_shapes": True,
            "allow_submit": True,
        },
    },
    {
        "title": "QA Discovery Spots",
        "activity_type": ActivityConfig.ActivityType.HOTSPOT,
        "sort_order": 23,
        "version": "1.1",
        "ui": {
            "title": "Explore the Chocolate Factory!",
            "instructions": "Click each glowing discovery spot to learn something new.",
            "theme": "default",
        },
        "payload": {
            "image_url": "/activity-samples/hotspot-sample.png",
            "display": "popup",
            "hotspots": [
                {
                    "id": "h1",
                    "x": 20,
                    "y": 35,
                    "w": 16,
                    "h": 20,
                    "content": "Chocolate Tanks — these giant tanks mix warm chocolate day and night!",
                },
                {
                    "id": "h2",
                    "x": 55,
                    "y": 30,
                    "w": 16,
                    "h": 20,
                    "content": "Candy Trees — they grow sweet treats all year round.",
                },
                {
                    "id": "h3",
                    "x": 72,
                    "y": 45,
                    "w": 16,
                    "h": 20,
                    "content": "Lollipop Tree — pick a lollipop and make a wish!",
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
            envelope = _config(book, cfg_type, row["ui"], row["payload"], row.get("version", "1.0"))
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
