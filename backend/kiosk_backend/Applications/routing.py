from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r"ws/applications/(?P<token>[a-zA-Z0-9]+)/$", consumers.DeviceRealtimeConsumer.as_asgi()),
    re_path(r"ws/dashboards/(?P<dashboard_id>[a-zA-Z0-9]+)/$", consumers.DashboardRealtimeConsumer.as_asgi()),
    re_path(r"ws/dashboard-queue/(?P<dashboard_id>[a-zA-Z0-9]+)/$", consumers.DashboardQueueConsumer.as_asgi()),
    re_path(r"ws/activity-logs/$", consumers.ActivityLogConsumer.as_asgi()),
]