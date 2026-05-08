import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import ActivityConfig, Badge, Book, ChildProfile, Entitlement, FavoriteBook, NotificationPreference, ReadingReminder, ReadingSession, SessionEvent, SessionParticipant, SessionSnapshot, UserBadge

User = get_user_model()


class HomePageTests(TestCase):
    def test_home_page_loads(self):
        response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Django project is running")


class SuperAdminDashboardTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            username="superadmin",
            email="superadmin@example.com",
            password="strong-password-123",
            is_staff=True,
            is_superuser=True,
        )
        self.parent_user = User.objects.create_user(
            username="dashboardparent",
            email="dashboardparent@example.com",
            password="strong-password-123",
        )
        child = ChildProfile.objects.create(user=self.parent_user, display_name="Noah", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(
            title="Dashboard Story",
            slug="dashboard-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
            page_count=10,
        )
        ReadingSession.objects.create(book=book, child_profile=child, created_by=self.parent_user)

    def test_super_admin_dashboard_requires_staff_login(self):
        response = self.client.get(reverse("super_admin_dashboard"))

        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response.url)

    def test_admin_login_page_uses_dashboard_theme_and_validation(self):
        response = self.client.get(reverse("admin:login"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Sign In")
        self.assertContains(response, "Use your admin username and password.")
        self.assertContains(response, "core/css/tailwind.css")
        self.assertContains(response, 'data-validate-form="admin-login-form"')

    def test_public_login_page_renders_login_and_signup_form(self):
        response = self.client.get("/login/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Login or create your account")
        self.assertContains(response, "Create account")
        self.assertContains(response, 'data-validate-form="login-form"')
        self.assertContains(response, 'data-validate-form="signup-form"')
        self.assertContains(response, 'data-match-field="id_signup_password"')

    def test_user_can_sign_up_through_public_auth_form(self):
        response = self.client.post(
            "/login/",
            data={
                "action": "signup",
                "first_name": "Ava",
                "last_name": "Stone",
                "username": "avastone",
                "email": "ava@example.com",
                "password": "StrongPass123!",
                "confirm_password": "StrongPass123!",
            },
            follow=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(User.objects.filter(username="avastone", email="ava@example.com").exists())
        self.assertTrue(response.wsgi_request.user.is_authenticated)

    def test_user_can_log_in_through_public_auth_form(self):
        response = self.client.post(
            "/login/",
            data={
                "action": "login",
                "username": "dashboardparent",
                "password": "strong-password-123",
            },
            follow=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.wsgi_request.user.is_authenticated)
        self.assertEqual(response.wsgi_request.user.username, "dashboardparent")

    def test_staff_user_can_log_in_through_admin_login_form(self):
        response = self.client.post(
            reverse("admin:login"),
            data={
                "username": "superadmin",
                "password": "strong-password-123",
                "next": reverse("super_admin_dashboard"),
            },
            follow=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.wsgi_request.user.is_authenticated)
        self.assertContains(response, "Super Admin Dashboard")

    def test_super_admin_dashboard_renders_metrics_for_staff(self):
        self.client.force_login(self.admin_user)

        response = self.client.get(reverse("super_admin_dashboard"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Super Admin Dashboard")
        self.assertContains(response, "Total Books")
        self.assertContains(response, "core/css/tailwind.css")
        self.assertNotContains(response, "cdn.tailwindcss.com")
        self.assertContains(response, "font-awesome")


class AdminPortalPageTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            username="portaladmin",
            email="portaladmin@example.com",
            password="strong-password-123",
            is_staff=True,
            is_superuser=True,
        )
        self.parent_user = User.objects.create_user(
            username="familyuser",
            email="familyuser@example.com",
            password="strong-password-123",
            first_name="Sara",
            last_name="Miller",
        )
        self.child = ChildProfile.objects.create(
            user=self.parent_user,
            display_name="Ava",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        self.book = Book.objects.create(
            title="Portal Story",
            slug="portal-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
            page_count=12,
        )
        self.session = ReadingSession.objects.create(
            book=self.book,
            child_profile=self.child,
            created_by=self.parent_user,
            status=ReadingSession.Status.ACTIVE,
        )
        Entitlement.objects.create(
            user=self.parent_user,
            subscription_status=Entitlement.SubscriptionStatus.ACTIVE,
            plan_code="monthly-plus",
            sessions_included=20,
            sessions_remaining=12,
        )

    def test_staff_admin_pages_render(self):
        self.client.force_login(self.admin_user)

        pages = [
            (reverse("admin_session_monitor"), "Session Monitor"),
            (reverse("admin_book_library"), "Book library"),
            (reverse("admin_book_detail", args=[self.book.id]), "Book detail"),
            (reverse("admin_activity_config"), "Activity config"),
            (reverse("admin_users"), "All users"),
            (reverse("admin_subscriptions"), "Subscriptions & billing"),
            (reverse("admin_badges"), "Badge manager"),
            (reverse("admin_live_sessions"), "Live sessions"),
            (reverse("admin_logs"), "Logs & errors"),
            (reverse("admin_settings"), "Settings"),
        ]

        for url, expected_text in pages:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, expected_text)

        session_response = self.client.get(reverse("admin_session_monitor"))
        self.assertNotContains(session_response, "Platform Insights")
        self.assertNotContains(session_response, "Live Ops Active")
        self.assertNotContains(session_response, "View Logged Issues")
        self.assertContains(session_response, "portaladmin")

    def test_admin_user_detail_rejects_invalid_profile_picture(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from core.models import UserProfile

        self.client.force_login(self.admin_user)
        bad = SimpleUploadedFile("bad.exe", b"not-an-image", content_type="application/octet-stream")
        response = self.client.post(
            reverse("admin_user_detail", args=[self.parent_user.id]),
            {
                "action": "save",
                "first_name": self.parent_user.first_name,
                "last_name": self.parent_user.last_name,
                "username": self.parent_user.username,
                "email": self.parent_user.email,
                "is_active": "on",
                "avatar_file": bad,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Profile picture must be an image")
        profile = UserProfile.objects.filter(user=self.parent_user).first()
        self.assertIsNotNone(profile)
        self.assertEqual(profile.avatar_url, "")

    def test_admin_settings_save_platform_persists_portal_settings(self):
        self.client.force_login(self.admin_user)
        url = reverse("admin_settings")
        response = self.client.post(
            url,
            {
                "action": "save_platform",
                "platform_name": "Bailey QA Portal",
                "support_email": "support-qa@example.com",
                "default_from_email": "noreply-qa@example.com",
                "public_base_url": "",
            },
        )
        self.assertEqual(response.status_code, 302)
        from core.models import PortalSettings

        portal = PortalSettings.get_solo()
        self.assertEqual(portal.platform_name, "Bailey QA Portal")
        self.assertEqual(portal.support_email, "support-qa@example.com")

    def test_admin_badges_manual_grant_creates_user_badge(self):
        self.client.force_login(self.admin_user)
        badge = Badge.objects.create(
            code="manual-test-badge",
            name="Manual Test Badge",
            description="For portal grant tests.",
            trigger_type="session_completed",
            trigger_config={"milestone": 1},
            is_active=True,
        )
        url = reverse("admin_badges")
        response = self.client.post(
            url,
            {
                "action": "grant_award",
                "badge_id": str(badge.id),
                "child_profile_id": str(self.child.id),
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue(UserBadge.objects.filter(child_profile=self.child, badge=badge).exists())

        self.client.post(
            url,
            {
                "action": "grant_award",
                "badge_id": str(badge.id),
                "child_profile_id": str(self.child.id),
            },
        )
        self.assertEqual(UserBadge.objects.filter(child_profile=self.child, badge=badge).count(), 1)

    def test_admin_sign_out_posts_to_logout(self):
        self.client.force_login(self.admin_user)

        response = self.client.get(reverse("super_admin_dashboard"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f'action="{reverse("admin:logout")}"')
        self.assertContains(response, 'Sign out')

        logout_response = self.client.post(reverse("admin:logout"), follow=True)

        self.assertEqual(logout_response.status_code, 200)
        self.assertFalse(logout_response.wsgi_request.user.is_authenticated)

    def test_admin_book_library_can_create_book_from_form(self):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            reverse("admin_book_create"),
            data={
                "action": "save",
                "title": "Ocean Adventure",
                "slug": "ocean-adventure",
                "description": "A new story for the library.",
                "room_type": Book.RoomType.READING,
                "age_band": Book.AgeBand.AGE_6_8,
                "cover_image": "https://example.com/cover.jpg",
                "page_count": 16,
                "published": "on",
            },
            follow=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(Book.objects.filter(slug="ocean-adventure").exists())

    def test_activity_for_book_appears_on_activity_config_page(self):
        self.client.force_login(self.admin_user)
        ActivityConfig.objects.create(
            book=self.book,
            title="Detail Activity",
            activity_type=ActivityConfig.ActivityType.DRAWING,
            sort_order=0,
            is_active=True,
            config={
                "schema_version": "1.0",
                "activity_type": "drawing",
                "book_id": str(self.book.id),
                "ui": {"title": "Draw", "instructions": "Draw", "theme": "default"},
                "payload": {"palette": ["#000"], "brush_sizes": [2], "allow_eraser": True},
                "validation": {},
            },
        )
        response = self.client.get(reverse("admin_activity_config"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Detail Activity")
        self.assertContains(response, self.book.title)

    def test_activity_save_redirects_back_to_book_detail_with_return_to(self):
        self.client.force_login(self.admin_user)
        return_to = reverse("admin_book_detail", args=[self.book.id])
        response = self.client.post(
            reverse("admin_activity_config"),
            data={
                "action": "save",
                "book": str(self.book.id),
                "title": "Return Quiz",
                "activity_type": ActivityConfig.ActivityType.QUIZ,
                "sort_order": 1,
                "is_active": "on",
                "return_to": return_to,
                "config_json": "{}",
                "ui_title": "Return Quiz",
                "ui_instructions": "Pick one answer.",
                "ui_theme": "default",
                "quiz_question": "What color is the moon?",
                "quiz_options[]": ["Blue", "Silver"],
                "quiz_correct_index": 1,
                "quiz_reveal_mode": "instant",
            },
            follow=False,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers.get("Location"), return_to)
        self.assertTrue(ActivityConfig.objects.filter(title="Return Quiz").exists())
    def test_admin_activity_config_can_create_config_from_form(self):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            reverse("admin_activity_config"),
            data={
                "action": "save",
                "book": str(self.book.id),
                "title": "Forest Quiz",
                "activity_type": ActivityConfig.ActivityType.QUIZ,
                "sort_order": 1,
                "is_active": "on",
                "config_json": json.dumps(
                    {
                        "schema_version": "1.0",
                        "activity_type": "quiz",
                        "book_id": str(self.book.id),
                        "ui": {"title": "Forest Quiz", "instructions": "", "theme": "default"},
                        "payload": {
                            "question": "What color is the door?",
                            "options": ["Red", "Blue"],
                            "correct_index": 0,
                            "reveal_mode": "instant",
                        },
                        "validation": {},
                    }
                ),
            },
            follow=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(ActivityConfig.objects.filter(title="Forest Quiz").exists())

    def test_admin_users_api_lists_users_for_staff(self):
        self.client.force_login(self.admin_user)

        response = self.client.get("/api/v1/admin/users/")

        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.json()["meta"]["count"], 1)
        self.assertIn("plan_code", response.json()["data"][0])

    def test_admin_can_create_update_and_delete_user_from_detail_page(self):
        self.client.force_login(self.admin_user)
        create_response = self.client.post(
            reverse("admin_user_create"),
            data={
                "action": "save",
                "first_name": "New",
                "last_name": "Parent",
                "username": "newparentweb",
                "email": "newparentweb@example.com",
                "password": "StrongPass123!",
                "is_active": "on",
            },
            follow=False,
        )
        self.assertEqual(create_response.status_code, 302)
        created_user = User.objects.get(username="newparentweb")

        update_response = self.client.post(
            reverse("admin_user_detail", args=[created_user.id]),
            data={
                "action": "save",
                "first_name": "Updated",
                "last_name": "Parent",
                "username": "newparentweb",
                "email": "updatedparent@example.com",
                "is_active": "on",
            },
            follow=True,
        )
        self.assertEqual(update_response.status_code, 200)
        created_user.refresh_from_db()
        self.assertEqual(created_user.first_name, "Updated")
        self.assertEqual(created_user.email, "updatedparent@example.com")

        delete_response = self.client.post(
            reverse("admin_user_detail", args=[created_user.id]),
            data={"action": "delete"},
            follow=False,
        )
        self.assertEqual(delete_response.status_code, 302)
        self.assertFalse(User.objects.filter(id=created_user.id).exists())

    def test_admin_settings_can_toggle_and_revoke_staff_account(self):
        self.client.force_login(self.admin_user)
        staff_user = User.objects.create_user(
            username="staffops",
            email="staffops@example.com",
            password="strong-password-123",
            is_staff=True,
            is_active=True,
        )
        toggle_response = self.client.post(
            reverse("admin_settings"),
            data={"action": "toggle_admin_active", "admin_id": staff_user.id},
            follow=False,
        )
        self.assertEqual(toggle_response.status_code, 302)
        staff_user.refresh_from_db()
        self.assertFalse(staff_user.is_active)

        revoke_response = self.client.post(
            reverse("admin_settings"),
            data={"action": "revoke_admin", "admin_id": staff_user.id},
            follow=False,
        )
        self.assertEqual(revoke_response.status_code, 302)
        staff_user.refresh_from_db()
        self.assertFalse(staff_user.is_staff)

    def test_admin_crud_forms_include_client_validation_hooks(self):
        self.client.force_login(self.admin_user)

        book_response = self.client.get(reverse("admin_book_library"))
        detail_response = self.client.get(reverse("admin_book_detail", args=[self.book.id]))
        activity_response = self.client.get(reverse("admin_activity_config"))
        user_detail_response = self.client.get(reverse("admin_user_detail", args=[self.parent_user.id]))

        self.assertContains(book_response, 'View details')
        self.assertContains(book_response, 'Create activity')
        self.assertContains(detail_response, 'data-validate-form="book-form"')
        self.assertContains(detail_response, 'Book profile')
        self.assertContains(detail_response, 'cover_image_file')
        self.assertContains(detail_response, 'data-required-message="Book title is required."')
        self.assertContains(detail_response, 'data-confirm-message="Delete this book from the library?"')
        self.assertContains(activity_response, 'data-validate-form="activity-form"')
        self.assertContains(activity_response, 'novalidate')
        self.assertContains(user_detail_response, "User activity snapshot")


class AuthApiTests(TestCase):
    def test_register_endpoint_creates_user_and_returns_tokens(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            data={
                "username": "newparent",
                "email": "newparent@example.com",
                "password": "StrongPass123!",
                "first_name": "Sara",
                "last_name": "Ali",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["user"]["email"], "newparent@example.com")
        self.assertIn("access", payload["tokens"])
        self.assertTrue(User.objects.filter(username="newparent").exists())

    def test_me_endpoint_returns_profile_for_valid_jwt(self):
        User.objects.create_user(
            username="jwtparent",
            email="jwtparent@example.com",
            password="strong-password-123",
            first_name="Amina",
            last_name="Khan",
        )

        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"username": "jwtparent", "password": "strong-password-123"},
            content_type="application/json",
        )
        access_token = login_response.json()["data"]["tokens"]["access"]

        response = self.client.get("/api/v1/me/", HTTP_AUTHORIZATION=f"Bearer {access_token}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["email"], "jwtparent@example.com")
        self.assertIn("avatar_url", response.json()["data"])
        self.assertEqual(response.json()["data"]["avatar_url"], "")

    def test_login_accepts_email_in_username_field(self):
        User.objects.create_user(
            username="emailuser",
            email="emailuser@example.com",
            password="strong-password-123",
        )
        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"username": "emailuser@example.com", "password": "strong-password-123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertIn("access", login_response.json()["data"]["tokens"])


class ReportingApiTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            username="adminreport",
            email="adminreport@example.com",
            password="strong-password-123",
            is_staff=True,
        )
        self.client.force_login(self.admin_user)

    def test_admin_session_report_lists_sessions(self):
        owner = User.objects.create_user(username="owner1", email="owner1@example.com", password="strong-password-123")
        child = ChildProfile.objects.create(user=owner, display_name="Ava", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(
            title="Report Story",
            slug="report-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        session = book.sessions.create(
            child_profile=child,
            created_by=owner,
            status="completed",
            room_type="reading",
        )

        response = self.client.get("/api/v1/admin/sessions/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["meta"]["count"], 1)
        self.assertEqual(response.json()["data"][0]["id"], str(session.id))

    def test_admin_session_export_returns_csv(self):
        owner = User.objects.create_user(username="owner2", email="owner2@example.com", password="strong-password-123")
        child = ChildProfile.objects.create(user=owner, display_name="Mia", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(
            title="CSV Story",
            slug="csv-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        book.sessions.create(
            child_profile=child,
            created_by=owner,
            status="completed",
            room_type="reading",
        )

        response = self.client.get("/api/v1/admin/sessions/export/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        self.assertIn("CSV Story", response.content.decode())


class BillingApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="billingparent",
            email="billing@example.com",
            password="strong-password-123",
        )
        self.client.force_login(self.user)
        Entitlement.objects.create(
            user=self.user,
            subscription_status=Entitlement.SubscriptionStatus.ACTIVE,
            sessions_included=8,
            sessions_remaining=5,
            pack_sessions_remaining=2,
        )

    def test_entitlement_endpoint_returns_current_quota(self):
        response = self.client.get("/api/v1/billing/entitlement/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["subscription_status"], "active")
        self.assertEqual(payload["sessions_remaining"], 5)
        self.assertEqual(payload["pack_sessions_remaining"], 2)

    def test_stripe_invoice_paid_webhook_updates_entitlement(self):
        response = self.client.post(
            "/api/v1/webhooks/stripe/",
            data={
                "type": "invoice.paid",
                "data": {
                    "object": {
                        "customer": "cus_test_123",
                        "customer_email": "billing@example.com",
                        "subscription": "sub_test_123",
                        "lines": {
                            "data": [
                                {
                                    "price": {"id": "price_monthly_plus", "metadata": {"plan_code": "monthly-plus"}},
                                    "metadata": {"sessions_included": "20"},
                                }
                            ]
                        },
                    }
                },
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.user.entitlement.refresh_from_db()
        self.assertEqual(self.user.entitlement.subscription_status, Entitlement.SubscriptionStatus.ACTIVE)
        self.assertEqual(self.user.entitlement.sessions_included, 20)
        self.assertEqual(self.user.entitlement.sessions_remaining, 20)
        self.assertEqual(self.user.entitlement.plan_code, "monthly-plus")
        self.assertEqual(self.user.entitlement.stripe_customer_id, "cus_test_123")

    def test_stripe_subscription_deleted_webhook_cancels_entitlement(self):
        self.user.entitlement.plan_code = "monthly-starter"
        self.user.entitlement.stripe_customer_id = "cus_test_123"
        self.user.entitlement.stripe_subscription_id = "sub_test_123"
        self.user.entitlement.save()

        response = self.client.post(
            "/api/v1/webhooks/stripe/",
            data={
                "type": "customer.subscription.deleted",
                "data": {
                    "object": {
                        "id": "sub_test_123",
                        "customer": "cus_test_123",
                        "status": "canceled",
                    }
                },
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.user.entitlement.refresh_from_db()
        self.assertEqual(self.user.entitlement.subscription_status, Entitlement.SubscriptionStatus.CANCELLED)
        self.assertEqual(self.user.entitlement.sessions_remaining, 0)


class ApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="parent1",
            email="parent@example.com",
            password="strong-password-123",
        )
        self.other_user = User.objects.create_user(
            username="parent2",
            email="parent2@example.com",
            password="strong-password-123",
        )
        self.client.force_login(self.user)
        Entitlement.objects.create(
            user=self.user,
            subscription_status=Entitlement.SubscriptionStatus.ACTIVE,
            sessions_included=4,
            sessions_remaining=3,
        )

    def test_books_api_lists_only_published_books(self):
        Book.objects.create(
            title="Published Story",
            slug="published-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        Book.objects.create(
            title="Hidden Story",
            slug="hidden-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=False,
        )

        response = self.client.get("/api/v1/books/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 1)
        self.assertEqual(response.json()["data"][0]["title"], "Published Story")

    def test_child_detail_endpoint_returns_owned_profile(self):
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Ella",
            age_band=ChildProfile.AgeBand.AGE_3_5,
            avatar_url="https://example.com/ella.png",
        )

        response = self.client.get(f"/api/v1/children/{child.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["display_name"], "Ella")

    def test_child_update_endpoint_updates_owned_profile(self):
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Ava",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.patch(
            f"/api/v1/children/{child.id}/",
            data={"display_name": "Ava Rose", "avatar_url": "https://example.com/ava-rose.png"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        child.refresh_from_db()
        self.assertEqual(child.display_name, "Ava Rose")
        self.assertEqual(child.avatar_url, "https://example.com/ava-rose.png")

    def test_child_delete_endpoint_soft_deactivates_profile(self):
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Noor",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.delete(f"/api/v1/children/{child.id}/")

        self.assertEqual(response.status_code, 204)
        child.refresh_from_db()
        self.assertFalse(child.is_active)

    def test_child_endpoints_reject_other_users_profile(self):
        other_child = ChildProfile.objects.create(
            user=self.other_user,
            display_name="Other Kid",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.get(f"/api/v1/children/{other_child.id}/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")

    def test_sessions_api_creates_session_with_invite_token(self):
        book = Book.objects.create(
            title="Bedtime Moon",
            slug="bedtime-moon",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Ava",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], "pending")
        self.assertTrue(payload["invite_token"])
        self.user.entitlement.refresh_from_db()
        self.assertEqual(self.user.entitlement.sessions_remaining, 2)

    def test_session_creation_consumes_pack_credit_when_subscription_empty(self):
        self.user.entitlement.sessions_remaining = 0
        self.user.entitlement.pack_sessions_remaining = 2
        self.user.entitlement.save()

        book = Book.objects.create(
            title="Pack Credit Story",
            slug="pack-credit-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Packy",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )

        self.assertEqual(response.status_code, 201)
        self.user.entitlement.refresh_from_db()
        self.assertEqual(self.user.entitlement.sessions_remaining, 0)
        self.assertEqual(self.user.entitlement.pack_sessions_remaining, 1)

    def test_sessions_api_requires_available_entitlement(self):
        self.user.entitlement.sessions_remaining = 0
        self.user.entitlement.pack_sessions_remaining = 0
        self.user.entitlement.save()

        book = Book.objects.create(
            title="No Credits Story",
            slug="no-credits-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Leo",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "no_entitlement")

    def test_sessions_api_creates_missing_entitlement_record_when_needed(self):
        self.client.force_login(self.other_user)
        book = Book.objects.create(
            title="Missing Entitlement Story",
            slug="missing-entitlement-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.other_user,
            display_name="Lio",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )

        response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "no_entitlement")
        self.assertTrue(Entitlement.objects.filter(user=self.other_user).exists())

    def test_invite_join_returns_guest_realtime_token(self):
        book = Book.objects.create(
            title="Join Story",
            slug="join-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Mia",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        invite_token = create_response.json()["data"]["invite_token"]

        join_response = self.client.post(
            f"/api/v1/invites/{invite_token}/join/",
            data={"display_name": "Grandma Noor"},
            content_type="application/json",
        )

        self.assertEqual(join_response.status_code, 200)
        payload = join_response.json()["data"]
        self.assertEqual(payload["participant"]["display_name"], "Grandma Noor")
        self.assertTrue(payload["realtime_token"])

    @override_settings(
        LIVEKIT_API_KEY="unit-test-livekit-key",
        LIVEKIT_API_SECRET="unit-test-livekit-secret-with-sufficient-length-123456",
        LIVEKIT_URL="wss://example.livekit.cloud",
    )
    def test_reconnect_token_endpoint_returns_fresh_token_for_participant(self):
        book = Book.objects.create(
            title="Reconnect Story",
            slug="reconnect-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Eli",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()

        reconnect_response = self.client.post(
            f"/api/v1/sessions/{session_id}/reconnect-token/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        self.assertEqual(reconnect_response.status_code, 200)
        realtime_token = reconnect_response.json()["data"]["realtime_token"]
        self.assertTrue(realtime_token)
        self.assertEqual(realtime_token.count("."), 2)
        self.assertEqual(reconnect_response.json()["data"]["room_name"], SessionParticipant.objects.get(id=participant.id).session.livekit_room_name)

    def test_ready_endpoint_marks_participant_ready_and_updates_session_lobby(self):
        book = Book.objects.create(
            title="Lobby Story",
            slug="lobby-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Nora",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()

        ready_response = self.client.post(
            f"/api/v1/sessions/{session_id}/ready/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        self.assertEqual(ready_response.status_code, 200)
        self.assertEqual(ready_response.json()["data"]["status"], "lobby")
        participant.refresh_from_db()
        self.assertIsNotNone(participant.ready_at)

    def test_host_can_start_session_after_ready_check(self):
        book = Book.objects.create(
            title="Start Story",
            slug="start-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Zara",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()
        self.client.post(
            f"/api/v1/sessions/{session_id}/ready/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        start_response = self.client.post(
            f"/api/v1/sessions/{session_id}/start/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        self.assertEqual(start_response.status_code, 200)
        self.assertEqual(start_response.json()["data"]["status"], "active")

    def test_complete_session_awards_first_session_badge(self):
        badge = Badge.objects.create(
            code="first-session",
            name="First Session",
            trigger_type="session_completed",
            trigger_config={"milestone": 1},
            is_active=True,
        )
        book = Book.objects.create(
            title="Completion Story",
            slug="completion-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Lily",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()
        self.client.post(
            f"/api/v1/sessions/{session_id}/ready/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )
        self.client.post(
            f"/api/v1/sessions/{session_id}/start/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        complete_response = self.client.post(
            f"/api/v1/sessions/{session_id}/complete/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        self.assertEqual(complete_response.status_code, 200)
        self.assertEqual(complete_response.json()["data"]["status"], "completed")
        self.assertTrue(UserBadge.objects.filter(child_profile=child, badge=badge).exists())

    def test_snapshot_endpoint_persists_session_state(self):
        book = Book.objects.create(
            title="Snapshot Story",
            slug="snapshot-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
            page_count=10,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Milo",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()

        snapshot_response = self.client.put(
            f"/api/v1/sessions/{session_id}/snapshot/",
            data={
                "participant_id": str(participant.id),
                "current_page": 4,
                "timer_remaining_seconds": 880,
                "annotation_state": {"strokes": [{"x": 12, "y": 18}]},
                "activity_state": {"selected": ["star"]},
            },
            content_type="application/json",
        )

        self.assertEqual(snapshot_response.status_code, 200)
        snapshot = SessionSnapshot.objects.get(session_id=session_id)
        self.assertEqual(snapshot.page_number, 4)
        self.assertEqual(snapshot.timer_state["remaining_seconds"], 880)

    def test_snapshot_restore_endpoint_returns_last_saved_state(self):
        book = Book.objects.create(
            title="Restore Story",
            slug="restore-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
            page_count=12,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Noah",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={
                "book_id": str(book.id),
                "child_profile_id": str(child.id),
                "room_type": "reading",
            },
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()
        SessionSnapshot.objects.create(
            session_id=session_id,
            page_number=6,
            timer_state={"remaining_seconds": 700},
            annotation_state={"strokes": [{"x": 40, "y": 20}]},
            activity_state={"selected": ["moon"]},
        )

        restore_response = self.client.get(
            f"/api/v1/sessions/{session_id}/snapshot/",
            data={"participant_id": str(participant.id)},
        )

        self.assertEqual(restore_response.status_code, 200)
        payload = restore_response.json()["data"]
        self.assertEqual(payload["page_number"], 6)
        self.assertEqual(payload["timer_state"]["remaining_seconds"], 700)

    def test_session_participants_endpoint_lists_host_and_guest(self):
        book = Book.objects.create(
            title="Roster Story",
            slug="roster-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Lara",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={"book_id": str(book.id), "child_profile_id": str(child.id), "room_type": "reading"},
        )
        session_id = create_response.json()["data"]["id"]
        invite_token = create_response.json()["data"]["invite_token"]
        self.client.post(
            f"/api/v1/invites/{invite_token}/join/",
            data={"display_name": "Grandad Joe"},
            content_type="application/json",
        )

        response = self.client.get(f"/api/v1/sessions/{session_id}/participants/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["meta"]["count"], 2)
        self.assertIn("Grandad Joe", [item["display_name"] for item in response.json()["data"]])

    def test_session_events_endpoint_returns_timeline(self):
        book = Book.objects.create(
            title="Events Story",
            slug="events-story",
            room_type=Book.RoomType.HYBRID,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Tia",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={"book_id": str(book.id), "child_profile_id": str(child.id), "room_type": "reading"},
        )
        session_id = create_response.json()["data"]["id"]
        participant = SessionParticipant.objects.filter(session_id=session_id, user=self.user).first()
        self.client.post(
            f"/api/v1/sessions/{session_id}/ready/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )
        self.client.post(
            f"/api/v1/sessions/{session_id}/start/",
            data={"participant_id": str(participant.id)},
            content_type="application/json",
        )

        response = self.client.get(f"/api/v1/sessions/{session_id}/events/")

        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.json()["meta"]["count"], 2)
        self.assertIn(SessionEvent.EventType.STARTED, [item["event_type"] for item in response.json()["data"]])

    def test_session_cancel_endpoint_marks_session_cancelled(self):
        book = Book.objects.create(
            title="Cancel Story",
            slug="cancel-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Nia",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={"book_id": str(book.id), "child_profile_id": str(child.id), "room_type": "reading"},
        )
        session_id = create_response.json()["data"]["id"]

        response = self.client.post(f"/api/v1/sessions/{session_id}/cancel/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "cancelled")
        self.assertTrue(ReadingSession.objects.filter(id=session_id, status=ReadingSession.Status.CANCELLED).exists())

    def test_session_invite_detail_returns_current_invite_settings(self):
        book = Book.objects.create(
            title="Invite Detail Story",
            slug="invite-detail-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Nina",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={"book_id": str(book.id), "child_profile_id": str(child.id), "room_type": "reading"},
        )
        session_id = create_response.json()["data"]["id"]

        response = self.client.get(f"/api/v1/sessions/{session_id}/invite/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["max_uses"], 50)
        self.assertFalse(response.json()["data"]["host_role_granted"])
        self.assertTrue(response.json()["data"]["token"])

    def test_session_invite_update_allows_host_role_guest_join(self):
        book = Book.objects.create(
            title="Invite Update Story",
            slug="invite-update-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Tara",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={"book_id": str(book.id), "child_profile_id": str(child.id), "room_type": "reading"},
        )
        session_id = create_response.json()["data"]["id"]
        invite_token = create_response.json()["data"]["invite_token"]

        update_response = self.client.patch(
            f"/api/v1/sessions/{session_id}/invite/",
            data={"host_role_granted": True, "max_uses": 2},
            content_type="application/json",
        )
        join_response = self.client.post(
            f"/api/v1/invites/{invite_token}/join/",
            data={"display_name": "Auntie Bee"},
            content_type="application/json",
        )

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["data"]["max_uses"], 2)
        self.assertTrue(update_response.json()["data"]["host_role_granted"])
        self.assertEqual(join_response.status_code, 200)
        self.assertEqual(join_response.json()["data"]["participant"]["session_role"], "host")

    def test_session_invite_regenerate_replaces_old_token(self):
        book = Book.objects.create(
            title="Invite Regen Story",
            slug="invite-regen-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        child = ChildProfile.objects.create(
            user=self.user,
            display_name="Rey",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        create_response = self.client.post(
            "/api/v1/sessions/",
            data={"book_id": str(book.id), "child_profile_id": str(child.id), "room_type": "reading"},
        )
        session_id = create_response.json()["data"]["id"]
        old_token = create_response.json()["data"]["invite_token"]

        regenerate_response = self.client.post(f"/api/v1/sessions/{session_id}/invite/regenerate/")
        new_token = regenerate_response.json()["data"]["token"]
        old_join_response = self.client.post(
            f"/api/v1/invites/{old_token}/join/",
            data={"display_name": "Old Link User"},
            content_type="application/json",
        )

        self.assertEqual(regenerate_response.status_code, 200)
        self.assertNotEqual(new_token, old_token)
        self.assertEqual(old_join_response.status_code, 410)


class ActivityConfigApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="storyparent",
            email="storyparent@example.com",
            password="strong-password-123",
        )
        self.admin_user = User.objects.create_user(
            username="contentadmin",
            email="contentadmin@example.com",
            password="strong-password-123",
            is_staff=True,
        )
        self.book = Book.objects.create(
            title="Activity Story",
            slug="activity-story",
            room_type=Book.RoomType.ACTIVITY,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )

    def _quiz_cfg(self, question="Pick the moon", sort_title=True):
        return {
            "schema_version": "1.0",
            "activity_type": "quiz",
            "book_id": str(self.book.id),
            "ui": {"title": "Quiz", "instructions": "", "theme": "default"},
            "payload": {
                "question": question,
                "options": ["Moon", "Sun"],
                "correct_index": 0,
                "reveal_mode": "instant",
            },
            "validation": {},
        }

    def _drawing_cfg(self):
        return {
            "schema_version": "1.0",
            "activity_type": "drawing",
            "book_id": str(self.book.id),
            "ui": {"title": "Draw", "instructions": "", "theme": "default"},
            "payload": {"palette": ["#000000", "#ff0000"], "brush_sizes": [4, 8], "allow_eraser": True},
            "validation": {},
        }

    def test_book_activity_list_returns_active_configs_in_order(self):
        ActivityConfig.objects.create(
            book=self.book,
            title="Second Quiz",
            activity_type=ActivityConfig.ActivityType.QUIZ,
            config=self._quiz_cfg(),
            sort_order=2,
            is_active=True,
        )
        ActivityConfig.objects.create(
            book=self.book,
            title="Hidden Drawing",
            activity_type=ActivityConfig.ActivityType.DRAWING,
            config=self._drawing_cfg(),
            sort_order=1,
            is_active=False,
        )
        ActivityConfig.objects.create(
            book=self.book,
            title="First Drawing",
            activity_type=ActivityConfig.ActivityType.DRAWING,
            config=self._drawing_cfg(),
            sort_order=0,
            is_active=True,
        )
        self.client.force_login(self.user)

        response = self.client.get(f"/api/v1/books/{self.book.id}/activities/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["meta"]["count"], 2)
        self.assertEqual([item["title"] for item in payload["data"]], ["First Drawing", "Second Quiz"])
        for item in payload["data"]:
            self.assertEqual(item["config"]["schema_version"], "1.0")
            self.assertEqual(item["config"]["activity_type"], item["activity_type"])

    def test_admin_can_create_activity_config_with_valid_payload(self):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            "/api/v1/admin/activities/",
            data={
                "book": str(self.book.id),
                "title": "Sort the Stars",
                "activity_type": "drag_drop",
                "config": {
                    "schema_version": "1.0",
                    "activity_type": "drag_drop",
                    "book_id": str(self.book.id),
                    "ui": {"title": "Sort", "instructions": "", "theme": "default"},
                    "payload": {"items": ["star"], "drop_zones": ["sky"]},
                    "validation": {},
                },
                "sort_order": 3,
                "is_active": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["title"], "Sort the Stars")
        self.assertTrue(ActivityConfig.objects.filter(book=self.book, title="Sort the Stars").exists())

    def test_admin_create_rejects_invalid_activity_config(self):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            "/api/v1/admin/activities/",
            data={
                "book": str(self.book.id),
                "title": "Broken Quiz",
                "activity_type": "quiz",
                "config": {"question": "Missing answer options"},
                "sort_order": 1,
                "is_active": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("config", response.json())

    def test_admin_create_rejects_missing_schema_version(self):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            "/api/v1/admin/activities/",
            data={
                "book": str(self.book.id),
                "title": "No Schema",
                "activity_type": "quiz",
                "config": {
                    "activity_type": "quiz",
                    "book_id": str(self.book.id),
                    "ui": {"title": "x", "instructions": "", "theme": "default"},
                    "payload": {
                        "question": "Q?",
                        "options": ["A", "B"],
                        "correct_index": 0,
                        "reveal_mode": "instant",
                    },
                },
                "sort_order": 1,
                "is_active": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("config", response.json())

    def test_model_save_rejects_invalid_config(self):
        with self.assertRaises(ValidationError):
            ActivityConfig.objects.create(
                book=self.book,
                title="Bad",
                activity_type=ActivityConfig.ActivityType.QUIZ,
                config={
                    "schema_version": "1.0",
                    "activity_type": "quiz",
                    "book_id": str(self.book.id),
                    "ui": {"title": "x", "instructions": "", "theme": "default"},
                    "payload": {"question": "Incomplete"},
                },
                sort_order=0,
                is_active=True,
            )

    def test_admin_can_update_and_delete_activity_config(self):
        activity = ActivityConfig.objects.create(
            book=self.book,
            title="Old Name",
            activity_type=ActivityConfig.ActivityType.DRAWING,
            config=self._drawing_cfg(),
            sort_order=1,
            is_active=True,
        )
        self.client.force_login(self.admin_user)

        new_cfg = self._drawing_cfg()
        new_cfg["payload"] = {
            "palette": ["#111111", "#eeeeee"],
            "brush_sizes": [2, 6],
            "allow_eraser": False,
        }

        update_response = self.client.patch(
            f"/api/v1/admin/activities/{activity.id}/",
            data={"title": "Updated Name", "config": new_cfg},
            content_type="application/json",
        )

        self.assertEqual(update_response.status_code, 200)
        activity.refresh_from_db()
        self.assertEqual(activity.title, "Updated Name")
        self.assertEqual(activity.config["payload"]["palette"], ["#111111", "#eeeeee"])

        delete_response = self.client.delete(f"/api/v1/admin/activities/{activity.id}/")

        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(ActivityConfig.objects.filter(id=activity.id).exists())


class ProgressApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="progressparent",
            email="progressparent@example.com",
            password="strong-password-123",
        )
        self.other_user = User.objects.create_user(
            username="otherparent",
            email="otherparent@example.com",
            password="strong-password-123",
        )
        self.child = ChildProfile.objects.create(
            user=self.user,
            display_name="Ivy",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        self.other_child = ChildProfile.objects.create(
            user=self.other_user,
            display_name="Max",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        self.book = Book.objects.create(
            title="Progress Story",
            slug="progress-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        self.client.force_login(self.user)

    def test_dashboard_endpoint_returns_family_summary(self):
        ReadingSession.objects.create(
            book=self.book,
            child_profile=self.child,
            created_by=self.user,
            status=ReadingSession.Status.ACTIVE,
            room_type=ReadingSession.RoomType.READING,
        )
        completed_session = ReadingSession.objects.create(
            book=self.book,
            child_profile=self.child,
            created_by=self.user,
            status=ReadingSession.Status.COMPLETED,
            room_type=ReadingSession.RoomType.READING,
        )
        badge = Badge.objects.create(
            code="progress-pro",
            name="Progress Pro",
            trigger_type="session_completed",
            trigger_config={"milestone": 1},
            is_active=True,
        )
        UserBadge.objects.create(child_profile=self.child, badge=badge, session=completed_session)

        response = self.client.get("/api/v1/dashboard/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["children_count"], 1)
        self.assertEqual(payload["completed_sessions_count"], 1)
        self.assertEqual(payload["active_sessions_count"], 1)
        self.assertEqual(payload["badges_count"], 1)
        self.assertEqual(len(payload["recent_sessions"]), 2)
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_child_progress_endpoint_returns_history_and_badges(self):
        completed_session = ReadingSession.objects.create(
            book=self.book,
            child_profile=self.child,
            created_by=self.user,
            status=ReadingSession.Status.COMPLETED,
            room_type=ReadingSession.RoomType.READING,
        )
        ReadingSession.objects.create(
            book=self.book,
            child_profile=self.other_child,
            created_by=self.other_user,
            status=ReadingSession.Status.COMPLETED,
            room_type=ReadingSession.RoomType.READING,
        )
        badge = Badge.objects.create(
            code="first-progress",
            name="First Progress",
            trigger_type="session_completed",
            trigger_config={"milestone": 1},
            is_active=True,
        )
        UserBadge.objects.create(child_profile=self.child, badge=badge, session=completed_session)

        response = self.client.get(f"/api/v1/children/{self.child.id}/progress/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["child"]["display_name"], "Ivy")
        self.assertEqual(payload["completed_sessions_count"], 1)
        self.assertEqual(payload["badges"][0]["code"], "first-progress")
        self.assertEqual(payload["recent_sessions"][0]["book_title"], "Progress Story")
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_child_progress_requires_child_ownership(self):
        response = self.client.get(f"/api/v1/children/{self.other_child.id}/progress/")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")


class AdminBookApiTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            username="bookadmin",
            email="bookadmin@example.com",
            password="strong-password-123",
            is_staff=True,
        )
        self.parent_user = User.objects.create_user(
            username="regularparent",
            email="regularparent@example.com",
            password="strong-password-123",
        )

    def test_admin_can_create_book_via_api(self):
        self.client.force_login(self.admin_user)

        response = self.client.post(
            "/api/v1/admin/books/",
            data={
                "title": "New Admin Story",
                "slug": "new-admin-story",
                "description": "A new content item",
                "room_type": "reading",
                "age_band": "3-5",
                "cover_image": "https://example.com/cover.png",
                "published": True,
                "page_count": 14,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["slug"], "new-admin-story")
        self.assertTrue(Book.objects.filter(slug="new-admin-story", published=True).exists())

    def test_admin_can_update_and_delete_book(self):
        book = Book.objects.create(
            title="Draft Story",
            slug="draft-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=False,
            page_count=8,
        )
        self.client.force_login(self.admin_user)

        update_response = self.client.patch(
            f"/api/v1/admin/books/{book.id}/",
            data={"published": True, "title": "Published Story"},
            content_type="application/json",
        )

        self.assertEqual(update_response.status_code, 200)
        book.refresh_from_db()
        self.assertEqual(book.title, "Published Story")
        self.assertTrue(book.published)

        delete_response = self.client.delete(f"/api/v1/admin/books/{book.id}/")

        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(Book.objects.filter(id=book.id).exists())

    def test_non_admin_cannot_create_book_via_admin_api(self):
        self.client.force_login(self.parent_user)

        response = self.client.post(
            "/api/v1/admin/books/",
            data={
                "title": "Blocked Story",
                "slug": "blocked-story",
                "room_type": "reading",
                "age_band": "3-5",
                "published": True,
                "page_count": 10,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)


class TransferHostApiTests(TestCase):
    def setUp(self):
        self.host_user = User.objects.create_user(username="transferhost", email="transferhost@example.com", password="pw")
        self.guest_user = User.objects.create_user(username="transferguest", email="transferguest@example.com", password="pw")
        self.book = Book.objects.create(title="Transfer Story", slug="transfer-story", room_type=Book.RoomType.READING, age_band=Book.AgeBand.AGE_3_5, published=True)
        self.child = ChildProfile.objects.create(user=self.host_user, display_name="Jamie", age_band=ChildProfile.AgeBand.AGE_3_5)
        Entitlement.objects.create(user=self.host_user, subscription_status=Entitlement.SubscriptionStatus.ACTIVE, sessions_included=4, sessions_remaining=3)
        self.session = ReadingSession.objects.create(book=self.book, child_profile=self.child, created_by=self.host_user, status=ReadingSession.Status.ACTIVE, room_type=ReadingSession.RoomType.READING)
        self.host_participant = SessionParticipant.objects.create(session=self.session, user=self.host_user, display_name="Host", session_role=SessionParticipant.SessionRole.HOST, participant_type=SessionParticipant.ParticipantType.REGISTERED)
        self.guest_participant = SessionParticipant.objects.create(session=self.session, user=self.guest_user, display_name="Guest", session_role=SessionParticipant.SessionRole.PARTICIPANT, participant_type=SessionParticipant.ParticipantType.REGISTERED)
        self.client.force_login(self.host_user)

    def test_host_can_transfer_host_role_to_guest(self):
        response = self.client.post(
            f"/api/v1/sessions/{self.session.id}/transfer-host/",
            data={"current_participant_id": str(self.host_participant.id), "new_participant_id": str(self.guest_participant.id)},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.guest_participant.refresh_from_db()
        self.host_participant.refresh_from_db()
        self.assertEqual(self.guest_participant.session_role, SessionParticipant.SessionRole.HOST)
        self.assertEqual(self.host_participant.session_role, SessionParticipant.SessionRole.PARTICIPANT)

    def test_transfer_host_rejects_non_host_caller(self):
        self.client.force_login(self.guest_user)
        response = self.client.post(
            f"/api/v1/sessions/{self.session.id}/transfer-host/",
            data={"current_participant_id": str(self.host_participant.id), "new_participant_id": str(self.guest_participant.id)},
            content_type="application/json",
        )
        self.assertIn(response.status_code, [403, 400])


class GuestTokenApiTests(TestCase):
    def setUp(self):
        self.host_user = User.objects.create_user(username="guestokenhost", email="guestokenhost@example.com", password="pw")
        self.book = Book.objects.create(title="Guest Token Story", slug="guest-token-story", room_type=Book.RoomType.READING, age_band=Book.AgeBand.AGE_3_5, published=True)
        self.child = ChildProfile.objects.create(user=self.host_user, display_name="Sam", age_band=ChildProfile.AgeBand.AGE_3_5)
        Entitlement.objects.create(user=self.host_user, subscription_status=Entitlement.SubscriptionStatus.ACTIVE, sessions_included=4, sessions_remaining=3)
        self.session = ReadingSession.objects.create(book=self.book, child_profile=self.child, created_by=self.host_user, status=ReadingSession.Status.ACTIVE, room_type=ReadingSession.RoomType.READING)
        self.guest_participant = SessionParticipant.objects.create(session=self.session, user=None, display_name="Guest Reader", session_role=SessionParticipant.SessionRole.PARTICIPANT, participant_type=SessionParticipant.ParticipantType.GUEST)

    def test_guest_token_endpoint_returns_token_for_valid_participant(self):
        response = self.client.get(f"/api/v1/sessions/{self.session.id}/token/?participant_id={self.guest_participant.id}")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("realtime_token", data)
        self.assertIn("room_name", data)

    def test_guest_token_returns_error_for_unknown_participant(self):
        import uuid
        response = self.client.get(f"/api/v1/sessions/{self.session.id}/token/?participant_id={uuid.uuid4()}")
        self.assertIn(response.status_code, [400, 403, 404])


class AdminEntitlementApiTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="entadmin", email="entadmin@example.com", password="pw", is_staff=True)
        self.parent_user = User.objects.create_user(username="entparent", email="entparent@example.com", password="pw")
        Entitlement.objects.create(user=self.parent_user, subscription_status=Entitlement.SubscriptionStatus.ACTIVE, sessions_included=8, sessions_remaining=8)
        self.client.force_login(self.admin_user)

    def test_admin_can_patch_entitlement_sessions_remaining(self):
        response = self.client.patch(
            f"/api/v1/admin/entitlements/{self.parent_user.id}/",
            data={"sessions_remaining": 20},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.parent_user.entitlement.refresh_from_db()
        self.assertEqual(self.parent_user.entitlement.sessions_remaining, 20)

    def test_non_admin_cannot_patch_entitlement(self):
        self.client.force_login(self.parent_user)
        response = self.client.patch(
            f"/api/v1/admin/entitlements/{self.parent_user.id}/",
            data={"sessions_remaining": 999},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class SessionEventExportApiTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(username="eventexportadmin", email="eventexportadmin@example.com", password="pw", is_staff=True)
        self.parent_user = User.objects.create_user(username="eventexportparent", email="eventexportparent@example.com", password="pw")
        self.book = Book.objects.create(title="Export Story", slug="export-story", room_type=Book.RoomType.READING, age_band=Book.AgeBand.AGE_3_5, published=True)
        self.child = ChildProfile.objects.create(user=self.parent_user, display_name="Leo", age_band=ChildProfile.AgeBand.AGE_3_5)
        self.session = ReadingSession.objects.create(book=self.book, child_profile=self.child, created_by=self.parent_user, status=ReadingSession.Status.COMPLETED, room_type=ReadingSession.RoomType.READING)
        SessionEvent.objects.create(session=self.session, event_type="completed", payload={})
        self.client.force_login(self.admin_user)

    def test_admin_event_export_returns_csv(self):
        response = self.client.get("/api/v1/admin/events/export/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response["Content-Type"])
        content = response.content.decode()
        self.assertIn("session_id", content)
        self.assertIn("completed", content)

    def test_non_admin_cannot_export_events(self):
        self.client.force_login(self.parent_user)
        response = self.client.get("/api/v1/admin/events/export/")
        self.assertEqual(response.status_code, 403)

class BadgeApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="badgeparent",
            email="badgeparent@example.com",
            password="strong-password-123",
        )
        self.admin_user = User.objects.create_user(
            username="badgeadmin",
            email="badgeadmin@example.com",
            password="strong-password-123",
            is_staff=True,
        )

    def test_badges_endpoint_lists_only_active_badges(self):
        Badge.objects.create(
            code="star-reader",
            name="Star Reader",
            description="Awarded for reading well",
            trigger_type="session_completed",
            trigger_config={"milestone": 1},
            is_active=True,
        )
        Badge.objects.create(
            code="hidden-badge",
            name="Hidden Badge",
            trigger_type="session_completed",
            trigger_config={"milestone": 99},
            is_active=False,
        )
        self.client.force_login(self.user)

        response = self.client.get("/api/v1/badges/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["meta"]["count"], 1)
        self.assertEqual(response.json()["data"][0]["code"], "star-reader")
        row = response.json()["data"][0]
        self.assertNotIn("trigger_config", row)
        self.assertNotIn("trigger_type", row)
        self.assertNotIn("is_active", row)
        self.assertIn("description", row)

    def test_me_badges_only_includes_own_children_awards(self):
        user_a = User.objects.create_user(username="parenta", email="a@example.com", password="strong-password-123")
        user_b = User.objects.create_user(username="parentb", email="b@example.com", password="strong-password-123")
        child_b = ChildProfile.objects.create(user=user_b, display_name="KidB", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(
            title="Shared Book",
            slug="shared-book-badges",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        sess = ReadingSession.objects.create(
            book=book,
            child_profile=child_b,
            created_by=user_b,
            status=ReadingSession.Status.COMPLETED,
            room_type=ReadingSession.RoomType.READING,
        )
        badge = Badge.objects.create(
            code="other-family",
            name="Other",
            trigger_type="session_completed",
            trigger_config={"milestone": 1},
            is_active=True,
        )
        UserBadge.objects.create(child_profile=child_b, badge=badge, session=sess)

        self.client.force_login(user_a)
        r = self.client.get("/api/v1/me/badges/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["meta"]["count"], 0)
        self.assertEqual(r["Cache-Control"], "private, no-store")

        self.client.force_login(user_b)
        r2 = self.client.get("/api/v1/me/badges/")
        self.assertEqual(r2.json()["meta"]["count"], 1)
        self.assertEqual(r2["Cache-Control"], "private, no-store")

    def test_admin_can_create_update_and_delete_badge(self):
        self.client.force_login(self.admin_user)

        create_response = self.client.post(
            "/api/v1/admin/badges/",
            data={
                "code": "story-explorer",
                "name": "Story Explorer",
                "description": "Explored multiple stories",
                "trigger_type": "session_completed",
                "trigger_config": {"milestone": 3},
                "is_active": True,
            },
            content_type="application/json",
        )

        self.assertEqual(create_response.status_code, 201)
        badge_id = create_response.json()["data"]["id"]

        update_response = self.client.patch(
            f"/api/v1/admin/badges/{badge_id}/",
            data={"name": "Story Explorer Plus"},
            content_type="application/json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["data"]["name"], "Story Explorer Plus")

        delete_response = self.client.delete(f"/api/v1/admin/badges/{badge_id}/")
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(Badge.objects.filter(id=badge_id).exists())

    def test_non_admin_cannot_manage_badges(self):
        self.client.force_login(self.user)

        response = self.client.post(
            "/api/v1/admin/badges/",
            data={
                "code": "blocked-badge",
                "name": "Blocked Badge",
                "trigger_type": "session_completed",
                "trigger_config": {"milestone": 1},
                "is_active": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)


class RecommendationApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="recommendparent",
            email="recommendparent@example.com",
            password="strong-password-123",
        )
        self.other_user = User.objects.create_user(
            username="otherrecommendparent",
            email="otherrecommendparent@example.com",
            password="strong-password-123",
        )
        self.child = ChildProfile.objects.create(
            user=self.user,
            display_name="Mimi",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        self.other_child = ChildProfile.objects.create(
            user=self.other_user,
            display_name="Zed",
            age_band=ChildProfile.AgeBand.AGE_9_12,
        )
        self.client.force_login(self.user)

    def test_recommended_books_endpoint_matches_child_age_band(self):
        Book.objects.create(
            title="Tiny Readers",
            slug="tiny-readers",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        Book.objects.create(
            title="Big Kids Only",
            slug="big-kids-only",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_9_12,
            published=True,
        )

        response = self.client.get(f"/api/v1/recommendations/books/?child_profile_id={self.child.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["meta"]["count"], 1)
        self.assertEqual(response.json()["data"][0]["title"], "Tiny Readers")

    def test_recommended_books_rejects_other_users_child(self):
        response = self.client.get(f"/api/v1/recommendations/books/?child_profile_id={self.other_child.id}")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")


class FavoriteBookApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="favoriteparent",
            email="favoriteparent@example.com",
            password="strong-password-123",
        )
        self.client.force_login(self.user)

    def test_favorite_books_can_be_added_and_listed(self):
        book = Book.objects.create(
            title="Favourite Story",
            slug="favourite-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )

        add_response = self.client.post(
            "/api/v1/library/favorites/",
            data={"book_id": str(book.id)},
            content_type="application/json",
        )
        list_response = self.client.get("/api/v1/library/favorites/")

        self.assertEqual(add_response.status_code, 201)
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["meta"]["count"], 1)
        self.assertEqual(list_response.json()["data"][0]["book"]["title"], "Favourite Story")

    def test_favorite_book_can_be_removed(self):
        book = Book.objects.create(
            title="Removable Story",
            slug="removable-story",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=True,
        )
        self.client.post(
            "/api/v1/library/favorites/",
            data={"book_id": str(book.id)},
            content_type="application/json",
        )

        delete_response = self.client.delete(f"/api/v1/library/favorites/{book.id}/")
        list_response = self.client.get("/api/v1/library/favorites/")

        self.assertEqual(delete_response.status_code, 204)
        self.assertEqual(list_response.json()["meta"]["count"], 0)

    def test_favorite_book_requires_published_book(self):
        book = Book.objects.create(
            title="Hidden Favourite",
            slug="hidden-favourite",
            room_type=Book.RoomType.READING,
            age_band=Book.AgeBand.AGE_3_5,
            published=False,
        )

        response = self.client.post(
            "/api/v1/library/favorites/",
            data={"book_id": str(book.id)},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")


class ReadingReminderApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="reminderparent",
            email="reminderparent@example.com",
            password="strong-password-123",
        )
        self.other_user = User.objects.create_user(
            username="otherreminderparent",
            email="otherreminderparent@example.com",
            password="strong-password-123",
        )
        self.child = ChildProfile.objects.create(
            user=self.user,
            display_name="Riya",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        self.other_child = ChildProfile.objects.create(
            user=self.other_user,
            display_name="Noel",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        self.client.force_login(self.user)

    def test_reminder_can_be_created_and_listed(self):
        create_response = self.client.post(
            "/api/v1/reminders/",
            data={
                "child_profile_id": str(self.child.id),
                "title": "Bedtime reading",
                "frequency": "daily",
                "time_of_day": "19:30:00",
                "is_active": True,
            },
            content_type="application/json",
        )
        list_response = self.client.get("/api/v1/reminders/")

        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["meta"]["count"], 1)
        self.assertEqual(list_response.json()["data"][0]["title"], "Bedtime reading")

    def test_reminder_can_be_updated_and_deleted(self):
        reminder = ReadingReminder.objects.create(
            user=self.user,
            child_profile=self.child,
            title="Old reminder",
            frequency="daily",
            time_of_day="18:00:00",
            is_active=True,
        )

        update_response = self.client.patch(
            f"/api/v1/reminders/{reminder.id}/",
            data={"title": "Updated reminder", "is_active": False},
            content_type="application/json",
        )
        delete_response = self.client.delete(f"/api/v1/reminders/{reminder.id}/")

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["data"]["title"], "Updated reminder")
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(ReadingReminder.objects.filter(id=reminder.id).exists())

    def test_reminder_rejects_other_users_child_profile(self):
        response = self.client.post(
            "/api/v1/reminders/",
            data={
                "child_profile_id": str(self.other_child.id),
                "title": "Bad reminder",
                "frequency": "daily",
                "time_of_day": "20:00:00",
                "is_active": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("child_profile_id", response.json())


class SeedDemoDataCommandTests(TestCase):
    def test_seed_demo_data_creates_admin_and_content(self):
        out = StringIO()

        call_command("seed_demo_data", stdout=out)

        self.assertTrue(User.objects.filter(username="admin").exists())
        self.assertGreaterEqual(Book.objects.filter(published=True).count(), 3)
        self.assertGreaterEqual(Badge.objects.count(), 2)
        self.assertIn("Demo data prepared", out.getvalue())

    def test_seed_demo_data_is_idempotent(self):
        call_command("seed_demo_data")
        call_command("seed_demo_data")

        self.assertEqual(User.objects.filter(username="admin").count(), 1)


class ReminderDeliveryCommandTests(TestCase):
    def test_send_reading_reminders_sends_email_for_active_opted_in_user(self):
        user = User.objects.create_user(
            username="mailerparent",
            email="mailerparent@example.com",
            password="strong-password-123",
        )
        child = ChildProfile.objects.create(
            user=user,
            display_name="Lulu",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        NotificationPreference.objects.create(user=user, email_reminders=True, session_updates=True, marketing_opt_in=False)
        ReadingReminder.objects.create(
            user=user,
            child_profile=child,
            title="Evening reading",
            frequency="daily",
            time_of_day="19:00:00",
            is_active=True,
        )

        out = StringIO()
        call_command("send_reading_reminders", stdout=out)

        self.assertIn("Processed 1 reminder(s); sent 1 email(s).", out.getvalue())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Evening reading", mail.outbox[0].subject)

    def test_send_reading_reminders_skips_opted_out_user(self):
        user = User.objects.create_user(
            username="optedoutparent",
            email="optedoutparent@example.com",
            password="strong-password-123",
        )
        child = ChildProfile.objects.create(
            user=user,
            display_name="Milo",
            age_band=ChildProfile.AgeBand.AGE_3_5,
        )
        NotificationPreference.objects.create(user=user, email_reminders=False, session_updates=True, marketing_opt_in=False)
        ReadingReminder.objects.create(
            user=user,
            child_profile=child,
            title="Skip me",
            frequency="daily",
            time_of_day="18:30:00",
            is_active=True,
        )

        out = StringIO()
        call_command("send_reading_reminders", stdout=out)

        self.assertIn("Processed 1 reminder(s); sent 0 email(s).", out.getvalue())
        self.assertEqual(len(mail.outbox), 0)


class NotificationPreferenceApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="notifparent",
            email="notifparent@example.com",
            password="strong-password-123",
        )
        self.client.force_login(self.user)

    def test_notification_preferences_endpoint_returns_defaults(self):
        response = self.client.get("/api/v1/notifications/preferences/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertTrue(payload["email_reminders"])
        self.assertTrue(payload["session_updates"])
        self.assertFalse(payload["marketing_opt_in"])
        self.assertTrue(NotificationPreference.objects.filter(user=self.user).exists())

    def test_notification_preferences_endpoint_updates_settings(self):
        response = self.client.patch(
            "/api/v1/notifications/preferences/",
            data={
                "email_reminders": False,
                "session_updates": False,
                "marketing_opt_in": True,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        prefs = NotificationPreference.objects.get(user=self.user)
        self.assertFalse(prefs.email_reminders)
        self.assertFalse(prefs.session_updates)
        self.assertTrue(prefs.marketing_opt_in)


# ─── TransferHostView ─────────────────────────────────────────────────────────

class TransferHostViewTests(TestCase):
    def setUp(self):
        self.host_user = User.objects.create_user(username="host_u", password="pw")
        self.guest_user = User.objects.create_user(username="guest_u", password="pw")
        child = ChildProfile.objects.create(user=self.host_user, display_name="Leo", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(title="T", slug="t", room_type=Book.RoomType.READING, age_band=Book.AgeBand.AGE_3_5, published=True, page_count=5)
        self.session = ReadingSession.objects.create(book=book, child_profile=child, created_by=self.host_user, status=ReadingSession.Status.ACTIVE)
        self.host_p = SessionParticipant.objects.create(session=self.session, user=self.host_user, display_name="Host", session_role=SessionParticipant.SessionRole.HOST, participant_type=SessionParticipant.ParticipantType.HOST)
        self.guest_p = SessionParticipant.objects.create(session=self.session, user=self.guest_user, display_name="Guest", session_role=SessionParticipant.SessionRole.PARTICIPANT, participant_type=SessionParticipant.ParticipantType.GUEST)
        self.url = f"/api/v1/sessions/{self.session.id}/transfer-host/"

    def test_transfer_host_requires_auth(self):
        response = self.client.post(self.url, data={}, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_transfer_host_success(self):
        self.client.force_login(self.host_user)
        response = self.client.post(
            self.url,
            data={"current_participant_id": str(self.host_p.id), "new_participant_id": str(self.guest_p.id)},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.host_p.refresh_from_db()
        self.guest_p.refresh_from_db()
        self.assertEqual(self.guest_p.session_role, SessionParticipant.SessionRole.HOST)
        self.assertEqual(self.host_p.session_role, SessionParticipant.SessionRole.PARTICIPANT)

    def test_transfer_host_non_host_rejected(self):
        self.client.force_login(self.guest_user)
        response = self.client.post(
            self.url,
            data={"current_participant_id": str(self.guest_p.id), "new_participant_id": str(self.host_p.id)},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_transfer_host_wrong_user_rejected(self):
        other = User.objects.create_user(username="other_u", password="pw")
        self.client.force_login(other)
        response = self.client.post(
            self.url,
            data={"current_participant_id": str(self.host_p.id), "new_participant_id": str(self.guest_p.id)},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


# ─── SessionGuestTokenView ────────────────────────────────────────────────────

class SessionGuestTokenViewTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="parent_gt", password="pw")
        child = ChildProfile.objects.create(user=self.user, display_name="Mia", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(title="B", slug="b", room_type=Book.RoomType.READING, age_band=Book.AgeBand.AGE_3_5, published=True, page_count=5)
        self.session = ReadingSession.objects.create(book=book, child_profile=child, created_by=self.user, status=ReadingSession.Status.ACTIVE)
        self.participant = SessionParticipant.objects.create(
            session=self.session, user=self.user, display_name="Mia", session_role=SessionParticipant.SessionRole.PARTICIPANT, participant_type=SessionParticipant.ParticipantType.GUEST,
        )

    def test_missing_participant_id_returns_400(self):
        response = self.client.get(f"/api/v1/sessions/{self.session.id}/token/")
        self.assertEqual(response.status_code, 400)

    def test_invalid_participant_id_returns_403(self):
        response = self.client.get(f"/api/v1/sessions/{self.session.id}/token/?participant_id=00000000-0000-0000-0000-000000000000")
        self.assertEqual(response.status_code, 403)

    def test_session_not_found_returns_404(self):
        import uuid
        response = self.client.get(f"/api/v1/sessions/{uuid.uuid4()}/token/?participant_id={self.participant.id}")
        self.assertEqual(response.status_code, 404)


# ─── AdminEntitlementDetailView ───────────────────────────────────────────────

class AdminEntitlementDetailViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin_ent", password="pw", is_staff=True, is_superuser=True)
        self.regular = User.objects.create_user(username="reg_ent", password="pw")
        self.target = User.objects.create_user(username="target_ent", password="pw")
        self.entitlement = Entitlement.objects.create(user=self.target, plan="active", sessions_remaining=10)
        self.url = f"/api/v1/admin/entitlements/{self.target.id}/"

    def test_non_admin_returns_403(self):
        self.client.force_login(self.regular)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_admin_can_get_entitlement(self):
        self.client.force_login(self.admin)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["plan"], "active")

    def test_admin_can_patch_entitlement(self):
        self.client.force_login(self.admin)
        response = self.client.patch(self.url, data={"sessions_remaining": 5}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.entitlement.refresh_from_db()
        self.assertEqual(self.entitlement.sessions_remaining, 5)

    def test_missing_entitlement_returns_404(self):
        self.client.force_login(self.admin)
        response = self.client.get(f"/api/v1/admin/entitlements/99999/")
        self.assertEqual(response.status_code, 404)


# ─── AdminSessionEventExportView ──────────────────────────────────────────────

class AdminSessionEventExportViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin_ev", password="pw", is_staff=True, is_superuser=True)
        self.regular = User.objects.create_user(username="reg_ev", password="pw")
        child = ChildProfile.objects.create(user=self.admin, display_name="Rex", age_band=ChildProfile.AgeBand.AGE_3_5)
        book = Book.objects.create(title="E", slug="e", room_type=Book.RoomType.READING, age_band=Book.AgeBand.AGE_3_5, published=True, page_count=5)
        session = ReadingSession.objects.create(book=book, child_profile=child, created_by=self.admin)
        participant = SessionParticipant.objects.create(session=session, user=self.admin, display_name="Rex", session_role=SessionParticipant.SessionRole.HOST, participant_type=SessionParticipant.ParticipantType.HOST)
        SessionEvent.objects.create(session=session, participant=participant, event_type="session_started", payload={})
        self.url = "/api/v1/admin/events/export/"

    def test_non_admin_returns_403(self):
        self.client.force_login(self.regular)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)

    def test_export_returns_csv(self):
        self.client.force_login(self.admin)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv")
        content = response.content.decode()
        self.assertIn("event_id", content)
        self.assertIn("session_started", content)

    def test_export_filter_by_event_type(self):
        self.client.force_login(self.admin)
        response = self.client.get(self.url + "?event_type=session_started")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("session_started", content)

    def test_export_filter_excludes_other_types(self):
        self.client.force_login(self.admin)
        response = self.client.get(self.url + "?event_type=page_turn")
        content = response.content.decode()
        lines = [l for l in content.strip().splitlines() if l and not l.startswith("event_id")]
        self.assertEqual(len(lines), 0)
