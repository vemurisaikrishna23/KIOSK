from django.db import models
from django.utils import timezone
from Cameras.models import *
import uuid
import secrets
import secrets
import copy

# Create your models here.
class Application(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey('UserAccounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    publish = models.BooleanField(default=False, help_text="If true, this application is visible to the public")
    application_image = models.ImageField(upload_to='application/images/', null=True, blank=True)

    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class ApplicationHasCamera(models.Model):
    """
    Explicit linking table between Application and Camera.
    """
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name='camera_links')
    camera = models.ForeignKey(Camera, on_delete=models.SET_NULL,null=True, blank=True, related_name='application_links')

    description = models.TextField(blank=True, null=True)
    is_primary = models.BooleanField(default=False, help_text="Mark as main display camera if needed")

    created_at = models.DateTimeField(default=timezone.now)
    added_by = models.ForeignKey('UserAccounts.User', on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        unique_together = ('application', 'camera')
        verbose_name = "Application Camera Link"
        verbose_name_plural = "Application Camera Links"

    def __str__(self):
        return f"{self.application.name} ↔ {self.camera.camera_name}"



class Device(models.Model):
    """
    Represents an IoT device under a single application.
    The payload behaves like a Firebase-style structure — dynamically merged or deleted.
    Hardware/frontend both push fields explicitly with 'type' and 'value'.
    """

    # ─────────── Foreign Key ───────────
    application = models.ForeignKey(
        Application,
        on_delete=models.CASCADE,
        related_name='devices'
    )

    # ─────────── Core Device Info ───────────
    device_uid = models.CharField(
        max_length=100,
        unique=True,
        help_text="Unique hardware ID (e.g., MAC, UUID, or Serial)"
    )
    device_name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    # ─────────── Communication & Firmware ───────────
    protocol = models.CharField(
        max_length=20,
        default='websocket',
        help_text="Communication protocol used (currently supports WebSocket)"
    )
    device_token = models.CharField(
        max_length=64,
        unique=True,
        editable=False,
        help_text="Random token generated for WebSocket authentication"
    )
    http_url = models.URLField(
        max_length=300, blank=True, null=True,
        help_text="Auto-generated endpoint for REST API"
    )
    websocket_url = models.URLField(
        max_length=300, blank=True, null=True,
        help_text="WebSocket endpoint (to be added later)"
    )
    firmware_version = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Firmware version running on the device"
    )

    # ─────────── Dynamic JSON Payload ───────────
    payload = models.JSONField(
        default=dict,
        help_text="Dynamic JSON structure with nested data, explicit 'type' and 'value'"
    )

    # ─────────── Development Mode ───────────
    development_enabled = models.BooleanField(
        default=False,
        help_text="If True, dashboard/dev tools are enabled for this device"
    )

    # ─────────── Status & Metadata ───────────
    is_active = models.BooleanField(default=True)
    is_connected = models.BooleanField(default=False)
    last_payload_update = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        """Auto-generate token when new device is created"""
        if not self.device_token:
            self.device_token = secrets.token_hex(16)
        super().save(*args, **kwargs)

    # ─────────── Payload Merge / Update Logic ───────────
    def merge_payload(self, new_data):
        """
        Merge, update, or delete nested JSON fields.
        All incoming fields must include an explicit 'type' key.
        Auto-coerces int↔float to match the existing field's declared type.
        """

        def coerce_and_normalize(incoming, target):
            if not (isinstance(incoming, dict) and "type" in incoming and "value" in incoming):
                return
            if isinstance(target, dict) and "type" in target and "value" in target:
                it, tt = incoming["type"], target["type"]
                iv = incoming["value"]
                if it == "int" and tt == "float":
                    incoming["type"] = "float"
                    incoming["value"] = float(iv) if isinstance(iv, (int, float)) else iv
                elif it == "float" and tt == "int":
                    incoming["type"] = "int"
                    incoming["value"] = int(round(iv)) if isinstance(iv, (int, float)) else iv
            t, v = incoming["type"], incoming["value"]
            if t == "float" and isinstance(v, int):
                incoming["value"] = float(v)
            elif t == "int" and isinstance(v, float):
                incoming["value"] = int(round(v))

        def merge(existing, incoming):
            for key, value in incoming.items():
                if value is None:
                    existing.pop(key, None)
                    continue

                if isinstance(value, dict) and "type" not in value:
                    existing[key] = merge(existing.get(key, {}), value)
                else:
                    coerce_and_normalize(value, existing.get(key, {}))
                    existing[key] = value
            return existing

        self.payload = merge(copy.deepcopy(self.payload), new_data)
        self.last_payload_update = timezone.now()
        self.save(update_fields=["payload", "last_payload_update"])

    def __str__(self):
        return f"{self.application.name} → {self.device_name}"


class DeviceEvent(models.Model):
    """
    Append-only event store for device POSTs.

    The existing Device.payload JSONField holds the device's *current state*
    (PUT/PATCH targets — bounded in size). POST'd data — typically rolling
    time-series like sensor readings, logs, alerts — used to bloat that
    same JSONField over time, forcing the whole blob to be re-read and
    re-written on every event.

    This table is the Firebase-RTDB "child node" equivalent: every POST
    becomes one cheap INSERT keyed by (device, path, key), with a btree
    index on (device, path, -created_at) so paginating most-recent-first
    is O(log N) regardless of how many events the device has produced.

    The main payload tree never grows; aged events can be pruned by a
    background task without touching live device state.
    """
    device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name='events',
    )
    path = models.CharField(
        max_length=512,
        help_text="Parent path the entry was POSTed under, e.g. 'logs/error'",
    )
    key = models.CharField(
        max_length=64,
        help_text="Auto-generated child key (-XXXX...) or client-supplied id.",
    )
    data = models.JSONField(
        help_text="The full body of the POSTed entry (excluding the auto-key).",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        # Paginating newest-first per (device, path) is the hot path.
        indexes = [
            models.Index(fields=['device', 'path', '-created_at'], name='devevt_dev_path_ctime_idx'),
            models.Index(fields=['device', '-created_at'], name='devevt_dev_ctime_idx'),
        ]
        ordering = ['-created_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['device', 'path', 'key'],
                name='devevt_unique_dev_path_key',
            ),
        ]

    def __str__(self):
        return f"{self.device.device_uid}@{self.path}/{self.key}"


