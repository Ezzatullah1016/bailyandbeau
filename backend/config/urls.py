"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from core import views

urlpatterns = [
    path('', views.home, name='home'),
    # Canonical staff-portal login. Lives under /staff/ so nginx proxies it
    # to Django (gunicorn); the bare /login route is owned by the Next.js customer app.
    path('staff/login/', views.auth_portal, name='super_admin_login'),
    path('login/', views.auth_portal, name='login'),  # legacy alias, still Django-served
    path('staff/logout/', views.logout_view, name='super_admin_logout'),
    path('logout/', views.logout_view, name='logout'),
    path('staff/dashboard/', views.super_admin_dashboard, name='super_admin_dashboard'),
    path('staff/sessions/', views.admin_session_monitor, name='admin_session_monitor'),
    path('staff/sessions/<uuid:session_id>/', views.admin_session_detail, name='admin_session_detail'),
    path('staff/books/', views.admin_book_library, name='admin_book_library'),
    path('staff/books/new/', views.admin_book_create, name='admin_book_create'),
    path('staff/books/<uuid:book_id>/', views.admin_book_detail, name='admin_book_detail'),
    path('staff/activities/', views.admin_activity_config, name='admin_activity_config'),
    path('staff/adventures/', views.admin_activity_groups, name='admin_activity_groups'),
    path('staff/users/', views.admin_users, name='admin_users'),
    path('staff/users/new/', views.admin_user_create, name='admin_user_create'),
    path('staff/users/<int:user_id>/', views.admin_user_detail, name='admin_user_detail'),
    path('staff/subscriptions/', views.admin_subscriptions, name='admin_subscriptions'),
    path('staff/badges/', views.admin_badges, name='admin_badges'),
    path('staff/live-sessions/', views.admin_live_sessions, name='admin_live_sessions'),
    path('staff/logs/', views.admin_logs, name='admin_logs'),
    path('staff/settings/', views.admin_settings, name='admin_settings'),
    # Django's stock admin sits where a Django developer expects it. The staff
    # portal is /staff/. /django-admin/ stays as a redirect so bookmarks made
    # while the two were swapped keep working.
    # The staff portal moved from /super-admin/ to /staff/. Forward the old
    # prefix rather than 404 on links already handed to the client.
    path('super-admin/<path:path>', views.redirect_super_admin_to_staff),
    path('super-admin/', views.redirect_super_admin_to_staff, {'path': 'dashboard/'}),
    path('admin/', admin.site.urls),
    path('django-admin/<path:path>', views.redirect_django_admin_to_admin),
    path('django-admin/', views.redirect_django_admin_root),
    path('api/v1/', include('core.api_urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


def trigger_sentry_test(request):
    """Staff-only endpoint — raises a deliberate exception to verify Sentry capture."""
    from django.http import HttpResponseForbidden
    if not request.user.is_staff:
        return HttpResponseForbidden()
    raise Exception("Sentry test error — Bailey & Beau platform monitoring check")


urlpatterns += [path('api/v1/debug/sentry-test/', trigger_sentry_test)]
