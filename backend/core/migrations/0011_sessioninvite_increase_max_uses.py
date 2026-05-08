# Generated manually — allow multiple guests per invite link

from django.db import migrations, models


def bump_low_max_uses(apps, schema_editor):
    SessionInvite = apps.get_model("core", "SessionInvite")
    # Previous default max_uses=1 blocked a second guest; raise cap for existing rows.
    SessionInvite.objects.filter(max_uses__lt=50).update(max_uses=50)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_user_profile_avatar"),
    ]

    operations = [
        migrations.AlterField(
            model_name="sessioninvite",
            name="max_uses",
            field=models.PositiveIntegerField(
                default=50,
                help_text="Max number of guests who can claim this link (each join consumes one use).",
            ),
        ),
        migrations.RunPython(bump_low_max_uses, migrations.RunPython.noop),
    ]
