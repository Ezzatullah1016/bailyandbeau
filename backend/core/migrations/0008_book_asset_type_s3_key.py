from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_bookpage"),
    ]

    operations = [
        migrations.AddField(
            model_name="book",
            name="asset_type",
            field=models.CharField(
                choices=[("pdf", "PDF"), ("images", "Pre-rendered images")],
                default="images",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="book",
            name="s3_key",
            field=models.CharField(
                blank=True,
                help_text="S3 key prefix for this book's assets (e.g. books/uuid/)",
                max_length=512,
            ),
        ),
    ]
