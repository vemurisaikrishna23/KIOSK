from rest_framework import serializers
from .models import *
from Cameras.models import *
from Cameras.serializers import *

import os 
import time
import random


class ApplicationSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Application
        fields = [
            'id',
            'name',
            'description',
            'publish',
            'is_active',
            'application_image',
            'created_by',
            'created_by_name',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'created_by_name', 'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        return obj.created_by.name if obj.created_by else None

    def validate_name(self, value):
        """
        CREATE:
            - name must be unique
        UPDATE:
            - same name → allowed
            - changed name → must be unique
        """
        instance = self.instance

        # CREATE
        if instance is None:
            if Application.objects.filter(name__iexact=value).exists():
                raise serializers.ValidationError(
                    "An application with this name already exists."
                )
            return value

        # UPDATE
        if instance.name.lower() == value.lower():
            # same name → allow silently
            return value

        if Application.objects.filter(
            name__iexact=value
        ).exclude(id=instance.id).exists():
            raise serializers.ValidationError(
                "Another application with this name already exists."
            )

        return value
    
    def validate_application_image(self, image):
        """
        Rename image by appending _<random> before saving
        """
        if not image:
            return image

        name, ext = os.path.splitext(image.name)

        # random suffix (safe & simple)
        random_suffix = f"{int(time.time())}_{random.randint(1000, 9999)}"

        image.name = f"{name}_{random_suffix}{ext}"
        return image

    def get_application_image_url(self, obj):
        """
        Returns full URL:
        https://host/media/...
        """
        if not obj.application_image:
            return None

        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.application_image.url)

        # fallback (should not happen in API)
        return obj.application_image.url

    def update(self, instance, validated_data):
        new_image = validated_data.get("application_image", None)

        if new_image and instance.application_image:
            old_path = instance.application_image.path
            if os.path.isfile(old_path):
                os.remove(old_path)

        return super().update(instance, validated_data)


class ApplicationHasCameraSerializer(serializers.ModelSerializer):
    application_details = ApplicationSerializer(source='application', read_only=True)
    camera_details = CameraSerializer(source='camera', read_only=True)

    class Meta:
        model = ApplicationHasCamera
        fields = [
            'id',
            'application',
            'camera',
            'description',
            'is_primary',
            'created_at',
            'application_details',
            'camera_details'
        ]


class DeviceSerializer(serializers.ModelSerializer):
    """
    Serializer for IoT Device CRUD operations.
    """
    class Meta:
        model = Device
        fields = [
            "id",
            "application",
            "device_uid",
            "device_name",
            "description",
            "protocol",
            "device_token",
            "firmware_version",
            "payload",
            "development_enabled",
            "is_active",
            "is_connected",
            "last_payload_update",
            "http_url",
            "websocket_url",
            "created_at",
            "updated_at"
        ]
        read_only_fields = [
            "device_token",
            "last_payload_update",
            "created_at",
            "updated_at"
        ]

    def create(self, validated_data):
        return Device.objects.create(**validated_data)

class DeviceEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceEvent
        fields = ["id", "device", "path", "key", "data", "created_at"]
        read_only_fields = ["id", "created_at"]


class DashboardSerializer(serializers.ModelSerializer):
    application_name = serializers.CharField(
        source="application.name", read_only=True
    )
    created_by_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Dashboard
        fields = [
            "id",
            "application",
            "application_name",
            "name",
            "description",
            "publish",
                        # 🔹 NEW FIELDS
            "dashboard_image",
            "dashboard_image_enable",
            "spline_url",
            "spline_url_enable",
            "theme",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]

    def get_created_by_name(self, obj):
        return obj.created_by.name if obj.created_by else None

    def validate_name(self, value):
        """
        Update-safe name validation:
        - Allow same name (no change)
        - If changed, ensure uniqueness within application
        """

        request = self.context.get("request")
        instance = self.instance  # None on create, object on update

        # CREATE case
        if instance is None:
            application = self.initial_data.get("application")
            if Dashboard.objects.filter(
                application_id=application,
                name__iexact=value
            ).exists():
                raise serializers.ValidationError(
                    "Dashboard with this name already exists in this application."
                )
            return value

        # UPDATE case
        if instance.name == value:
            # Name unchanged → allow
            return value

        # Name changed → check duplicates
        if Dashboard.objects.filter(
            application=instance.application,
            name__iexact=value
        ).exclude(id=instance.id).exists():
            raise serializers.ValidationError(
                "Another dashboard with this name already exists in this application."
            )

        return value

    
    def validate_dashboard_image(self, image):
        """
        Rename dashboard image by appending _<timestamp>_<rand>
        Example: image_1700000000_1234.png
        """
        if not image:
            return image

        name, ext = os.path.splitext(image.name)
        suffix = f"_{int(time.time())}_{random.randint(1000, 9999)}"
        image.name = f"{name}{suffix}{ext}"

        return image

    def update(self, instance, validated_data):
        new_image = validated_data.get("dashboard_image", None)

        if new_image and instance.dashboard_image:
            old_path = instance.dashboard_image.path
            if os.path.isfile(old_path):
                os.remove(old_path)

        return super().update(instance, validated_data)


class DashboardComponentSerializer(serializers.ModelSerializer):
    """
    Serializer for dashboard widgets.
    Stores ONLY configuration.
    """

    class Meta:
        model = DashboardComponent
        fields = [
            "id",
            "dashboard",
            "widget_name",
            "widget_type",
            "order",
            "config",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        """
        Widget name uniqueness rules:
        - CREATE:
            widget_name must be unique per dashboard
        - UPDATE:
            - same widget_name → allowed
            - changed widget_name → must be unique per dashboard
        """

        widget_name = attrs.get("widget_name")
        dashboard = attrs.get("dashboard")

        instance = self.instance

        # -----------------------------
        # UPDATE CASE
        # -----------------------------
        if instance:
            if widget_name and widget_name != instance.widget_name:
                exists = DashboardComponent.objects.filter(
                    dashboard=instance.dashboard,
                    widget_name__iexact=widget_name,
                ).exclude(id=instance.id).exists()

                if exists:
                    raise serializers.ValidationError(
                        {
                            "widget_name": (
                                "Widget with this name already exists in this dashboard."
                            )
                        }
                    )

        # -----------------------------
        # CREATE CASE (single or bulk)
        # -----------------------------
        else:
            if widget_name and dashboard:
                exists = DashboardComponent.objects.filter(
                    dashboard=dashboard,
                    widget_name__iexact=widget_name,
                ).exists()

                if exists:
                    raise serializers.ValidationError(
                        {
                            "widget_name": (
                                "Widget with this name already exists in this dashboard."
                            )
                        }
                    )

        return attrs


class PublicCameraOnlySerializer(serializers.ModelSerializer):
    camera_details = CameraSerializer(source="camera", read_only=True)

    class Meta:
        model = ApplicationHasCamera
        fields = [
            "camera_details"
        ]
