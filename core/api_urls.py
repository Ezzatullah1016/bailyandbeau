from django.urls import path

from .api_views import (
    AdminActivityDetailView,
    AdminActivityListCreateView,
    AdminBadgeAwardDeleteView,
    AdminBadgeAwardListView,
    AdminBadgeDetailView,
    AdminBadgeListCreateView,
    AdminBookDetailView,
    AdminBookListCreateView,
    AdminBookPageDetailView,
    AdminBookPageListCreateView,
    AdminChildProfileListView,
    AdminEntitlementDetailView,
    AdminEntitlementListView,
    AdminSessionDetailApiView,
    AdminSessionEventExportView,
    AdminSessionEventListView,
    AdminSessionExportView,
    AdminSessionReportView,
    AdminSessionStatusView,
    AdminUserListView,
    BadgeListView,
    BillingEntitlementView,
    BillingPlansView,
    BookActivityListView,
    BookDetailView,
    BookListView,
    CheckoutSessionView,
    ChildProgressView,
    ChildProfileDetailView,
    ChildProfileListCreateView,
    DashboardView,
    FavoriteBookDetailView,
    FavoriteBookListCreateView,
    HealthCheckView,
    InviteJoinView,
    LoginView,
    MeView,
    NotificationPreferenceView,
    ReadingReminderDetailView,
    ReadingReminderListCreateView,
    RecommendedBooksView,
    RegisterView,
    SessionCancelView,
    SessionCompleteView,
    SessionDetailView,
    SessionEventsView,
    SessionInviteDetailView,
    SessionInviteRegenerateView,
    SessionListCreateView,
    SessionParticipantsView,
    SessionReadyView,
    SessionReconnectTokenView,
    SessionSnapshotView,
    SessionStartView,
    StripeWebhookView,
    TokenRefreshApiView,
)

urlpatterns = [
    # Health & Auth
    path("health/", HealthCheckView.as_view(), name="api-health"),
    path("auth/register/", RegisterView.as_view(), name="auth-register"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/refresh/", TokenRefreshApiView.as_view(), name="auth-refresh"),
    path("me/", MeView.as_view(), name="me"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("notifications/preferences/", NotificationPreferenceView.as_view(), name="notification-preferences"),
    path("reminders/", ReadingReminderListCreateView.as_view(), name="reading-reminder-list"),
    path("reminders/<uuid:pk>/", ReadingReminderDetailView.as_view(), name="reading-reminder-detail"),
    path("library/favorites/", FavoriteBookListCreateView.as_view(), name="favorite-book-list"),
    path("library/favorites/<uuid:book_id>/", FavoriteBookDetailView.as_view(), name="favorite-book-detail"),
    path("recommendations/books/", RecommendedBooksView.as_view(), name="recommended-books"),

    # Admin — Sessions
    path("admin/sessions/", AdminSessionReportView.as_view(), name="admin-session-report"),
    path("admin/sessions/export/", AdminSessionExportView.as_view(), name="admin-session-export"),
    path("admin/sessions/<uuid:pk>/", AdminSessionDetailApiView.as_view(), name="admin-session-detail"),
    path("admin/sessions/<uuid:pk>/status/", AdminSessionStatusView.as_view(), name="admin-session-status"),

    # Admin — Users & Entitlements
    path("admin/users/", AdminUserListView.as_view(), name="admin-user-list"),
    path("admin/entitlements/", AdminEntitlementListView.as_view(), name="admin-entitlement-list"),
    path("admin/entitlements/<int:user_id>/", AdminEntitlementDetailView.as_view(), name="admin-entitlement-detail"),

    # Admin — Books & Pages
    path("admin/books/", AdminBookListCreateView.as_view(), name="admin-book-list"),
    path("admin/books/<uuid:pk>/", AdminBookDetailView.as_view(), name="admin-book-detail"),
    path("admin/books/<uuid:book_id>/pages/", AdminBookPageListCreateView.as_view(), name="admin-book-page-list"),
    path("admin/books/<uuid:book_id>/pages/<uuid:pk>/", AdminBookPageDetailView.as_view(), name="admin-book-page-detail"),

    # Admin — Activities
    path("admin/activities/", AdminActivityListCreateView.as_view(), name="admin-activity-list"),
    path("admin/activities/<uuid:pk>/", AdminActivityDetailView.as_view(), name="admin-activity-detail"),

    # Admin — Badges & Awards
    path("admin/badges/", AdminBadgeListCreateView.as_view(), name="admin-badge-list"),
    path("admin/badges/<uuid:pk>/", AdminBadgeDetailView.as_view(), name="admin-badge-detail"),
    path("admin/badge-awards/", AdminBadgeAwardListView.as_view(), name="admin-badge-award-list"),
    path("admin/badge-awards/<uuid:pk>/", AdminBadgeAwardDeleteView.as_view(), name="admin-badge-award-delete"),

    # Admin — Children
    path("admin/children/", AdminChildProfileListView.as_view(), name="admin-child-list"),

    # Admin — Events Log
    path("admin/events/", AdminSessionEventListView.as_view(), name="admin-event-list"),
    path("admin/events/export/", AdminSessionEventExportView.as_view(), name="admin-event-export"),

    # Billing
    path("billing/plans/", BillingPlansView.as_view(), name="billing-plans"),
    path("billing/entitlement/", BillingEntitlementView.as_view(), name="billing-entitlement"),
    path("billing/checkout-session/", CheckoutSessionView.as_view(), name="billing-checkout-session"),
    path("webhooks/stripe/", StripeWebhookView.as_view(), name="stripe-webhook"),

    # Public books & badges
    path("books/", BookListView.as_view(), name="book-list"),
    path("badges/", BadgeListView.as_view(), name="badge-list"),
    path("books/<uuid:pk>/", BookDetailView.as_view(), name="book-detail"),
    path("books/<uuid:book_id>/activities/", BookActivityListView.as_view(), name="book-activity-list"),

    # Children
    path("children/", ChildProfileListCreateView.as_view(), name="child-list"),
    path("children/<uuid:pk>/", ChildProfileDetailView.as_view(), name="child-detail"),
    path("children/<uuid:pk>/progress/", ChildProgressView.as_view(), name="child-progress"),

    # Sessions (user-facing)
    path("sessions/", SessionListCreateView.as_view(), name="session-list"),
    path("sessions/<uuid:pk>/", SessionDetailView.as_view(), name="session-detail"),
    path("sessions/<uuid:pk>/participants/", SessionParticipantsView.as_view(), name="session-participants"),
    path("sessions/<uuid:pk>/events/", SessionEventsView.as_view(), name="session-events"),
    path("sessions/<uuid:pk>/invite/", SessionInviteDetailView.as_view(), name="session-invite-detail"),
    path("sessions/<uuid:pk>/invite/regenerate/", SessionInviteRegenerateView.as_view(), name="session-invite-regenerate"),
    path("sessions/<uuid:pk>/ready/", SessionReadyView.as_view(), name="session-ready"),
    path("sessions/<uuid:pk>/start/", SessionStartView.as_view(), name="session-start"),
    path("sessions/<uuid:pk>/cancel/", SessionCancelView.as_view(), name="session-cancel"),
    path("sessions/<uuid:pk>/complete/", SessionCompleteView.as_view(), name="session-complete"),
    path("sessions/<uuid:pk>/snapshot/", SessionSnapshotView.as_view(), name="session-snapshot"),
    path("sessions/<uuid:pk>/reconnect-token/", SessionReconnectTokenView.as_view(), name="session-reconnect-token"),
    path("invites/<str:token>/join/", InviteJoinView.as_view(), name="invite-join"),
]
