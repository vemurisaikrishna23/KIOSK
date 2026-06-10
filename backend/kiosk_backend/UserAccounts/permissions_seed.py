from UserAccounts.models import Permission
from django.utils import timezone

def create_default_permissions():
    permissions = [
        # ------------------ USER MANAGEMENT ------------------
        {"name": "View User", "short_name": "user_view", "policy": "User"},
        {"name": "Create User", "short_name": "user_create", "policy": "User"},
        {"name": "Update User", "short_name": "user_update", "policy": "User"},
        {"name": "Delete User", "short_name": "user_delete", "policy": "User"},
        {"name": "Restore User", "short_name": "user_restore", "policy": "User"},


        # ------------------ ROLE MANAGEMENT ------------------
        {"name": "View Roles", "short_name": "role_view", "policy": "Role"},
        {"name": "Create Role", "short_name": "role_create", "policy": "Role"},
        {"name": "Update Role", "short_name": "role_update", "policy": "Role"},
        {"name": "Delete Role", "short_name": "role_delete", "policy": "Role"},

                # ------------------ CAMERA MANAGEMENT ------------------
        {"name": "View Camera", "short_name": "camera_view", "policy": "Camera"},
        {"name": "Create Camera", "short_name": "camera_create", "policy": "Camera"},
        {"name": "Update Camera", "short_name": "camera_update", "policy": "Camera"},
        {"name": "Delete Camera", "short_name": "camera_delete", "policy": "Camera"},

                # ------------------ APPLICATION MANAGEMENT ------------------
        {"name": "View Application", "short_name": "application_view", "policy": "Application"},
        {"name": "Create Application", "short_name": "application_create", "policy": "Application"},
        {"name": "Update Application", "short_name": "application_update", "policy": "Application"},
        {"name": "Delete Application", "short_name": "application_delete", "policy": "Application"},

                # ------------------ SSL CERTIFICATE MANAGEMENT ------------------
        {"name": "View SSL Certificate",   "short_name": "ssl_certificate_view",   "policy": "SSLCertificate"},
        {"name": "Upload SSL Certificate", "short_name": "ssl_certificate_upload", "policy": "SSLCertificate"},
        {"name": "Delete SSL Certificate", "short_name": "ssl_certificate_delete", "policy": "SSLCertificate"},
    ]

    for perm in permissions:
        obj, created = Permission.objects.get_or_create(
            short_name=perm["short_name"],
            defaults={
                "name": perm["name"],
                "policy": perm["policy"],
                "created_at": timezone.now(),
                "updated_at": timezone.now(),
            },
        )
        if created:
            print(f"✅ Created permission: {obj.name}")
        else:
            print(f"⚠️ Already exists: {obj.name}")

    print("🎉 Default permissions setup completed.")
