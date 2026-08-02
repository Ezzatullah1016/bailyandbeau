"""Seed the shared themes and one worked activity group — safe to re-run."""

from django.core.management.base import BaseCommand

from core.models import ActivityConfig, ActivityGroup, Book, Theme


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


A = "/adventure-assets"


def _quiz(qs, **kw):
    return {"reveal_mode": "instant", "questions": qs, **kw}


#: Hotspot and drop-zone coordinates below were read off each generated image
#: after cropping, not copied between adventures — a spot at 30%/40% means
#: something different on every picture.
GROUPS = [
    {
        "slug": "jungle-adventure",
        "title": "Jungle Adventure",
        "description": "Meet the animals of the rainforest, then draw one of your own.",
        "theme": "jungle",
        "cover": f"{A}/jungle-cover.jpg",
        "sort_order": 20,
        "activities": [
            {
                "title": "Jungle Story Quest",
                "activity_type": "quiz",
                "sort_order": 10,
                "ui": {"title": "Who lives in the jungle?", "instructions": "Tap the best answer."},
                "payload": _quiz([
                    {
                        "id": "q1",
                        "prompt": "Which bird has a big colourful beak?",
                        "options": ["The toucan", "The owl", "The duck"],
                        "correct_index": 0,
                        "image_url": f"{A}/jungle-quiz.jpg",
                        "feedback_correct": "Yes! A toucan's beak is huge but very light.",
                        "feedback_wrong": "Look for the one with the big orange beak.",
                    },
                    {
                        "id": "q2",
                        "prompt": "How does a monkey move through the trees?",
                        "options": ["It swims", "It swings", "It digs"],
                        "correct_index": 1,
                        "feedback_correct": "Swinging from branch to branch!",
                        "feedback_wrong": "Think about its long arms and the vines.",
                    },
                ]),
            },
            {
                "title": "Jungle Discovery Spots",
                "activity_type": "hotspot",
                "sort_order": 20,
                "ui": {"title": "Explore the rainforest!", "instructions": "Tap each glowing spot."},
                "payload": {
                    "image_url": f"{A}/jungle-hotspot.jpg",
                    "display": "popup",
                    "hotspots": [
                        {"id": "h1", "x": 8, "y": 34, "w": 12, "h": 22,
                         "content": "A toucan. Its beak looks heavy but it is mostly hollow, so it is very light."},
                        {"id": "h2", "x": 25, "y": 36, "w": 12, "h": 22,
                         "content": "A green snake. Snakes taste the air with their tongue to find their way."},
                        {"id": "h3", "x": 44, "y": 34, "w": 13, "h": 26,
                         "content": "A jaguar cub. Every jaguar's spots are different, like fingerprints."},
                        {"id": "h4", "x": 67, "y": 28, "w": 12, "h": 26,
                         "content": "A waterfall. Rain falls on the treetops and trickles all the way down here."},
                        {"id": "h5", "x": 82, "y": 22, "w": 13, "h": 24,
                         "content": "A hibiscus flower. Hummingbirds drink the sweet nectar inside."},
                    ],
                },
            },
            {
                "title": "Jungle Place & Play",
                "activity_type": "drag_drop",
                "sort_order": 30,
                "ui": {"title": "Where does each one live?", "instructions": "Drag each animal to its home."},
                "payload": {
                    "image_url": f"{A}/jungle-dragdrop.jpg",
                    "labels": [
                        {"id": "l1", "text": "Parrot"},
                        {"id": "l2", "text": "Beetle"},
                        {"id": "l3", "text": "Fish"},
                    ],
                    "drop_zones": [
                        {"id": "z1", "x": 8, "y": 14, "w": 22, "h": 26, "label": "Treetops", "accepts": "l1"},
                        {"id": "z2", "x": 40, "y": 52, "w": 22, "h": 26, "label": "Forest floor", "accepts": "l2"},
                        {"id": "z3", "x": 72, "y": 52, "w": 22, "h": 26, "label": "River", "accepts": "l3"},
                    ],
                },
            },
            {
                "title": "Jungle Create Together",
                "activity_type": "drawing",
                "sort_order": 40,
                "ui": {"title": "Colour the monkey", "instructions": "Any colours you like."},
                "payload": {
                    "background_url": f"{A}/jungle-colouring.jpg",
                    "palette": ["#2f7d4f", "#8a5a2b", "#f0c75e", "#c84a71", "#3b85a6"],
                    "brush_sizes": [3, 6, 12, 24],
                    "allow_eraser": True,
                    "allow_submit": True,
                },
            },
        ],
    },
    {
        "slug": "museum-adventure",
        "title": "Museum Adventure",
        "description": "Wander the halls, find the treasures, and meet a dinosaur.",
        "theme": "museum",
        "cover": f"{A}/museum-cover.jpg",
        "sort_order": 30,
        "activities": [
            {
                "title": "Museum Story Quest",
                "activity_type": "quiz",
                "sort_order": 10,
                "ui": {"title": "What is in the museum?", "instructions": "Tap the best answer."},
                "payload": _quiz([
                    {
                        "id": "q1",
                        "prompt": "What is a dinosaur skeleton made of?",
                        "options": ["Bones", "Paper", "Ice"],
                        "correct_index": 0,
                        "image_url": f"{A}/museum-quiz.jpg",
                        "feedback_correct": "Bones — and they are millions of years old!",
                        "feedback_wrong": "Think about what is inside your own body.",
                    },
                    {
                        "id": "q2",
                        "prompt": "Why do museums keep things behind glass?",
                        "options": ["To hide them", "To keep them safe", "To make them cold"],
                        "correct_index": 1,
                        "feedback_correct": "Yes — glass keeps dust and fingers away.",
                        "feedback_wrong": "It is so nothing gets damaged.",
                    },
                ]),
            },
            {
                "title": "Museum Discovery Spots",
                "activity_type": "hotspot",
                "sort_order": 20,
                "ui": {"title": "Explore the museum!", "instructions": "Tap each glowing spot."},
                "payload": {
                    "image_url": f"{A}/museum-hotspot.jpg",
                    "display": "popup",
                    "hotspots": [
                        {"id": "h1", "x": 5, "y": 52, "w": 15, "h": 34,
                         "content": "A dinosaur skeleton. Scientists dig the bones out of rock and rebuild them."},
                        {"id": "h2", "x": 26, "y": 56, "w": 14, "h": 28,
                         "content": "A painted portrait. Long before cameras, this was how you remembered a face."},
                        {"id": "h3", "x": 46, "y": 62, "w": 15, "h": 28,
                         "content": "A gemstone. It grew deep underground over a very, very long time."},
                        {"id": "h4", "x": 66, "y": 60, "w": 14, "h": 28,
                         "content": "A clay pot. People carried water in pots like this thousands of years ago."},
                        {"id": "h5", "x": 84, "y": 52, "w": 13, "h": 34,
                         "content": "A model rocket. Rockets have to fly fast enough to escape the Earth."},
                    ],
                },
            },
            {
                "title": "Museum Place & Play",
                "activity_type": "drag_drop",
                "sort_order": 30,
                "ui": {"title": "Fill the display cases", "instructions": "Drag each treasure onto a plinth."},
                "payload": {
                    "image_url": f"{A}/museum-dragdrop.jpg",
                    "labels": [
                        {"id": "l1", "text": "Fossil"},
                        {"id": "l2", "text": "Crown"},
                        {"id": "l3", "text": "Vase"},
                    ],
                    "drop_zones": [
                        {"id": "z1", "x": 10, "y": 44, "w": 20, "h": 28, "label": "Left plinth", "accepts": "l1"},
                        {"id": "z2", "x": 40, "y": 44, "w": 20, "h": 28, "label": "Middle plinth", "accepts": "l2"},
                        {"id": "z3", "x": 70, "y": 44, "w": 20, "h": 28, "label": "Right plinth", "accepts": "l3"},
                    ],
                },
            },
            {
                "title": "Museum Create Together",
                "activity_type": "drawing",
                "sort_order": 40,
                "ui": {"title": "Colour the dinosaur", "instructions": "Any colours you like."},
                "payload": {
                    "background_url": f"{A}/museum-colouring.jpg",
                    "palette": ["#764f84", "#8a5a2b", "#3b85a6", "#c84a71", "#f0c75e"],
                    "brush_sizes": [3, 6, 12, 24],
                    "allow_eraser": True,
                    "allow_submit": True,
                },
            },
        ],
    },
    {
        "slug": "bedtime-adventure",
        "title": "Bedtime Adventure",
        "description": "Wind down: quiet questions, a cosy room to explore, and something gentle to colour.",
        "theme": "bedtime",
        "cover": f"{A}/bedtime-cover.jpg",
        "sort_order": 40,
        "activities": [
            {
                "title": "Bedtime Story Quest",
                "activity_type": "quiz",
                "sort_order": 10,
                "ui": {"title": "Getting ready for bed", "instructions": "Tap the best answer."},
                "payload": _quiz([
                    {
                        "id": "q1",
                        "prompt": "What shape is the moon in the picture?",
                        "options": ["A circle", "A crescent", "A square"],
                        "correct_index": 1,
                        "image_url": f"{A}/bedtime-quiz.jpg",
                        "feedback_correct": "A crescent — like a smile in the sky.",
                        "feedback_wrong": "Look at its curved banana shape.",
                    },
                    {
                        "id": "q2",
                        "prompt": "Which animal stays awake at night?",
                        "options": ["The owl", "The sheep", "The duck"],
                        "correct_index": 0,
                        "feedback_correct": "Owls are nocturnal — awake while we sleep.",
                        "feedback_wrong": "Listen for the one that goes 'twit twoo'.",
                    },
                ]),
            },
            {
                "title": "Bedtime Discovery Spots",
                "activity_type": "hotspot",
                "sort_order": 20,
                "ui": {"title": "Explore the bedroom!", "instructions": "Tap each glowing spot."},
                "payload": {
                    "image_url": f"{A}/bedtime-hotspot.jpg",
                    "display": "popup",
                    "hotspots": [
                        {"id": "h1", "x": 5, "y": 48, "w": 13, "h": 26,
                         "content": "A bedside lamp. A soft light helps your eyes get sleepy."},
                        {"id": "h2", "x": 15, "y": 60, "w": 12, "h": 24,
                         "content": "A teddy bear, waiting to be tucked in too."},
                        {"id": "h3", "x": 30, "y": 36, "w": 16, "h": 24,
                         "content": "A child fast asleep. Sleeping is how your body grows and rests."},
                        {"id": "h4", "x": 68, "y": 68, "w": 16, "h": 22,
                         "content": "A storybook. One more story before the light goes out."},
                        {"id": "h5", "x": 74, "y": 14, "w": 17, "h": 30,
                         "content": "The moon through the window. It is always there, even in the daytime."},
                    ],
                },
            },
            {
                "title": "Bedtime Place & Play",
                "activity_type": "drag_drop",
                "sort_order": 30,
                "ui": {"title": "Time to tidy up", "instructions": "Drag each thing where it belongs."},
                "payload": {
                    "image_url": f"{A}/bedtime-dragdrop.jpg",
                    "labels": [
                        {"id": "l1", "text": "Star"},
                        {"id": "l2", "text": "Pillow"},
                        {"id": "l3", "text": "Toy"},
                    ],
                    "drop_zones": [
                        {"id": "z1", "x": 8, "y": 20, "w": 22, "h": 40, "label": "Night sky", "accepts": "l1"},
                        {"id": "z2", "x": 40, "y": 30, "w": 22, "h": 40, "label": "Bed", "accepts": "l2"},
                        {"id": "z3", "x": 72, "y": 30, "w": 22, "h": 40, "label": "Toy shelf", "accepts": "l3"},
                    ],
                },
            },
            {
                "title": "Bedtime Create Together",
                "activity_type": "drawing",
                "sort_order": 40,
                "ui": {"title": "Colour the sleepy bear", "instructions": "Soft colours for bedtime."},
                "payload": {
                    "background_url": f"{A}/bedtime-colouring.jpg",
                    "palette": ["#3d3b62", "#764f84", "#3b85a6", "#f0c75e", "#eccdca"],
                    "brush_sizes": [3, 6, 12, 24],
                    "allow_eraser": True,
                    "allow_submit": True,
                },
            },
        ],
    },
]

