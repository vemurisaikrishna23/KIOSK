from rest_framework import serializers
from .models import *
from django.contrib.auth.hashers import check_password
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth.hashers import make_password

class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ['id', 'name', 'short_name', 'policy']


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=True
    )
    permission_details = PermissionSerializer(
        source='permissions', many=True, read_only=True
    )

    class Meta:
        model = Role
        fields = ['id', 'name', 'description', 'permissions', 'permission_details', 'created_at', 'updated_at']

    def validate_permissions(self, value):
        """Validate that all permission IDs exist and are not empty"""
        if not value:
            raise serializers.ValidationError("At least one permission ID is required.")
        
        # Fetch all valid permission IDs from DB
        existing_ids = set(Permission.objects.filter(id__in=value).values_list('id', flat=True))
        invalid_ids = [pid for pid in value if pid not in existing_ids]
        
        if invalid_ids:
            raise serializers.ValidationError(f"Invalid permission IDs: {invalid_ids}")
        
        return value

    def create(self, validated_data):
        permissions = validated_data.pop('permissions', [])
        role = Role.objects.create(**validated_data)

        # Add permissions
        for pid in permissions:
            RoleHasPermission.objects.create(role=role, permission_id=pid)

        return role

    def update(self, instance, validated_data):
        permissions = validated_data.pop('permissions', None)
        instance.name = validated_data.get('name', instance.name)
        instance.description = validated_data.get('description', instance.description)
        instance.save()

        if permissions is not None:
            # Validate permissions again
            existing_ids = set(Permission.objects.filter(id__in=permissions).values_list('id', flat=True))
            invalid_ids = [pid for pid in permissions if pid not in existing_ids]
            if invalid_ids:
                raise serializers.ValidationError(f"Invalid permission IDs: {invalid_ids}")

            # Clear old permissions
            RoleHasPermission.objects.filter(role=instance).delete()

            # Add new permissions
            for pid in permissions:
                RoleHasPermission.objects.create(role=instance, permission_id=pid)

        return instance



class UserSerializer(serializers.ModelSerializer):
    roles = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=True
    )
    role_details = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'name', 'email', 'country_code', 'mobile',
            'password', 'roles', 'role_details',
            'created_at', 'updated_at', 'deleted_at'
        ]
        extra_kwargs = {
            'password': {'write_only': True}
        }

    def get_role_details(self, obj):
        """Return roles with ID & name"""
        return [{"id": r.id, "name": r.name} for r in obj.roles.all()]

    def validate_roles(self, value):
        """Ensure all provided role IDs exist"""
        if not value:
            raise serializers.ValidationError("At least one role ID is required.")
        existing = set(Role.objects.filter(id__in=value).values_list('id', flat=True))
        invalid = [rid for rid in value if rid not in existing]
        if invalid:
            raise serializers.ValidationError(f"Invalid role IDs: {invalid}")
        return value

    def create(self, validated_data):
        roles = validated_data.pop('roles', [])
        # Encrypt password
        validated_data['password'] = make_password(validated_data['password'])
        user = User.objects.create(**validated_data)

        for rid in roles:
            UserHasRole.objects.create(user=user, role_id=rid)

        return user

    
    def update(self, instance, validated_data):
        roles = validated_data.pop('roles', None)
        password = validated_data.pop('password', None)

        # Hash password if provided
        if password:
            instance.password = make_password(password)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        instance.save()

        if roles is not None:
            existing = set(Role.objects.filter(id__in=roles).values_list('id', flat=True))
            invalid = [rid for rid in roles if rid not in existing]
            if invalid:
                raise serializers.ValidationError(f"Invalid role IDs: {invalid}")

            UserHasRole.objects.filter(user=instance).delete()
            for rid in roles:
                UserHasRole.objects.create(user=instance, role_id=rid)

        return instance
    

class LoginSerializer(serializers.Serializer):
    email_or_mobile = serializers.CharField(required=True)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        email_or_mobile = attrs.get('email_or_mobile')
        password = attrs.get('password')

        # Try to get user by email or mobile
        user = User.objects.filter(email=email_or_mobile).first() or \
               User.objects.filter(mobile=email_or_mobile).first()

        if not user:
            raise serializers.ValidationError("Invalid email/mobile or password.")

        if user.is_deleted():
            raise serializers.ValidationError("This account is deactivated or deleted.")

        if not check_password(password, user.password):
            raise serializers.ValidationError("Invalid email/mobile or password.")

        # Generate JWT tokens
        refresh = RefreshToken.for_user(user)

        # 🔹 Build roles and permissions mapping
        roles_with_permissions = []
        for role in user.roles.all():
            permissions = (
                role.permissions.values("id", "name", "short_name","policy")
                if hasattr(role, "permissions")
                else []
            )
            roles_with_permissions.append({
                "id": role.id,
                "name": role.name,
                "permissions": list(permissions),
            })

        # ✅ Final response payload
        return {
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "mobile": user.mobile,
                "roles": roles_with_permissions,
            },
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        }


# class LoginSerializer(serializers.Serializer):
#     email_or_mobile = serializers.CharField(required=True)
#     password = serializers.CharField(write_only=True)

#     def validate(self, attrs):
#         email_or_mobile = attrs.get('email_or_mobile')
#         password = attrs.get('password')

#         # Try to get user by email or mobile
#         user = User.objects.filter(email=email_or_mobile).first() or \
#                User.objects.filter(mobile=email_or_mobile).first()

#         if not user:
#             raise serializers.ValidationError("Invalid email/mobile or password.")

#         if user.is_deleted():
#             raise serializers.ValidationError("This account is deactivated or deleted.")

#         if not check_password(password, user.password):
#             raise serializers.ValidationError("Invalid email/mobile or password.")

#         # Generate JWT tokens
#         refresh = RefreshToken.for_user(user)

#         roles = [{"id": r.id, "name": r.name} for r in user.roles.all()]

#         return {
#             "user": {
#                 "id": user.id,
#                 "name": user.name,
#                 "email": user.email,
#                 "mobile": user.mobile,
#                 "roles": roles,
#             },
#             "access": str(refresh.access_token),
#             "refresh": str(refresh),
#         }
