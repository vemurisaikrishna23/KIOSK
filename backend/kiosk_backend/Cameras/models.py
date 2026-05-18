from django.db import models
from django.db.models.functions import Lower

# Create your models here.
class Camera(models.Model):
    PROTOCOL_CHOICES = [
        ('rtsp', 'RTSP'),
        ('webrtc', 'WebRTC'),
        ('onvif', 'ONVIF'),
        ('http', 'HTTP'),
        ('other', 'Other'),
    ]
    camera_name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    model_number = models.CharField(max_length=100, blank=True, null=True)
    protocol = models.CharField(max_length=20, choices=PROTOCOL_CHOICES)
    url = models.TextField(help_text="Camera stream URL (RTSP or WebRTC)")
    stream_path = models.CharField(
        max_length=100,
        unique=True,
        help_text="Stream alias used in MediaMTX (e.g., cam1, kiosk_front)"
    )
    webrtc_url = models.TextField(
        blank=True,
        null=True,
        help_text="Complete WebRTC playback URL (e.g., https://stream.domain.com/cam1/whep)"
    )
    status = models.BooleanField(default=False, help_text="True if camera is reachable")
    is_active = models.BooleanField(default=True, help_text="Enable or disable this camera")
    created_at = models.DateTimeField(auto_now_add=True) 
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    viewers = models.PositiveIntegerField(default=0, help_text="Active viewer count")
    added_by = models.ForeignKey(
        'UserAccounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cameras'
    )

    class Meta:
        constraints = [
            # Case-insensitive uniqueness on camera_name so "Cam1" and "cam1"
            # collide. Lives at the DB level so it survives any code path —
            # admin, shell, racing requests — not just the serializer.
            models.UniqueConstraint(
                Lower('camera_name'),
                name='cameras_camera_name_ci_uniq',
            ),
        ]
