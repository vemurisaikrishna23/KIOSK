from rest_framework.routers import DefaultRouter
from .views import *
from .views_realtime import *
from django.urls import path, include


router = DefaultRouter()
router.register(r'applications', ApplicationViewSet, basename='application')
router.register(r'application-cameras', ApplicationHasCameraViewSet, basename='application-camera')
router.register(r'devices', DeviceViewSet, basename='device')
router.register(r'device-events', DeviceEventViewSet, basename='device-event')
router.register(r'dashboards',DashboardViewSet,basename='dashboard')
router.register(r"dashboard-components", DashboardComponentViewSet, basename="dashboard-components")
router.register(r"ssl-certificates",     SSLCertificateViewSet,    basename="ssl-certificates")
router.register(r"contact-submissions",  ContactSubmissionViewSet, basename="contact-submissions")
router.register(r"company-information",  CompanyInformationViewSet, basename="company-information")
router.register(
    r'public/applications',
    PublicApplicationViewSet,
    basename='public-applications'
)
router.register(
    r'public/application-cameras',
    PublicApplicationHasCameraViewSet,
    basename='public-application-cameras'
)
router.register(
    r'public/dashboards',
    PublicDashboardViewSet,
    basename='public-dashboards'
)
 
urlpatterns = [
    path('', include(router.urls)),

    # Firebase-like REST API (token + dynamic path)
    path('push/<str:token>/', firebase_style_api, name='push_root'),
    path('push/<str:token>/<path:path>/', firebase_style_api, name='push_path'),
    path(
        "public/dashboards/<int:dashboard_id>/load/",
        PublicDashboardLoadAPIView.as_view(),
        name="public-dashboard-load",
    ),
    path(
        "public/analytics/",
        PublicAnalyticsAPIView.as_view(),
        name="public-analytics",
    ),
    # Authenticated daily-views time series for the dashboard's views graph.
    path(
        "views-timeseries/",
        ApplicationViewsTimeseriesAPIView.as_view(),
        name="views-timeseries",
    ),
    # Authenticated internal activity log (dashboard recent activity + Activity Log page).
    path(
        "activity-logs/",
        ActivityLogListAPIView.as_view(),
        name="activity-logs",
    ),
    # CSV export of the activity log for a date range (download-permission gated).
    path(
        "activity-logs/export/",
        ActivityLogExportAPIView.as_view(),
        name="activity-logs-export",
    ),
    # Per-user activity trail (view + download, separately permissioned).
    path(
        "user-activity/<int:user_id>/",
        UserActivityLogListAPIView.as_view(),
        name="user-activity",
    ),
    path(
        "user-activity/<int:user_id>/export/",
        UserActivityLogExportAPIView.as_view(),
        name="user-activity-export",
    ),
    # Public, no-auth Contact Us intake + company info read for the landing page.
    path(
        "public/contact/",
        PublicContactSubmissionView.as_view(),
        name="public-contact",
    ),
    path(
        "public/company-information/",
        PublicCompanyInformationView.as_view(),
        name="public-company-information",
    ),

]