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

        payload_update = request.data.get("payload")
        if payload_update:
            from .views_realtime import coerce_numeric_types, broadcast_ws
            existing = instance.payload or {}
            coerce_numeric_types(payload_update, existing)
            instance.merge_payload(payload_update)
            broadcast_ws(instance, "patch", "", payload_update)

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
    """
    CRUD for dashboards under an Application. Each Application can own many
    Dashboards, and each Dashboard owns many DashboardComponents (widgets).

    Gated by the same permission set as the parent Application — a user with
    only `application_view` can browse dashboards but not mutate them.
    """
    queryset = Dashboard.objects.select_related("application").order_by("-created_at")
    serializer_class = DashboardSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {
        "list":           "application_view",
        "retrieve":       "application_view",
        "create":         "application_update",
        "update":         "application_update",
        "partial_update": "application_update",
        "destroy":        "application_delete",
    }

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
                    "dashboard": DashboardSerializer(dashboard, context={"request": request}).data,
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
                    "dashboard": DashboardSerializer(dashboard, context={"request": request}).data,
                },
                status=status.HTTP_200_OK,
            )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # ---------- RETRIEVE ----------
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    # ---------- LIST ----------
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()

        # 🔹 Filter by application ID
        application_id = request.query_params.get("application")
        if application_id:
            queryset = queryset.filter(application_id=application_id)

        serializer = self.get_serializer(queryset, many=True, context={"request": request})
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
    """
    CRUD for dashboard widgets (rows in DashboardComponent). The widget's
    `config` JSONField holds the per-type configuration (bindings, ui,
    static). Permissions are inherited from the parent application via
    `application_view` / `application_update` / `application_delete`.
    """
    queryset = DashboardComponent.objects.select_related("dashboard").order_by("order", "id")
    serializer_class = DashboardComponentSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {
        "list":           "application_view",
        "retrieve":       "application_view",
        "create":         "application_update",
        "update":         "application_update",
        "partial_update": "application_update",
        "destroy":        "application_update",
    }

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

        # NOTE: a "view" is no longer counted here. Engagement is counted only
        # when a visitor actually JOINS the access queue (see
        # DashboardQueueConsumer._count_view), so the metric reflects real
        # interaction rather than every page open.

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

        # Devices for this application — needed so widgets have initial
        # payload snapshots to render against. The dashboard WS only
        # pushes deltas from this moment on (see _post_accept_setup in
        # DashboardRealtimeConsumer), so without seeding devices here a
        # public dashboard would render with empty values until the next
        # device update lands.
        devices = Device.objects.filter(
            application=dashboard.application
        ).order_by("device_name", "id")

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

            # 5️⃣ Devices — initial payload snapshot for widgets
            "devices": DeviceSerializer(
                devices,
                many=True,
                context={"request": request}
            ).data,
        }, status=status.HTTP_200_OK)


