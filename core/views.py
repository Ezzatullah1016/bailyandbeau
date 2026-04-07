from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth import get_user_model
from django.shortcuts import render

from .models import Badge, Book, ChildProfile, ReadingReminder, ReadingSession, SessionEvent

User = get_user_model()


def home(request):
    return render(request, 'core/home.html')


@staff_member_required
def super_admin_dashboard(request):
    stats = [
        {"label": "Total Users", "value": User.objects.count(), "icon": "fa-users", "accent": "from-violet-500 to-indigo-600"},
        {"label": "Child Profiles", "value": ChildProfile.objects.filter(is_active=True).count(), "icon": "fa-child-reaching", "accent": "from-pink-500 to-rose-500"},
        {"label": "Total Books", "value": Book.objects.count(), "icon": "fa-book-open", "accent": "from-emerald-500 to-teal-500"},
        {"label": "Live Sessions", "value": ReadingSession.objects.filter(status=ReadingSession.Status.ACTIVE).count(), "icon": "fa-video", "accent": "from-amber-500 to-orange-500"},
        {"label": "Badges", "value": Badge.objects.count(), "icon": "fa-award", "accent": "from-sky-500 to-cyan-500"},
        {"label": "Reminders", "value": ReadingReminder.objects.count(), "icon": "fa-bell", "accent": "from-fuchsia-500 to-purple-500"},
    ]

    context = {
        "stats": stats,
        "recent_sessions": ReadingSession.objects.select_related("book", "child_profile", "created_by")[:5],
        "recent_events": SessionEvent.objects.select_related("session", "participant")[:6],
    }
    return render(request, "core/super_admin_dashboard.html", context)
