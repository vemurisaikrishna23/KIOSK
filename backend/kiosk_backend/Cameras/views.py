from rest_framework import viewsets, status
from rest_framework.response import Response
from .models import Camera
from .serializers import CameraSerializer
from .utils.mediamtx_updater import *
from rest_framework.permissions import IsAuthenticated
from kiosk_backend.permissions import HasCustomPermission
from django.db import transaction, IntegrityError


def _integrity_to_field_error(exc):
    """Turn a Postgres unique-constraint IntegrityError into a DRF-shaped
    field error dict so the frontend can render it inline. Returns None if
    the error isn't one we recognise."""
    msg = str(exc).lower()
    if 'cameras_camera_name_ci_uniq' in msg or 'camera_name' in msg:
        return {"camera_name": ["A camera with this name already exists."]}
    if 'stream_path' in msg:
        return {"stream_path": ["This stream path is already in use."]}
    if 'url' in msg:
        return {"url": ["A camera with this URL already exists."]}
    return None

class CameraViewSet(viewsets.ModelViewSet):
    """
    Camera CRUD APIs with YAML sync & Docker restart
    """
    permission_classes = [IsAuthenticated, HasCustomPermission]
    queryset = Camera.objects.filter(deleted_at__isnull=True).order_by("-created_at")
    serializer_class = CameraSerializer


    required_permissions = {
        "list": "camera_view",
        "retrieve": "camera_view",
        "create": "camera_create",
        "update": "camera_update",
        "partial_update": "camera_update",
        "destroy": "camera_delete",
    }
    # ------------------------- CREATE -------------------------
    def create(self, request, *args, **kwargs):
        # Hard-stop duplicate names BEFORE we even build the serializer.
        # Case-insensitive, ignores soft-deleted rows.
        name = (request.data.get("camera_name") or "").strip()
        existing_count = Camera.objects.filter(
            camera_name__iexact=name, deleted_at__isnull=True
        ).count() if name else 0
        print(f"[CAMERA CREATE] name={name!r}  existing_with_same_name={existing_count}", flush=True)
        if name and existing_count > 0:
            print(f"[CAMERA CREATE] REJECTED — duplicate of existing camera", flush=True)
            return Response(
                {"camera_name": ["A camera with this name already exists."]},
                status=400,
            )

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        try:
            with transaction.atomic():
                # ✅ Step 1: Save camera temporarily in DB
                camera = serializer.save(added_by=request.user if request.user.is_authenticated else None)

                # ✅ Step 2: Try YAML update
                success, msg = update_mediamtx_config(
                    stream_path=camera.stream_path,
                    url=camera.url,
                    old_stream_path=None
                )

                # ✅ Step 3: If YAML update fails → rollback DB record
                if not success:
                    raise Exception(f"YAML update failed: {msg}")

                # ✅ Step 4: If success → return success
                return Response({
                    "message": "Camera added successfully. YAML updated and MediaMTX Docker restarted.",
                    "camera": CameraSerializer(camera).data
                }, status=201)

        except IntegrityError as e:
            field_error = _integrity_to_field_error(e)
            if field_error:
                return Response(field_error, status=400)
            return Response({"message": "Camera creation failed.", "error": str(e)}, status=400)

        except Exception as e:
            # Rollback happens automatically on exception
            return Response({
                "message": "Camera creation failed.",
                "error": str(e)
            }, status=500)

    # ------------------------- UPDATE -------------------------
    # Fields users can actually change. Anything else in the payload is ignored.
    EDITABLE_FIELDS = [
        "camera_name", "description", "model_number",
        "protocol", "url", "stream_path", "is_active",
    ]
    # Fields that, if changed, require the MediaMTX YAML to be re-synced.
    MEDIAMTX_FIELDS = {"url", "stream_path"}

    def update(self, request, *args, **kwargs):
        instance = self.get_object()

        # 1️⃣ Snapshot the current row before touching anything.
        current = {f: getattr(instance, f) for f in self.EDITABLE_FIELDS}
        old_stream_path = current["stream_path"]

        # 2️⃣ Normalise the incoming payload (strip strings, empty → None for
        #    the two nullable text fields) and build a diff of only the
        #    fields whose value actually changed.
        changes = {}
        for field in self.EDITABLE_FIELDS:
            if field not in request.data:
                continue
            new_val = request.data.get(field)
            if isinstance(new_val, str):
                new_val = new_val.strip()
                if field in ("description", "model_number") and new_val == "":
                    new_val = None
            if new_val != current[field]:
                changes[field] = new_val

        # 3️⃣ Nothing actually changed → short-circuit, no DB write, no YAML.
        if not changes:
            return Response({
                "message": "No changes detected.",
                "camera": CameraSerializer(instance).data,
            }, status=200)

        # 4️⃣ Name change → must not collide with another camera (CI, excl. self).
        if "camera_name" in changes:
            new_name = changes["camera_name"]
            if not new_name:
                return Response(
                    {"camera_name": ["Camera name is required."]}, status=400
                )
            if Camera.objects.filter(
                camera_name__iexact=new_name, deleted_at__isnull=True
            ).exclude(pk=instance.pk).exists():
                return Response(
                    {"camera_name": ["A camera with this name already exists."]},
                    status=400,
                )

        # 5️⃣ Stream-path change → must not collide either.
        if "stream_path" in changes:
            new_sp = changes["stream_path"]
            if Camera.objects.filter(
                stream_path=new_sp, deleted_at__isnull=True
            ).exclude(pk=instance.pk).exists():
                return Response(
                    {"stream_path": ["This stream path is already used by another camera."]},
                    status=400,
                )

        # 6️⃣ URL change → must not collide either.
        if "url" in changes:
            new_url = changes["url"]
            if Camera.objects.filter(
                url=new_url, deleted_at__isnull=True
            ).exclude(pk=instance.pk).exists():
                return Response(
                    {"url": ["This URL is already used by another camera."]},
                    status=400,
                )

        # 7️⃣ Run remaining serializer validation on JUST the changed fields.
        serializer = self.get_serializer(instance, data=changes, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        try:
            with transaction.atomic():
                camera = serializer.save()

                # 8️⃣ Only resync MediaMTX if a MediaMTX-relevant field changed.
                if self.MEDIAMTX_FIELDS & changes.keys():
                    success, msg = update_mediamtx_config(
                        stream_path=camera.stream_path,
                        url=camera.url,
                        old_stream_path=old_stream_path,
                    )
                    if not success:
                        raise Exception(f"YAML update failed: {msg}")

                return Response({
                    "message": "Camera updated successfully.",
                    "fields_updated": list(changes.keys()),
                    "camera": CameraSerializer(camera).data,
                }, status=200)

        except IntegrityError as e:
            field_error = _integrity_to_field_error(e)
            if field_error:
                return Response(field_error, status=400)
            return Response({"message": "Camera update failed.", "error": str(e)}, status=400)

        except Exception as e:
            return Response({
                "message": "Camera update failed.",
                "error": str(e),
            }, status=500)



    def list(self, request, *args, **kwargs):
        """
        GET /api/cameras/
        Optional filters:
          - ?is_active=true / false
        Updates each camera’s status and viewer count dynamically.
        """
        # ---- 1️⃣ Handle Query Filter ----
        is_active_param = request.query_params.get("is_active", None)
        cameras = self.get_queryset()

        if is_active_param is not None:
            if is_active_param.lower() == "true":
                cameras = cameras.filter(is_active=True)
            elif is_active_param.lower() == "false":
                cameras = cameras.filter(is_active=False)

        # ---- 2️⃣ Get Live MediaMTX Data ----
        live_data = get_all_cameras_status()

        for cam in cameras:
            data = live_data.get(cam.stream_path, {"status": False, "viewers": 0})
            cam.status = data["status"]
            cam.viewers = data["viewers"]
            cam.save(update_fields=["status", "viewers"])

        # ---- 3️⃣ Serialize and Return ----
        serializer = self.get_serializer(cameras, many=True)
        return Response({
            "count": cameras.count(),
            "cameras": serializer.data
        }, status=status.HTTP_200_OK)

    # ----------------------- RETRIEVE -----------------------
    def retrieve(self, request, pk=None, *args, **kwargs):
        """
        GET /api/cameras/<id>/
        Fetch one camera’s live MediaMTX status using /paths/list filter.
        """
        try:
            cam = self.get_queryset().get(pk=pk)
        except Camera.DoesNotExist:
            return Response({"error": "Camera not found."}, status=404)

        data = get_camera_status_by_path(cam.stream_path)
        cam.status = data["status"]
        cam.viewers = data["viewers"]
        cam.save(update_fields=["status", "viewers"])

        serializer = self.get_serializer(cam)
        return Response(serializer.data, status=status.HTTP_200_OK)

    # ------------------------- DELETE -------------------------
    def destroy(self, request, pk=None, *args, **kwargs):
        try:
            camera = Camera.objects.get(pk=pk)
        except Camera.DoesNotExist:
            return Response({"error": "Camera not found."}, status=404)

        stream_path = camera.stream_path
        success, msg = remove_mediamtx_path(stream_path)
        camera.delete()

        if success:
            return Response({
                "message": f"Camera '{stream_path}' deleted and Docker restarted."
            }, status=200)
        else:
            return Response({
                "message": f"Camera deleted but YAML cleanup failed.",
                "error": msg
            }, status=207)