class PublicAnalyticsAPIView(APIView):
    """
    Public, no-auth analytics summary for the /public landing page.

    Returns top-level totals across every published application + a
    per-application breakdown. Each count is restricted to entities
    that belong to an `is_active + publish=True` application so it
    matches what's actually viewable on the public side.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        apps_qs = Application.objects.filter(
            is_active=True,
            publish=True,
        ).order_by("-created_at")

        dashboards_qs = Dashboard.objects.filter(
            publish=True,
            application__is_active=True,
            application__publish=True,
        )
        cameras_qs = ApplicationHasCamera.objects.filter(
            application__is_active=True,
            application__publish=True,
        )
        devices_qs = Device.objects.filter(
            application__is_active=True,
            application__publish=True,
        )

        from django.db.models import Count, Q, Sum
        total_tries = apps_qs.aggregate(s=Sum("public_views"))["s"] or 0

        totals = {
            "applications":     apps_qs.count(),
            "dashboards":       dashboards_qs.count(),
            "cameras":          cameras_qs.count(),
            "devices":          devices_qs.count(),
            "devices_connected": devices_qs.filter(is_connected=True).count(),
            # Engagement metric — total number of public dashboard opens
            # ("tries") across every published application.
            "tries":            total_tries,
        }

        # Per-app breakdown — small payload, no N+1 because we project
        # the counts via a single query per relation. Ordered by popularity
        # (most-tried first) so the breakdown reads as a leaderboard.
        per_app_rows = apps_qs.annotate(
            dashboards_count=Count(
                "dashboards",
                filter=Q(dashboards__publish=True),
                distinct=True,
            ),
            devices_count=Count("devices", distinct=True),
            devices_connected_count=Count(
                "devices",
                filter=Q(devices__is_connected=True),
                distinct=True,
            ),
            cameras_count=Count("camera_links", distinct=True),
        ).order_by("-public_views", "-created_at").values(
            "id",
            "name",
            "public_views",
            "dashboards_count",
            "devices_count",
            "devices_connected_count",
            "cameras_count",
        )

        # Materialize and surface the app name under the alias the
        # frontend expects so we don't need to special-case which field
        # name to read.
        per_app_list = list(per_app_rows)
        for row in per_app_list:
            row["application_name"] = row.pop("name")
            row["tries"] = row.pop("public_views")

        return Response(
            {
                "totals": totals,
                "applications": per_app_list,
            },
            status=status.HTTP_200_OK,
        )


class ApplicationViewsTimeseriesAPIView(APIView):
    """
    Authenticated daily-views time series for the admin dashboard's views
    graph. Returns one point per calendar day for the last `days` days
    (default 7, capped at 90). Pass `?application=<id>` to scope to a single
    application; omit it to aggregate views across every application.

    Response: { days, application, total, series: [{ date, views }, …] }
    Days with no recorded views are returned as zero so the chart is
    continuous.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import timedelta, date as date_cls
        from django.db.models import Sum
        from django.utils import timezone

        today = timezone.localdate()
        app_id = request.query_params.get("application") or None

        def _parse(s):
            try:
                parts = [int(x) for x in str(s).split("-")[:3]]
                return date_cls(parts[0], parts[1], parts[2])
            except Exception:
                return None

        # Custom range takes priority when both bounds are supplied; otherwise
        # fall back to a rolling "last N days" window.
        start = _parse(request.query_params.get("start"))
        end = _parse(request.query_params.get("end"))

        if start and end:
            if end < start:
                return Response(
                    {"detail": "end date must be on or after start date."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Cap the span so a wild range can't return thousands of points.
            if (end - start).days > 366:
                start = end - timedelta(days=366)
        else:
            try:
                days = int(request.query_params.get("days", 7))
            except (TypeError, ValueError):
                days = 7
            days = max(1, min(days, 366))
            end = today
            start = today - timedelta(days=days - 1)

        span = (end - start).days + 1

        qs = ApplicationDailyView.objects.filter(date__gte=start, date__lte=end)
        if app_id:
            qs = qs.filter(application_id=app_id)

        by_date = {
            row["date"]: row["c"]
            for row in qs.values("date").annotate(c=Sum("count"))
        }

        series = []
        for i in range(span):
            d = start + timedelta(days=i)
            series.append({"date": d.isoformat(), "views": by_date.get(d, 0) or 0})

        return Response(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "days": span,
                "application": int(app_id) if app_id else None,
                "total": sum(s["views"] for s in series),
                "series": series,
            },
            status=status.HTTP_200_OK,
        )


def _activity_log_range(qp):
    """
    Resolve (start_date, end_date, error) from the request query params:
      • ?start=YYYY-MM-DD&end=YYYY-MM-DD  → that range (span capped at 30 days)
      • ?days=N                           → the last N days (1..30, default 1)
    """
    from datetime import timedelta, date as date_cls
    from django.utils import timezone
    today = timezone.localdate()

    def _pdate(s):
        try:
            y, m, d = [int(x) for x in str(s).split("-")[:3]]
            return date_cls(y, m, d)
        except Exception:
            return None

    sd = _pdate(qp.get("start"))
    ed = _pdate(qp.get("end"))
    if sd and ed:
        if ed < sd:
            return None, None, "end date must be on or after start date."
        if (ed - sd).days > 30:
            sd = ed - timedelta(days=30)
        return sd, ed, None

    try:
        days = int(qp.get("days", 1))
    except (TypeError, ValueError):
        days = 1
    days = max(1, min(days, 30))
    return today - timedelta(days=days - 1), today, None


class ActivityLogListAPIView(APIView):
    """
    Authenticated read of the internal activity log.

    Two modes:
      • ?limit=N            → latest N entries (dashboard "Recent activity").
      • ?days / ?start+?end → date-range window (default last 1 day, max 30)
                              with ?page / ?page_size pagination (Activity Log page).
    Always opportunistically purges entries past the 30-day retention window.
    Optional ?category= filter in both modes.
    """
    permission_classes = [IsAuthenticated]
    LOG_FIELDS = ("id", "category", "action", "entity_name", "message", "actor_name", "created_at")

    def get(self, request):
        try:
            ActivityLog.purge_old()
        except Exception:
            pass

        qp = request.query_params
        qs = ActivityLog.objects.all()
        category = qp.get("category") or None
        if category:
            qs = qs.filter(category=category)

        # Dashboard widget mode — latest N, no date filter / pagination.
        limit = qp.get("limit")
        if limit is not None:
            try:
                limit = max(1, min(int(limit), 200))
            except (TypeError, ValueError):
                limit = 6
            return Response(
                {"count": qs.count(), "logs": list(qs[:limit].values(*self.LOG_FIELDS))},
                status=status.HTTP_200_OK,
            )

        # Page mode — date range + pagination.
        sd, ed, err = _activity_log_range(qp)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        qs = qs.filter(created_at__date__gte=sd, created_at__date__lte=ed)
        total = qs.count()

        try:
            page = max(1, int(qp.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = max(1, min(int(qp.get("page_size", 25)), 100))
        except (TypeError, ValueError):
            page_size = 25
        offset = (page - 1) * page_size

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "start": sd.isoformat(),
            "end": ed.isoformat(),
            "logs": list(qs[offset:offset + page_size].values(*self.LOG_FIELDS)),
        }, status=status.HTTP_200_OK)


class ActivityLogExportAPIView(APIView):
    """CSV export of the activity log for a date range — gated by the download permission."""
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {"list": "activity_log_download"}

    def get(self, request):
        import csv
        from io import StringIO
        from django.http import HttpResponse

        qp = request.query_params
        sd, ed, err = _activity_log_range(qp)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        qs = ActivityLog.objects.all()
        category = qp.get("category") or None
        if category:
            qs = qs.filter(category=category)
        qs = qs.filter(created_at__date__gte=sd, created_at__date__lte=ed)[:10000]

        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(["When", "Category", "Action", "Entity", "Detail", "Actor"])
        for log in qs:
            writer.writerow([
                log.created_at.isoformat() if log.created_at else "",
                log.get_category_display(),
                log.get_action_display(),
                log.entity_name,
                log.message,
                log.actor_name,
            ])

        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = (
            f'attachment; filename="activity-logs_{sd.isoformat()}_to_{ed.isoformat()}.csv"'
        )
        return resp


def _safe_filename_part(s):
    """Slugify a name for use inside a Content-Disposition filename."""
    cleaned = "".join(c if (c.isalnum() or c in "-_") else "-" for c in (s or ""))
    return (cleaned.strip("-") or "user")[:40]


class UserActivityLogListAPIView(APIView):
    """
    The activity performed BY a single user — their personal audit trail.

    Same date-range + pagination + category contract as the global activity
    log, but scoped to `actor = <user_id>`. Gated by the user_activity_view
    permission (separate from the global activity_log_view).
    """
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {"list": "user_activity_view"}
    LOG_FIELDS = ("id", "category", "action", "entity_name", "message", "actor_name", "created_at")

    def get(self, request, user_id):
        from UserAccounts.models import User
        user = User.objects.filter(pk=user_id).first()
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            ActivityLog.purge_old()
        except Exception:
            pass

        qp = request.query_params
        qs = ActivityLog.objects.filter(actor_id=user.id)
        category = qp.get("category") or None
        if category:
            qs = qs.filter(category=category)

        sd, ed, err = _activity_log_range(qp)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        qs = qs.filter(created_at__date__gte=sd, created_at__date__lte=ed)
        total = qs.count()

        try:
            page = max(1, int(qp.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = max(1, min(int(qp.get("page_size", 25)), 100))
        except (TypeError, ValueError):
            page_size = 25
        offset = (page - 1) * page_size

        return Response({
            "user": {"id": user.id, "name": user.name, "email": user.email},
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "start": sd.isoformat(),
            "end": ed.isoformat(),
            "logs": list(qs[offset:offset + page_size].values(*self.LOG_FIELDS)),
        }, status=status.HTTP_200_OK)


class UserActivityLogExportAPIView(APIView):
    """CSV export of a single user's activity — gated by user_activity_download."""
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {"list": "user_activity_download"}

    def get(self, request, user_id):
        import csv
        from io import StringIO
        from django.http import HttpResponse
        from UserAccounts.models import User

        user = User.objects.filter(pk=user_id).first()
        if not user:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        qp = request.query_params
        sd, ed, err = _activity_log_range(qp)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        qs = ActivityLog.objects.filter(actor_id=user.id)
        category = qp.get("category") or None
        if category:
            qs = qs.filter(category=category)
        qs = qs.filter(created_at__date__gte=sd, created_at__date__lte=ed)[:10000]

        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(["When", "Category", "Action", "Entity", "Detail", "Actor"])
        for log in qs:
            writer.writerow([
                log.created_at.isoformat() if log.created_at else "",
                log.get_category_display(),
                log.get_action_display(),
                log.entity_name,
                log.message,
                log.actor_name,
            ])

        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        who = _safe_filename_part(user.name or user.email or f"user-{user.id}")
        resp["Content-Disposition"] = (
            f'attachment; filename="user-activity_{who}_{sd.isoformat()}_to_{ed.isoformat()}.csv"'
        )
        return resp


# =====================================================================
# SSL Certificate management
# =====================================================================
from django.http import FileResponse, Http404
from django.views import View

class SSLCertificateViewSet(viewsets.ModelViewSet):
    """
    Admin CRUD for SSL certificates. Uploading a new certificate
    automatically deactivates the previous one (singleton pattern in
    the model's save()).
    """
    queryset = SSLCertificate.objects.all()
    serializer_class = SSLCertificateSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {
        "list":           "ssl_certificate_view",
        "retrieve":       "ssl_certificate_view",
        "create":         "ssl_certificate_upload",
        "update":         "ssl_certificate_upload",
        "partial_update": "ssl_certificate_upload",
        "destroy":        "ssl_certificate_delete",
    }

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        active = qs.filter(is_active=True).first()
        return Response({
            "count":   qs.count(),
            "active":  SSLCertificateSerializer(active, context={"request": request}).data if active else None,
            "certificates": SSLCertificateSerializer(qs, many=True, context={"request": request}).data,
        }, status=status.HTTP_200_OK)


class PublicSSLCertificateDownloadView(View):
    """
    Public, no-auth download of the currently-active SSL certificate.
    This is the file hardware devices fetch to trust the backend over
    HTTPS / WSS. Served at /cert/server.crt at the project root.
    """
    def get(self, request):
        cert = SSLCertificate.objects.filter(is_active=True).order_by("-uploaded_at").first()
        if not cert or not cert.file:
            raise Http404("No active SSL certificate is available for download.")
        resp = FileResponse(cert.file.open("rb"), content_type="application/x-x509-ca-cert")
        resp["Content-Disposition"] = 'attachment; filename="server.crt"'
        return resp


# =====================================================================
# Contact Us submissions  +  Company Information
# =====================================================================
class ContactSubmissionViewSet(viewsets.ModelViewSet):
    """
    Admin triage for messages sent from the public Contact Us form.
    Listing / status updates / deletion are permission-gated; the public
    intake is a separate AllowAny endpoint (PublicContactSubmissionView).
    """
    queryset = ContactSubmission.objects.all().order_by("-created_at")
    serializer_class = ContactSubmissionSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {
        "list":           "contact_submission_view",
        "retrieve":       "contact_submission_view",
        "update":         "contact_submission_update",
        "partial_update": "contact_submission_update",
        "destroy":        "contact_submission_delete",
    }

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        # Counts per status for the page's stat tiles.
        from django.db.models import Count
        counts = {row["status"]: row["c"] for row in
                  self.get_queryset().values("status").annotate(c=Count("id"))}
        serializer = self.get_serializer(qs, many=True)
        return Response({
            "count": qs.count(),
            "status_counts": counts,
            "submissions": serializer.data,
        }, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({
            "message": "Submission updated.",
            "submission": serializer.data,
        }, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.delete()
        return Response({"message": "Submission deleted."}, status=status.HTTP_200_OK)


class PublicContactSubmissionView(APIView):
    """No-auth intake for the public landing page's Contact Us form."""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PublicContactSubmissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            {"message": "Thanks for reaching out — our team will get back to you shortly."},
            status=status.HTTP_201_CREATED,
        )


class CompanyInformationViewSet(viewsets.ModelViewSet):
    """
    Admin CRUD for company contact details shown on the public landing
    page. Multiple records may exist but only ONE is active at a time
    (singleton enforced in the model's save()).
    """
    queryset = CompanyInformation.objects.all()
    serializer_class = CompanyInformationSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]
    required_permissions = {
        "list":           "company_info_view",
        "retrieve":       "company_info_view",
        "create":         "company_info_create",
        "update":         "company_info_update",
        "partial_update": "company_info_update",
        "destroy":        "company_info_delete",
    }

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        active = qs.filter(is_active=True).first()
        return Response({
            "count": qs.count(),
            "active": CompanyInformationSerializer(active).data if active else None,
            "records": CompanyInformationSerializer(qs, many=True).data,
        }, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Never delete the live address — one record must always stay active.
        if instance.is_active and CompanyInformation.objects.exclude(pk=instance.pk).exists():
            return Response(
                {"detail": "Cannot delete the active record. Activate another one first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.delete()
        # Safety net: if nothing is active but records remain, promote the latest.
        if not CompanyInformation.objects.filter(is_active=True).exists():
            latest = CompanyInformation.objects.order_by("-updated_at").first()
            if latest:
                latest.is_active = True
                latest.save()
        return Response({"message": "Record deleted."}, status=status.HTTP_200_OK)


class PublicCompanyInformationView(APIView):
    """No-auth read of the active company info for the public landing page."""
    permission_classes = [AllowAny]

    def get(self, request):
        info = CompanyInformation.objects.filter(is_active=True).order_by("-updated_at").first()
        return Response(
            {"company": CompanyInformationSerializer(info).data if info else None},
            status=status.HTTP_200_OK,
        )
