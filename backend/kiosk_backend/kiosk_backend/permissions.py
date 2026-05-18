from rest_framework.permissions import BasePermission
from UserAccounts.models import RoleHasPermission, Permission

class HasCustomPermission(BasePermission):
    """
    Checks if the logged-in user has permission for this action.
    Works for both ModelViewSets and APIViews (with HTTP fallback).
    """

    def has_permission(self, request, view):
        user = request.user

        # 1️⃣ Must be authenticated
        if not user or not user.is_authenticated:
            return False

        # 2️⃣ Superuser bypass
        if getattr(user, "is_superuser", False):
            return True

        # 3️⃣ Ensure roles exist
        if not hasattr(user, "roles"):
            return False

        # 4️⃣ Get required permission (prefer action, fallback to HTTP method)
        action = getattr(view, "action", None)
        permission_map = getattr(view, "required_permissions", {})

        # Fallback for non-ViewSet APIViews
        if not action:
            method_map = {
                "GET": "list",
                "POST": "create",
                "PUT": "update",
                "PATCH": "partial_update",
                "DELETE": "destroy",
            }
            action = method_map.get(request.method, None)

        required_perm = permission_map.get(action)

        if not required_perm:
            # No permission defined → allow
            return True

        # 5️⃣ Fetch user’s permissions via RoleHasPermission
        role_ids = user.roles.values_list("id", flat=True)
        user_permissions = set(
            RoleHasPermission.objects.filter(role_id__in=role_ids)
            .select_related("permission")
            .values_list("permission__short_name", flat=True)
        )

        # 6️⃣ Debugging
        print(f"[PERMISSION CHECK] user={user.email}, action={action}, required={required_perm}, has={user_permissions}")

        # 7️⃣ Return check result
        return required_perm in user_permissions
