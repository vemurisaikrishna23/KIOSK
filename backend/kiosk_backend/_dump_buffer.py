import os, json, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "kiosk_backend.settings")
django.setup()

from Applications.models import Dashboard, DashboardComponent
from Applications.serializers import DashboardSerializer, DashboardComponentSerializer

DASH_ID = 2
dash = Dashboard.objects.get(id=DASH_ID)
comps = DashboardComponent.objects.filter(dashboard_id=DASH_ID).order_by("order", "created_at")
payload = {
    "dashboard": DashboardSerializer(dash).data,
    "components": DashboardComponentSerializer(comps, many=True).data,
}
out_dir = os.path.join("..", "buffers")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "dashboard_%d_buffer.json" % DASH_ID)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2, default=str, ensure_ascii=False)
print("WROTE", os.path.abspath(out_path), "components=", comps.count())
