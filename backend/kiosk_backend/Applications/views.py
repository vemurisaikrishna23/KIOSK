from rest_framework import viewsets, status, mixins
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
import os
from django.db import transaction
from .models import *
from .serializers import *
from Cameras.models import *
from kiosk_backend.permissions import HasCustomPermission

class ApplicationViewSet(viewsets.ModelViewSet):
    """
    Simple CRUD for Applications (no permissions/validations yet)
    """
    queryset = Application.objects.filter(is_active=True).order_by("-created_at")
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]

    required_permissions = {
        "list": "application_view",
        "retrieve": "application_view",
        "create": "application_create",
        "update": "application_update",
        "partial_update": "application_update",
        "destroy": "application_delete",
    }

    # ---------- CREATE ----------
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            app = serializer.save(created_by=request.user if request.user.is_authenticated else None)
            return Response({
                "message": "Application created successfully",
                "application": ApplicationSerializer(app, context={"request": request}).data
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # ---------- UPDATE ----------
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if serializer.is_valid():
            app = serializer.save()
            return Response({
                "message": "Application updated successfully",
                "application": ApplicationSerializer(app, context={"request": request}).data
            }, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
        # ---------- LIST ----------
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            "count": queryset.count(),
            "applications": serializer.data
        }, status=status.HTTP_200_OK)

    # ---------- DELETE ----------
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.delete()
        return Response({
            "message": f"Application '{instance.name}' deleted successfully."
        }, status=status.HTTP_200_OK)



class ApplicationHasCameraViewSet(viewsets.ModelViewSet):
    """
    API to assign cameras to applications and view linked cameras.

    Gated by the same permission set as the parent application. CRUD
    enforces:
      • application + camera exist (clean 400 on bad ids),
      • the (application, camera) pair is unique (clean 400 on dup),
      • is_primary is unique per application (assigning a new primary
        demotes the previous one in the same transaction).
    """
    queryset = ApplicationHasCamera.objects.select_related(
        "application", "camera"
    ).order_by("-created_at")
    serializer_class = ApplicationHasCameraSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {
        "list":           "application_view",
        "retrieve":       "application_view",
        "create":         "application_update",
        "update":         "application_update",
        "partial_update": "application_update",
        "destroy":        "application_update",
    }

    # ---------- CREATE ----------
    def create(self, request, *args, **kwargs):
        data = request.data
        application_id = data.get("application")
        camera_id      = data.get("camera")
        description    = data.get("description")
        is_primary     = bool(data.get("is_primary", False))

        if not application_id:
            return Response({"application": ["This field is required."]}, status=400)
        if not camera_id:
            return Response({"camera": ["This field is required."]}, status=400)

        try:
            app = Application.objects.get(id=application_id)
        except Application.DoesNotExist:
            return Response({"application": ["Application not found."]}, status=400)
        try:
            cam = Camera.objects.get(id=camera_id)
        except Camera.DoesNotExist:
            return Response({"camera": ["Camera not found."]}, status=400)

        # Duplicate guard — surface a field-level error instead of an IntegrityError.
        if ApplicationHasCamera.objects.filter(application=app, camera=cam).exists():
            return Response(
                {"camera": ["This camera is already linked to the application."]},
                status=400,
            )

        with transaction.atomic():
            # If the new link is primary, demote any existing primary so we
            # never have two primaries for the same application.
            if is_primary:
                ApplicationHasCamera.objects.filter(
                    application=app, is_primary=True
                ).update(is_primary=False)

            link = ApplicationHasCamera.objects.create(
                application=app,
                camera=cam,
                description=description,
                is_primary=is_primary,
                added_by=request.user if request.user.is_authenticated else None,
            )

        return Response({
            "message": "Camera assigned to application successfully",
            "data": ApplicationHasCameraSerializer(link, context={"request": request}).data,
        }, status=status.HTTP_201_CREATED)

    # ---------- LIST ----------
    def list(self, request, *args, **kwargs):
        """
        List linked cameras with optional filters:
          ?application=<id>
          ?camera=<id>
          ?is_primary=true|false
        """
        app_id = request.query_params.get("application")
        cam_id = request.query_params.get("camera")
        primary = request.query_params.get("is_primary")

        queryset = self.get_queryset()
        if app_id:
            queryset = queryset.filter(application_id=app_id)
        if cam_id:
            queryset = queryset.filter(camera_id=cam_id)
        if primary is not None:
            if primary.lower() == "true":
                queryset = queryset.filter(is_primary=True)
            elif primary.lower() == "false":
                queryset = queryset.filter(is_primary=False)

        serializer = self.get_serializer(queryset, many=True, context={"request": request})
        return Response({
            "count": queryset.count(),
            "links": serializer.data,
        }, status=status.HTTP_200_OK)

    # ---------- UPDATE ----------
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        new_is_primary = request.data.get("is_primary")

        serializer = self.get_serializer(
            instance, data=request.data, partial=partial, context={"request": request}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # If we're promoting this row to primary, demote everyone else
            # on the same application atomically.
            if new_is_primary is True or new_is_primary == "true":
                ApplicationHasCamera.objects.filter(
                    application=instance.application, is_primary=True,
                ).exclude(pk=instance.pk).update(is_primary=False)

            serializer.save()

        return Response({
            "message": "Camera–Application link updated successfully",
            "data": serializer.data,
        }, status=status.HTTP_200_OK)

    # ---------- DELETE ----------
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # NOTE: ApplicationHasCamera has NO application_image field — the
        # previous version of this method tried to delete one and crashed
        # the request. There is nothing on disk to clean up here.
        cam_name = instance.camera.camera_name if instance.camera else "Camera"
        app_name = instance.application.name if instance.application else "application"
        instance.delete()
        return Response({
            "message": f"Unlinked '{cam_name}' from application '{app_name}'."
        }, status=status.HTTP_200_OK)



class PublicApplicationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet
):
    """
    Public read-only API for Applications
    """
    permission_classes = [AllowAny]
    serializer_class = ApplicationSerializer

    queryset = Application.objects.filter(
        is_active=True,
        publish=True
    ).order_by("-created_at")

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(
            queryset,
            many=True,
            context={"request": request}
        )
        return Response({
            "count": queryset.count(),
            "applications": serializer.data
        }, status=status.HTTP_200_OK)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(
            instance,
            context={"request": request}
        )
        return Response(serializer.data, status=status.HTTP_200_OK)


class PublicApplicationHasCameraViewSet(
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
    mixins.RetrieveModelMixin
):
    """
    Public GET-only API for Application–Camera mapping
    Supports:
    - ?application=<application_id>
    - ?camera=<camera_id>
    """
    permission_classes = [AllowAny]
    serializer_class = ApplicationHasCameraSerializer

    queryset = ApplicationHasCamera.objects.select_related(
        "application", "camera"
    ).filter(
        application__publish=True,      # 🔒 ONLY published apps
        application__is_active=True
    ).order_by("-created_at")

    # ---------- LIST ----------
    def list(self, request, *args, **kwargs):
        app_id = request.query_params.get("application")
        cam_id = request.query_params.get("camera")

        queryset = self.get_queryset()

        # Apply filters (ID-based, exactly as requested)
        if app_id:
            queryset = queryset.filter(application_id=app_id)

        if cam_id:
            queryset = queryset.filter(camera_id=cam_id)

        serializer = self.get_serializer(
            queryset,
            many=True,
            context={"request": request}
        )

        return Response({
            "count": queryset.count(),
            "links": serializer.data
        }, status=status.HTTP_200_OK)


class DeviceEventViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only paginated view of POSTed device events.

    Filters:
      ?device=<id>     — required for listing
      ?path=<segment>  — exact-match parent path (e.g. "logs")
      ?since=<iso>     — only events created strictly after this timestamp
    Cursor pagination via ?cursor=<id> + ?limit=<int> (max 200).
    """
    queryset = DeviceEvent.objects.all()
    serializer_class = DeviceEventSerializer
    permission_classes = [IsAuthenticated]

    def list(self, request, *args, **kwargs):
        device_id = request.query_params.get("device")
        if not device_id:
            return Response({"detail": "Missing required ?device= filter."}, status=400)
        try:
            device_id = int(device_id)
        except ValueError:
            return Response({"detail": "?device= must be an integer."}, status=400)

        qs = DeviceEvent.objects.filter(device_id=device_id).only(
            "id", "device_id", "path", "key", "data", "created_at"
        )

        path = request.query_params.get("path")
        if path is not None:
            qs = qs.filter(path=path.strip("/"))

        since = request.query_params.get("since")
        if since:
            try:
                qs = qs.filter(created_at__gt=since)
            except Exception:
                return Response({"detail": "Invalid ?since= timestamp."}, status=400)

        # Cursor: paginate by descending id so newest-first survives even if
        # two events land in the same millisecond.
        cursor = request.query_params.get("cursor")
        if cursor:
            try:
                qs = qs.filter(id__lt=int(cursor))
            except ValueError:
                return Response({"detail": "?cursor= must be an integer."}, status=400)

        try:
            limit = int(request.query_params.get("limit", 50))
        except ValueError:
            limit = 50
        limit = max(1, min(200, limit))

        # +1 trick so we know whether there's another page without a count(*).
        rows = list(qs.order_by("-id")[:limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]

        next_cursor = rows[-1].id if (has_more and rows) else None
        return Response({
            "count_returned": len(rows),
            "has_more": has_more,
            "next_cursor": next_cursor,
            "events": DeviceEventSerializer(rows, many=True).data,
        }, status=200)


class DeviceViewSet(viewsets.ModelViewSet):
    """
    Manage IoT Devices under Applications.
    Supports dynamic Firebase-style payload structure and flexible filtering.
    """
    queryset = Device.objects.all().order_by('-created_at')
    serializer_class = DeviceSerializer

    # -------------- CREATE --------------
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            device = serializer.save()

            # Detect HTTP/HTTPS based on request
            scheme = "https" if request.is_secure() else "http"
            base_url = f"{scheme}://{request.get_host()}"

            # Generate HTTP URL
            device.http_url = f"{base_url}/applications/push/{device.device_token}/"
            device.websocket_url = f"wss://{request.get_host()}/ws/applications/{device.device_token}/"
            device.save(update_fields=["http_url", "websocket_url"])


            # Return response with URLs
            return Response({
                "message": "Device created successfully",
                "data": {
                    **serializer.data,
                    "http_url": device.http_url,
                    "websocket_url": device.websocket_url,
                }
            }, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


    # -------------- LIST (with Filters) --------------
    def list(self, request, *args, **kwargs):
        """
        GET /api/devices/
        Optional filters:
          - ?application=<id>
          - ?is_active=true|false
          - ?is_connected=true|false
        """
        queryset = self.get_queryset()

        # 🔹 Filter by application
        app_id = request.query_params.get("application")
        if app_id:
            queryset = queryset.filter(application_id=app_id)

        # 🔹 Filter by is_active
        is_active = request.query_params.get("is_active")
        if is_active is not None:
            if is_active.lower() == "true":
                queryset = queryset.filter(is_active=True)
            elif is_active.lower() == "false":
                queryset = queryset.filter(is_active=False)

        # 🔹 Filter by is_connected
        is_connected = request.query_params.get("is_connected")
        if is_connected is not None:
            if is_connected.lower() == "true":
                queryset = queryset.filter(is_connected=True)
            elif is_connected.lower() == "false":
                queryset = queryset.filter(is_connected=False)

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            "count": queryset.count(),
            "devices": serializer.data
        }, status=status.HTTP_200_OK)

    # -------------- RETRIEVE --------------
    def retrieve(self, request, pk=None, *args, **kwargs):
        try:
            device = self.get_queryset().get(pk=pk)
        except Device.DoesNotExist:
            return Response({"error": "Device not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = self.get_serializer(device)
        return Response(serializer.data, status=status.HTTP_200_OK)

    # -------------- UPDATE (Full / Partial) --------------
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # 🔹 Merge payload dynamically if provided
        payload_update = request.data.get("payload")
        if payload_update:
            instance.merge_payload(payload_update)

        serializer.save()
        return Response({
            "message": "Device updated successfully",
            "device": DeviceSerializer(instance).data
        }, status=status.HTTP_200_OK)

    # -------------- DELETE --------------
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.delete()
        return Response({
            "message": f"Device '{instance.device_name}' deleted successfully"
        }, status=status.HTTP_200_OK)


class DashboardViewSet(viewsets.ModelViewSet):
    queryset = Dashboard.objects.all().order_by("-created_at")
    serializer_class = DashboardSerializer

    # ---------- CREATE ----------
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(
            data=request.data,
            context={"request": request}
        )
        if serializer.is_valid():
            dashboard = serializer.save(
                created_by=request.user if request.user.is_authenticated else None
            )
            return Response(
                {
                    "message": "Dashboard created successfully",
                    "dashboard": DashboardSerializer(dashboard).data,
                },
                status=status.HTTP_201_CREATED,
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # ---------- UPDATE (PUT / PATCH) ----------
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()

        serializer = self.get_serializer(
            instance,
            data=request.data,
            partial=partial,
            context={"request": request},
        )

        if serializer.is_valid():
            dashboard = serializer.save()
            return Response(
                {
                    "message": "Dashboard updated successfully",
                    "dashboard": DashboardSerializer(dashboard).data,
                },
                status=status.HTTP_200_OK,
            )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # ---------- LIST ----------
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()

        # 🔹 Filter by application ID
        application_id = request.query_params.get("application")
        if application_id:
            queryset = queryset.filter(application_id=application_id)

        serializer = self.get_serializer(queryset, many=True)
        return Response(
            {
                "count": queryset.count(),
                "dashboards": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    # ---------- DELETE ----------
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
                # 🔹 Delete image file if exists
        if instance.dashboard_image:
            image_path = instance.dashboard_image.path
            if os.path.isfile(image_path):
                os.remove(image_path)
        name = instance.name
        instance.delete()
        return Response(
            {"message": f"Dashboard '{name}' deleted successfully"},
            status=status.HTTP_200_OK,
        )


class PublicDashboardViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet
):
    """
    Public GET-only Dashboard API
    """
    permission_classes = [AllowAny]
    serializer_class = DashboardSerializer

    queryset = Dashboard.objects.select_related(
        "application"
    ).filter(
        publish=True,
        application__publish=True,
        application__is_active=True,
    ).order_by("-created_at")

    # ---------- LIST ----------
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()

        # Optional filter by application ID
        application_id = request.query_params.get("application")
        if application_id:
            queryset = queryset.filter(application_id=application_id)

        serializer = self.get_serializer(
            queryset,
            many=True,
            context={"request": request}
        )

        return Response(
            {
                "count": queryset.count(),
                "dashboards": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    # ---------- RETRIEVE ----------
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()

        serializer = self.get_serializer(
            instance,
            context={"request": request}
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

class DashboardComponentViewSet(viewsets.ModelViewSet):
    queryset = DashboardComponent.objects.all().order_by("order", "id")
    serializer_class = DashboardComponentSerializer

    # -------------------------------------------------
    # CREATE (SINGLE OR BULK)
    # -------------------------------------------------
    def create(self, request, *args, **kwargs):
        data = request.data

        # 🔹 BULK CREATE
        if isinstance(data, list):
            serializer = self.get_serializer(data=data, many=True)
            serializer.is_valid(raise_exception=True)
            components = serializer.save()

            return Response(
                {
                    "message": "Dashboard components created successfully",
                    "count": len(components),
                    "components": self.get_serializer(components, many=True).data,
                },
                status=status.HTTP_201_CREATED,
            )

        # 🔹 SINGLE CREATE
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        component = serializer.save()

        return Response(
            {
                "message": "Dashboard component created successfully",
                "component": self.get_serializer(component).data,
            },
            status=status.HTTP_201_CREATED,
        )

    # -------------------------------------------------
    # LIST
    # -------------------------------------------------
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()

        dashboard_id = request.query_params.get("dashboard")
        if dashboard_id:
            queryset = queryset.filter(dashboard_id=dashboard_id)

        serializer = self.get_serializer(queryset, many=True)
        return Response(
            {
                "count": queryset.count(),
                "components": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    # -------------------------------------------------
    # RETRIEVE
    # -------------------------------------------------
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)

        return Response(serializer.data, status=status.HTTP_200_OK)

    # -------------------------------------------------
    # UPDATE (PUT / PATCH)
    # -------------------------------------------------
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()

        serializer = self.get_serializer(
            instance,
            data=request.data,
            partial=partial,
        )
        serializer.is_valid(raise_exception=True)
        component = serializer.save()

        return Response(
            {
                "message": "Dashboard component updated successfully",
                "component": self.get_serializer(component).data,
            },
            status=status.HTTP_200_OK,
        )

    # -------------------------------------------------
    # DELETE
    # -------------------------------------------------
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.delete()

        return Response(
            {"message": "Dashboard component deleted successfully"},
            status=status.HTTP_200_OK,
        )



class PublicDashboardLoadAPIView(APIView):
    """
    Public API to load dashboard, application, cameras, and components
    """
    permission_classes = [AllowAny]

    def get(self, request, dashboard_id):
        try:
            dashboard = Dashboard.objects.select_related(
                "application"
            ).get(
                id=dashboard_id,
                publish=True,
                application__publish=True,
                application__is_active=True,
            )
        except Dashboard.DoesNotExist:
            return Response(
                {"error": "Dashboard not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        # Dashboard components (USE EXISTING SERIALIZER)
        components = DashboardComponent.objects.filter(
            dashboard=dashboard
        ).order_by("order", "id")

        # Application cameras (camera-only)
        camera_links = ApplicationHasCamera.objects.select_related(
            "camera"
        ).filter(
            application=dashboard.application,
            application__publish=True,
            application__is_active=True
        )

        return Response({
            # 1️⃣ Dashboard (direct serializer)
            "dashboard": DashboardSerializer(
                dashboard,
                context={"request": request}
            ).data,

            # 2️⃣ Application (direct serializer)
            "application": ApplicationSerializer(
                dashboard.application,
                context={"request": request}
            ).data,

            # 3️⃣ Cameras (ONLY camera_details list)
            "cameras": {
                "count": camera_links.count(),
                "camera_details": [
                    item["camera_details"]
                    for item in PublicCameraOnlySerializer(
                        camera_links,
                        many=True,
                        context={"request": request}
                    ).data
                ]
            },

            # 4️⃣ Dashboard components (direct serializer)
            "components": DashboardComponentSerializer(
                components,
                many=True
            ).data,
        }, status=status.HTTP_200_OK)