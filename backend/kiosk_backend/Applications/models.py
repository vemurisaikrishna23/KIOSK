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

    # Number of times a public visitor opened one of this application's
    # published dashboards ("tries"). Incremented on each public dashboard
    # load; surfaced on the public Live Applications page as a popularity metric.
    public_views = models.PositiveIntegerField(default=0)

    # Optional Spline 3D scene shown in every dashboard's camera area (after
    # the cameras). Configured per-application from its own section, alongside
    # Devices / Cameras / Dashboards.
    spline_url = models.CharField(max_length=255, blank=True, null=True)
    spline_url_enable = models.BooleanField(default=False)

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class ActivityLog(models.Model):
    """
    Internal audit/activity log — one row per meaningful admin action
    (create / update / delete) on an internally-managed entity. Used by the
    dashboard's "Recent activity" panel and for debugging.

    Notes:
      • INTERNAL ONLY — public-side events (public dashboard opens, public
        contact-form submissions) are deliberately NOT logged.
      • Categorised via `category` so logs can be filtered/grouped.
      • Retained for RETENTION_DAYS (30) days — older rows are purged
        opportunistically (on read) and via the purge_activity_logs command.
    """
    RETENTION_DAYS = 30

    CATEGORY_CHOICES = [
        ('application', 'Application'),
        ('dashboard',   'Dashboard'),
        ('device',      'Device'),
        ('camera',      'Camera'),
        ('user',        'User'),
        ('role',        'Role'),
        ('company',     'Company'),
        ('ssl',         'SSL'),
        ('system',      'System'),
    ]
    ACTION_CHOICES = [
        ('create', 'Created'),
        ('update', 'Updated'),
        ('delete', 'Deleted'),
    ]

    category    = models.CharField(max_length=24, choices=CATEGORY_CHOICES, db_index=True)
    action      = models.CharField(max_length=16, choices=ACTION_CHOICES)
    entity_name = models.CharField(max_length=200, blank=True, default='')
    message     = models.CharField(max_length=300, blank=True, default='')
    # Who performed the action. `actor` is the stable FK used for per-user
    # activity views; `actor_name` is the human-readable name captured at the
    # time (kept even if the account is later renamed / hard-deleted). Both are
    # blank/null for system or automated events (no user involved).
    actor       = models.ForeignKey(
        'UserAccounts.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_logs', db_index=True,
    )
    actor_name  = models.CharField(max_length=150, blank=True, default='')
    metadata    = models.JSONField(default=dict, blank=True)
    created_at  = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Activity Log'
        verbose_name_plural = 'Activity Logs'

    def __str__(self):
        return f"[{self.category}] {self.action} · {self.entity_name}"

    @classmethod
    def purge_old(cls):
        """Delete logs older than the retention window. Returns rows removed."""
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(days=cls.RETENTION_DAYS)
        deleted, _ = cls.objects.filter(created_at__lt=cutoff).delete()
        return deleted