#: Books share the same taxonomy as adventures, so the library can filter both
#: by theme. Nothing set this before, which is why /books/?theme= was empty.
BOOK_THEMES = {
    "moonlight-bedtime": "bedtime",
    "colour-adventure": "ocean",
    "little-shapes": "museum",
}


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
                "cover_image": "/adventure-assets/ocean-cover.jpg",
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

        # ── The remaining themed adventures ──────────────────────────────
        group_count = 1
        for spec in GROUPS:
            other, was_created = ActivityGroup.objects.update_or_create(
                slug=spec["slug"],
                defaults={
                    "title": spec["title"],
                    "description": spec["description"],
                    "theme": themes.get(spec["theme"]),
                    "cover_image": spec.get("cover", ""),
                    "age_band": "3-5",
                    "sort_order": spec["sort_order"],
                    "published": True,
                },
            )
            group_count += 1
            for row in spec["activities"]:
                envelope = {
                    "schema_version": "1.1",
                    "activity_type": row["activity_type"],
                    "ui": {
                        "title": row["ui"]["title"],
                        "instructions": row["ui"].get("instructions", ""),
                        "theme": "default",
                    },
                    "payload": row["payload"],
                    "validation": {},
                }
                _, made = ActivityConfig.objects.update_or_create(
                    activity_group=other,
                    title=row["title"],
                    defaults={
                        "book": None,
                        "activity_type": row["activity_type"],
                        "config": envelope,
                        "sort_order": row["sort_order"],
                        "is_active": True,
                    },
                )
                act_created += made
                act_updated += not made

        # ── Books share the taxonomy, so the library can filter both ─────
        themed_books = 0
        for slug, theme_slug in BOOK_THEMES.items():
            theme = themes.get(theme_slug)
            if not theme:
                continue
            themed_books += Book.objects.filter(slug=slug).update(theme_category=theme)

        self.stdout.write(
            self.style.SUCCESS(
                f"Themes: {created} created, {updated} updated. "
                f"Adventures: {group_count}. "
                f"Activities: {act_created} created, {act_updated} updated. "
                f"Books themed: {themed_books}."
            )
        )
