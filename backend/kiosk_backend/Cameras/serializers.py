# from rest_framework import serializers
# from .models import Camera

# class CameraSerializer(serializers.ModelSerializer):
#     class Meta:
#         model = Camera
#         fields = [
#             'id', 'camera_name', 'description', 'model_number',
#             'protocol', 'url', 'stream_path', 'webrtc_url',
#             'status', 'is_active', 'created_at', 'updated_at'
#         ]
#         read_only_fields = ['status', 'is_active', 'created_at', 'updated_at']

#     def validate(self, data):
#         required = ['camera_name', 'model_number', 'protocol', 'url', 'stream_path']
#         if self.instance is None:  # Create
#             missing = [f for f in required if f not in data or not data[f]]
#             if missing:
#                 raise serializers.ValidationError(f"Missing required fields: {', '.join(missing)}")

#         url = data.get('url')
#         stream_path = data.get('stream_path')

#         # For update → exclude self
#         qs_url = Camera.objects.filter(url=url, deleted_at__isnull=True)
#         qs_stream = Camera.objects.filter(stream_path=stream_path, deleted_at__isnull=True)
#         if self.instance:
#             qs_url = qs_url.exclude(id=self.instance.id)
#             qs_stream = qs_stream.exclude(id=self.instance.id)

#         # Duplicate URL check
#         if url and qs_url.exists():
#             raise serializers.ValidationError({
#                 "url": "A camera with this URL already exists."
#             })

#         # Duplicate stream_path check
#         if stream_path and qs_stream.exists():
#             raise serializers.ValidationError({
#                 "stream_path": "This stream path is already in use by another camera."
#             })

#         return data

#     def update(self, instance, validated_data):
#         # Only allow updating these six fields
#         allowed_fields = [
#             'camera_name',
#             'description',
#             'model_number',
#             'protocol',
#             'url',
#             'stream_path'
#         ]
#         for field, value in validated_data.items():
#             if field in allowed_fields:
#                 setattr(instance, field, value)
#         instance.save()
#         return instance

from rest_framework import serializers
from .models import Camera
from .utils.url_generator import generate_webrtc_url
class CameraSerializer(serializers.ModelSerializer):
    class Meta:
        model = Camera
        fields = [
            "id", "camera_name", "description", "model_number",
            "protocol", "url", "stream_path", "webrtc_url",
            "status", "is_active", "created_at", "updated_at", "viewers"
        ]
        read_only_fields = ["webrtc_url", "status", "created_at", "updated_at"]

    # ✅ Full validation for duplicates
    def validate(self, data):
        url = data.get("url")
        stream_path = data.get("stream_path")
        camera_name = data.get("camera_name")

        # On create → must not exist
        if not self.instance:
            if camera_name and Camera.objects.filter(
                camera_name__iexact=camera_name, deleted_at__isnull=True
            ).exists():
                raise serializers.ValidationError({"camera_name": "A camera with this name already exists."})
            if Camera.objects.filter(url=url, deleted_at__isnull=True).exists():
                raise serializers.ValidationError({"url": "A camera with this URL already exists."})
            if Camera.objects.filter(stream_path=stream_path, deleted_at__isnull=True).exists():
                raise serializers.ValidationError({"stream_path": "This stream path is already in use."})

        # On update → must not conflict with others
        else:
            qs = Camera.objects.filter(deleted_at__isnull=True).exclude(id=self.instance.id)
            if camera_name and qs.filter(camera_name__iexact=camera_name).exists():
                raise serializers.ValidationError({"camera_name": "This name is already used by another camera."})
            if url and qs.filter(url=url).exists():
                raise serializers.ValidationError({"url": "This URL is already used by another camera."})
            if stream_path and qs.filter(stream_path=stream_path).exists():
                raise serializers.ValidationError({"stream_path": "This stream path is already used by another camera."})

        return data

    # ✅ Auto-generate webrtc_url when created
    def create(self, validated_data):
        stream_path = validated_data.get("stream_path")
        validated_data["webrtc_url"] = generate_webrtc_url(stream_path)
        return super().create(validated_data)

    # ✅ Update only allowed fields
    def update(self, instance, validated_data):
        allowed_fields = [
            "camera_name", "description", "model_number",
            "protocol", "url", "stream_path", "is_active"
        ]
        for field, value in validated_data.items():
            if field in allowed_fields:
                setattr(instance, field, value)

        # regenerate webrtc URL if stream path changes
        if "stream_path" in validated_data:
            instance.webrtc_url = generate_webrtc_url(validated_data["stream_path"])

        instance.save()
        return instance