class ApplicationDailyView(models.Model):
    """
    One row per (application, calendar day) holding the number of public
    dashboard opens ("views") that happened that day. Incremented alongside
    Application.public_views so the dashboard can chart views over time
    (last 7 / 30 days), per-application or aggregated across all apps.
    """
    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, related_name='daily_views'
    )
    date = models.DateField(default=timezone.localdate)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ('application', 'date')
        ordering = ['-date']
        verbose_name = 'Application Daily View'
        verbose_name_plural = 'Application Daily Views'

    def __str__(self):
        return f"{self.application_id} · {self.date} · {self.count}"


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

    # Per-viewport publish state. The admin activates the desktop and the
    # mobile layout independently from the dashboard editor. `publish`
    # (above) is kept in sync as desktop OR mobile so existing public
    # filters (dashboards__publish=True) keep working.
    publish_desktop = models.BooleanField(
        default=False,
        help_text="If true, the desktop layout is published to end users"
    )
    publish_mobile = models.BooleanField(
        default=False,
        help_text="If true, the mobile layout is published to end users"
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
    # Turn-based access queue. When enabled, public viewers join a queue and
    # only the current holder can control (write) the dashboard, for
    # queue_control_seconds, before control rotates to the next person.
    # Applies to both the desktop and mobile published layouts.
    queue_enabled = models.BooleanField(default=False)
    queue_control_seconds = models.PositiveIntegerField(default=60)
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

    def save(self, *args, **kwargs):
        # Keep the legacy `publish` flag in sync with the per-viewport flags:
        # a dashboard counts as published when either its desktop or mobile
        # layout is published, so existing public filters keep working.
        self.publish = bool(self.publish_desktop or self.publish_mobile)
        super().save(*args, **kwargs)

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


# =====================================================================
# SSL Certificate (singleton-style — only one is "active" at a time
# and that one is what hardware downloads from /cert/server.crt).
# =====================================================================
def ssl_cert_upload_path(instance, filename):
    return f"ssl_certificates/{filename}"

class SSLCertificate(models.Model):
    name = models.CharField(max_length=120)
    file = models.FileField(upload_to=ssl_cert_upload_path)
    description = models.TextField(blank=True, default="")
    uploaded_by = models.ForeignKey(
        'UserAccounts.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='uploaded_ssl_certificates',
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True, help_text="The currently-served certificate. Only one can be active.")

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f"{self.name} ({self.uploaded_at:%Y-%m-%d %H:%M})"

    def save(self, *args, **kwargs):
        # Singleton behaviour: when a new cert is saved as active,
        # demote every other active certificate.
        super().save(*args, **kwargs)
        if self.is_active:
            SSLCertificate.objects.exclude(pk=self.pk).filter(is_active=True).update(is_active=False)


class ContactSubmission(models.Model):
    """
    A message sent from the public landing page's "Contact Us" form — a
    customer wanting to connect with us. Stored for the admin to triage;
    the `status` field tracks the lead lifecycle
    (new → contacted → in discussion → converted / not interested).
    """
    STATUS_NEW            = "new"
    STATUS_CONTACTED      = "contacted"
    STATUS_IN_DISCUSSION  = "in_discussion"
    STATUS_CONVERTED      = "converted"
    STATUS_NOT_INTERESTED = "not_interested"
    STATUS_CHOICES = [
        (STATUS_NEW,            "New"),
        (STATUS_CONTACTED,      "Contacted"),
        (STATUS_IN_DISCUSSION,  "In Discussion"),
        (STATUS_CONVERTED,      "Converted"),
        (STATUS_NOT_INTERESTED, "Not Interested"),
    ]

    name    = models.CharField(max_length=120)
    email   = models.EmailField()
    subject = models.CharField(max_length=200, blank=True, default="")
    message = models.TextField()

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW)
    # Free-form internal note the admin can keep against the submission.
    admin_notes = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} <{self.email}> ({self.status})"


class CompanyInformation(models.Model):
    """
    Company contact details rendered on the public landing page's "Contact
    Us" block (email / phone / office) plus a Google-Maps embed so the page
    can show the office location. Multiple records can be stored, but only
    ONE is active at a time (singleton pattern in save(), like SSLCertificate).
    """
    company_name = models.CharField(max_length=160, default="")
    email        = models.EmailField(blank=True, default="")
    phone        = models.CharField(max_length=40, blank=True, default="")
    address      = models.TextField(blank=True, default="")

    # Raw Google-Maps embed code (the full <iframe …> snippet) OR a bare
    # src URL — the frontend handles both so the office location shows on
    # the public page.
    map_embed_code = models.TextField(blank=True, default="", help_text="Google Maps embed <iframe> snippet or src URL.")

    is_active = models.BooleanField(default=True, help_text="The currently-shown company info. Only one can be active.")

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_active', '-updated_at']
        verbose_name = "Company Information"
        verbose_name_plural = "Company Information"

    def __str__(self):
        return f"{self.company_name or self.email} ({'active' if self.is_active else 'inactive'})"

    def save(self, *args, **kwargs):
        # Exactly-one-active behaviour:
        #   • If no OTHER record is active, this one is forced active — so the
        #     first record is always active and the last active record can't
        #     be turned off (there is always one live address).
        #   • If this record is active, every other active record is demoted.
        if not CompanyInformation.objects.exclude(pk=self.pk).filter(is_active=True).exists():
            self.is_active = True
        super().save(*args, **kwargs)
        if self.is_active:
            CompanyInformation.objects.exclude(pk=self.pk).filter(is_active=True).update(is_active=False)