class Dashboard(models.Model):
    """
    Represents a dashboard under an Application.
    For now: only name, description, publish state.
    """

    application = models.ForeignKey(
        Application,
        on_delete=models.CASCADE,
        related_name="dashboards"
    )

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    publish = models.BooleanField(
        default=False,
        help_text="If true, dashboard is visible to end users"
    )

    created_by = models.ForeignKey(
        'UserAccounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True
    )
    dashboard_image = models.ImageField(upload_to='dashboard/images/', null=True, blank=True)
    dashboard_image_enable = models.BooleanField(default=False)
    spline_url = models.CharField(max_length=255, blank=True, null=True)
    spline_url_enable = models.BooleanField(default=False)
    # Color theme id (peach | ocean | mint | lavender | slate | sunset).
    # Drives panel gradients, cell tint, accent and default widget colors
    # on the frontend. Stored as a short string so adding new themes
    # later doesn't require a migration.
    theme = models.CharField(max_length=32, default='peach')
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("application", "name")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.application.name} → {self.name}"
    


class DashboardComponent(models.Model):
    """
    Represents a dashboard widget.
    Stores ONLY configuration. No live data.
    """

    # ==================================================
    # RELATION
    # ==================================================
    dashboard = models.ForeignKey(
        "Dashboard",
        on_delete=models.CASCADE,
        related_name="components",
    )

    # ==================================================
    # IDENTITY (STABLE)
    # ==================================================
    widget_name = models.CharField(
        max_length=100,
        help_text="Internal unique widget identifier (immutable)",
    )

    widget_type = models.CharField(
        max_length=50,
        help_text="simple_card | gauge | comparison | graph | switch | custom",
    )

    order = models.PositiveIntegerField(
        default=0,
        help_text="Render order in dashboard",
    )

    # ==================================================
    # CONFIG (ALL FRONTEND-DRIVEN)
    # ==================================================
    config = models.JSONField(
        default=dict,
        help_text="""
        Complete widget configuration.
        Frontend-controlled.

        Example:
        {
          "title": "Engine Temperature",
          "hide_title": false,

          "bindings": [
            {
              "device_id": 20,
              "payload_path": "sensors/temp",
              "label": "Engine 1"
            }
          ],

          "static": {
            "unit": "°C",
            "min": 0,
            "max": 300
          },

          "ui": {
            "icon": "thermometer",
            "color": "orange"
          }
        }
        """
    )

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("dashboard", "widget_name")
        ordering = ["order", "created_at"]

    def __str__(self):
        return f"{self.dashboard.name} → {self.widget_name}"
