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
    path('login/', views.auth_portal, name='login'),
    path('super-admin/dashboard/', views.super_admin_dashboard, name='super_admin_dashboard'),
    path('super-admin/sessions/', views.admin_session_monitor, name='admin_session_monitor'),
    path('super-admin/sessions/<uuid:session_id>/', views.admin_session_detail, name='admin_session_detail'),
    path('super-admin/books/', views.admin_book_library, name='admin_book_library'),
    path('super-admin/activities/', views.admin_activity_config, name='admin_activity_config'),
    path('super-admin/users/', views.admin_users, name='admin_users'),
    path('super-admin/subscriptions/', views.admin_subscriptions, name='admin_subscriptions'),
    path('super-admin/badges/', views.admin_badges, name='admin_badges'),
    path('super-admin/live-sessions/', views.admin_live_sessions, name='admin_live_sessions'),
    path('super-admin/logs/', views.admin_logs, name='admin_logs'),
    path('super-admin/settings/', views.admin_settings, name='admin_settings'),
    path('admin/', admin.site.urls),
    path('api/v1/', include('core.api_urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
