"""Seed the shared themes and one worked activity group — safe to re-run."""

from django.core.management.base import BaseCommand

from core.models import ActivityConfig, ActivityGroup, Theme


THEMES = [
    {
        "slug": "ocean",
        "name": "Ocean",
        "description": "Under the waves — reefs, rock pools and deep-sea friends.",
        "accent": "#3b85a6",
        "sort_order": 10,
    },
    {
        "slug": "jungle",
        "name": "Jungle",
        "description": "Vines, canopies and the creatures that live in them.",
        "accent": "#2f7d4f",
        "sort_order": 20,
    },
    {
        "slug": "museum",
        "name": "Museum",
        "description": "Fossils, paintings and things kept safe behind glass.",
        "accent": "#764f84",
        "sort_order": 30,
    },
    {
        "slug": "bedtime",
        "name": "Bedtime",
        "description": "Quiet stories for the end of the day.",
        "accent": "#3d3b62",
        "sort_order": 40,
    },
]


#: One fully-populated adventure, so the feature is demonstrable the moment the
#: command runs rather than needing an operator to author three activities by
#: hand before anything can be clicked.
OCEAN_ACTIVITIES = [
    {
        "title": "Ocean Story Quest",
        "activity_type": ActivityConfig.ActivityType.QUIZ,
        "sort_order": 10,
        "ui": {"title": "What lives in the reef?", "instructions": "Tap the best answer."},
        "payload": {
            "reveal_mode": "instant",
            "questions": [
                {
                    "id": "q1",
                    "prompt": "Which of these breathes through gills?",
                    "options": ["A dolphin", "A clownfish", "A seagull"],
                    "correct_index": 1,
                    "feedback_correct": "Right — fish use gills to breathe underwater!",
                    "feedback_wrong": "Not quite — dolphins and seagulls both need air.",
                },
                {
                    "id": "q2",
                    "prompt": "How many arms does an octopus have?",
                    "options": ["Six", "Eight", "Ten"],
                    "correct_index": 1,
                    "feedback_correct": "Eight arms — that is what 'octo' means!",
                    "feedback_wrong": "Close! Think about what 'octo' means.",
                },
            ],
        },
    },
    {
        "title": "Ocean Discovery Spots",
        "activity_type": ActivityConfig.ActivityType.HOTSPOT,
        "sort_order": 20,
        "ui": {"title": "Explore the rock pool!", "instructions": "Tap each glowing spot."},
        "payload": {
            "image_url": "/activity-samples/hotspot-sample.png",
            "display": "popup",
            "hotspots": [
                {"id": "h1", "x": 12, "y": 20, "w": 12, "h": 14,
                 "content": "Seaweed — a hiding place and a snack all at once."},
                {"id": "h2", "x": 62, "y": 34, "w": 12, "h": 14,
                 "content": "A hermit crab carries its shell everywhere it goes."},
                {"id": "h3", "x": 40, "y": 66, "w": 12, "h": 14,
                 "content": "Starfish can grow a whole new arm if they lose one."},
            ],
        },
    },
    {
        "title": "Ocean Place & Play",
        "activity_type": ActivityConfig.ActivityType.DRAG_DROP,
        "sort_order": 30,
        "ui": {"title": "Who lives where?", "instructions": "Drag each creature to its home."},
        "payload": {
            "image_url": "/activity-samples/dragdrop-sample.png",
            "labels": [
                {"id": "l1", "text": "Clownfish"},
                {"id": "l2", "text": "Crab"},
                {"id": "l3", "text": "Whale"},
            ],
            "drop_zones": [
                {"id": "z1", "x": 8, "y": 30, "w": 20, "h": 24, "label": "Reef", "accepts": "l1"},
                {"id": "z2", "x": 40, "y": 30, "w": 20, "h": 24, "label": "Rock pool", "accepts": "l2"},
                {"id": "z3", "x": 72, "y": 30, "w": 20, "h": 24, "label": "Open sea", "accepts": "l3"},
            ],
        },
    },
    {
        "title": "Ocean Create Together",
        "activity_type": ActivityConfig.ActivityType.DRAWING,
        "sort_order": 40,
        "ui": {"title": "Draw your own sea creature", "instructions": "Any colours you like."},
        "payload": {
            "palette": ["#3b85a6", "#3d3b62", "#c84a71", "#f0c75e", "#2f7d4f"],
            "brush_sizes": [3, 6, 12, 24],
            "allow_eraser": True,
            "allow_submit": True,
        },
    },
]


class Command(BaseCommand):
    help = "Create the shared themes and a worked 'Ocean Adventure' activity group."

    def handle(self, *args, **options):
        themes = {}
        created = updated = 0
        for row in THEMES:
            obj, was_created = Theme.objects.update_or_create(
                slug=row["slug"],
                defaults={
                    "name": row["name"],
                    "description": row["description"],
                    "accent": row["accent"],
                    "sort_order": row["sort_order"],
                    "is_active": True,
                },
            )
            themes[row["slug"]] = obj
            created += was_created
            updated += not was_created

        group, group_created = ActivityGroup.objects.update_or_create(
            slug="ocean-adventure",
            defaults={
                "title": "Ocean Adventure",
                "description": "Dive in: a quiz, a rock pool to explore, and something to draw.",
                "theme": themes["ocean"],
                "age_band": "3-5",
                "sort_order": 10,
                "published": True,
            },
        )

        act_created = act_updated = 0
        for row in OCEAN_ACTIVITIES:
            envelope = {
                "schema_version": "1.1",
                "activity_type": row["activity_type"],
                # No book_id: a group-owned activity has no book to agree with.
                "ui": {
                    "title": row["ui"]["title"],
                    "instructions": row["ui"].get("instructions", ""),
                    "theme": "default",
                },
                "payload": row["payload"],
                "validation": {},
            }
            _, was_created = ActivityConfig.objects.update_or_create(
                activity_group=group,
                title=row["title"],
                defaults={
                    "book": None,
                    "activity_type": row["activity_type"],
                    "config": envelope,
                    "sort_order": row["sort_order"],
                    "is_active": True,
                },
            )
            act_created += was_created
            act_updated += not was_created

        self.stdout.write(
            self.style.SUCCESS(
                f"Themes: {created} created, {updated} updated. "
                f"Group '{group.title}': {'created' if group_created else 'updated'}. "
                f"Activities: {act_created} created, {act_updated} updated."
            )
        )
