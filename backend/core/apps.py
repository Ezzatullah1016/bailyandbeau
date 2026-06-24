from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = 'core'

    def ready(self):
        # Register post_save signals that auto-provision user records.
        from . import signals  # noqa: F401
