"""Signals that keep every user account fully provisioned.

A user created through ANY path (super-admin portal, Django admin, createsuperuser,
shell, registration API) gets a UserProfile, Entitlement and NotificationPreference
automatically. Previously these were created by hand in each view, so users created
outside the portal had no profile and could appear "invisible" in admin screens.
"""

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Entitlement, NotificationPreference, UserProfile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def provision_user_records(sender, instance, created, **kwargs):
    if not created:
        return
    UserProfile.objects.get_or_create(user=instance)
    Entitlement.objects.get_or_create(user=instance)
    NotificationPreference.objects.get_or_create(user=instance)
