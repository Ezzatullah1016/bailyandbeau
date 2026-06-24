"""Sync local book/media assets up to S3 and configure bucket CORS.

Local uploads historically landed in BASE_DIR/{book-pdfs,book-covers,book-pages,user-avatars}/.
When STORAGE=s3 those objects must exist in the bucket under the same keys so presigned URLs resolve.
This command uploads any local files that are missing (or --force all) and sets a CORS policy that lets
the browser (pdf.js) fetch presigned PDFs.

Usage:
    python manage.py sync_media_to_s3            # upload missing, set CORS
    python manage.py sync_media_to_s3 --force    # re-upload everything
    python manage.py sync_media_to_s3 --no-cors  # skip CORS update
"""

import mimetypes
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from core.s3_presign import s3_client_for_media

MEDIA_DIRS = ["book-pdfs", "book-covers", "book-pages", "user-avatars"]

CORS_ALLOWED_ORIGINS = [
    "https://reading-room.baileyandbeauco.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://16.16.146.231:3000",
    "http://16.16.146.231",
]


class Command(BaseCommand):
    help = "Upload local media assets to S3 and configure bucket CORS."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Re-upload even if the object exists.")
        parser.add_argument("--no-cors", action="store_true", help="Skip setting bucket CORS.")

    def handle(self, *args, **opts):
        bucket = (getattr(settings, "AWS_STORAGE_BUCKET_NAME", "") or "").strip()
        if not bucket:
            self.stderr.write("AWS_STORAGE_BUCKET_NAME not set — aborting.")
            return
        s3 = s3_client_for_media()
        base = Path(settings.BASE_DIR)

        uploaded = skipped = 0
        for d in MEDIA_DIRS:
            root = base / d
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                key = path.relative_to(base).as_posix()
                if not opts["force"]:
                    try:
                        s3.head_object(Bucket=bucket, Key=key)
                        skipped += 1
                        continue
                    except Exception:
                        pass
                ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": ctype})
                uploaded += 1
                self.stdout.write(f"  uploaded {key}")

        self.stdout.write(self.style.SUCCESS(f"Uploaded {uploaded}, skipped {skipped} existing."))

        if not opts["no_cors"]:
            s3.put_bucket_cors(
                Bucket=bucket,
                CORSConfiguration={
                    "CORSRules": [
                        {
                            "AllowedMethods": ["GET", "HEAD"],
                            "AllowedOrigins": CORS_ALLOWED_ORIGINS,
                            "AllowedHeaders": ["*"],
                            "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
                            "MaxAgeSeconds": 3600,
                        }
                    ]
                },
            )
            self.stdout.write(self.style.SUCCESS("Bucket CORS configured for frontend origins."))
