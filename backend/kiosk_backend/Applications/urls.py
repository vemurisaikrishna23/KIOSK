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

]