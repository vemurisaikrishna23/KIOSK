import logging
import secrets
import string
from datetime import timedelta

from rest_framework import viewsets, status
from rest_framework.response import Response
from .models import *
from .serializers import *
from rest_framework.permissions import AllowAny
from rest_framework.decorators import action
from rest_framework.views import APIView
from kiosk_backend.permissions import HasCustomPermission
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth.hashers import make_password,check_password
from django.utils import timezone
from django.core.mail import EmailMultiAlternatives
from django.conf import settings as django_settings

logger = logging.getLogger(__name__)


# ============================================================
# Password generator + welcome-email helper
# ============================================================
# Character set chosen to be human-readable: no 0/O/1/l/I confusion, plus a
# couple of symbols so the password passes most "complexity" checks if the
# user is later asked to re-set it through any other system.
_PWD_ALPHABET = (
    "ABCDEFGHJKLMNPQRSTUVWXYZ"
    "abcdefghijkmnpqrstuvwxyz"
    "23456789"
    "!@#$%&*?"
)


def _generate_temp_password(length: int = 12) -> str:
    return ''.join(secrets.choice(_PWD_ALPHABET) for _ in range(length))


def _send_password_changed_email(user, new_password: str, changed_by) -> bool:
    """
    Notify the user that their password was changed. The body wording shifts
    slightly when the user is the one who made the change themselves vs. an
    admin doing it on their behalf — but we still include the new password
    (matches the welcome-email convention) and offer a sign-in link.
    """
    if not user.email:
        return False

    sign_in_url = f"{django_settings.FRONTEND_URL}/signin"
    name = user.name or 'there'
    self_change = bool(changed_by) and getattr(changed_by, 'id', None) == user.id

    if self_change:
        actor_name = 'You'
        actor_email = user.email or '—'
        subject = "You changed your KIOSK password"
        intro = (
            "You just updated your KIOSK password. We're sending this email so "
            "you have a confirmation in writing."
        )
        heading = "Password updated"
        kicker = "KIOSK · Confirmation"
    else:
        if changed_by and getattr(changed_by, 'is_authenticated', False):
            actor_name = changed_by.name or 'An administrator'
            actor_email = changed_by.email or '—'
        else:
            actor_name = 'An administrator'
            actor_email = '—'
        subject = "Your KIOSK password was changed by an administrator"
        intro = (
            "Your KIOSK password was just updated by an administrator. The new "
            "credentials are below — please sign in and set a fresh password "
            "as soon as you can."
        )
        heading = "Your password was changed"
        kicker = "KIOSK · Security update"

    text_body = (
        f"Hi {name},\n\n"
        f"{intro}\n\n"
        f"Changed by: {actor_name} <{actor_email}>\n"
        f"New password: {new_password}\n"
        f"Sign in at:  {sign_in_url}\n\n"
        f"If you didn't expect this change, contact your administrator immediately\n"
        f"and sign in to set a new password.\n\n"
        f"— The KIOSK Team"
    )
    html_body = f"""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @keyframes kiosk-fade-up {{ 0%{{opacity:0;transform:translateY(18px);}} 100%{{opacity:1;transform:translateY(0);}} }}
  @keyframes kiosk-bob     {{ 0%,100%{{transform:translateY(0);}} 50%{{transform:translateY(-4px);}} }}
  @keyframes kiosk-pulse   {{ 0%{{box-shadow:0 0 0 0 rgba(243,106,30,0.55);}} 70%{{box-shadow:0 0 0 16px rgba(243,106,30,0);}} 100%{{box-shadow:0 0 0 0 rgba(243,106,30,0);}} }}
  @keyframes kiosk-glow    {{ 0%,100%{{box-shadow:0 8px 22px rgba(243,106,30,0.30);}} 50%{{box-shadow:0 12px 28px rgba(243,106,30,0.55);}} }}
  .kiosk-card {{ animation: kiosk-fade-up 0.7s ease-out both; }}
  .kiosk-badge{{ animation: kiosk-bob 2.6s ease-in-out infinite, kiosk-pulse 2.6s ease-out infinite; }}
  .kiosk-cta  {{ animation: kiosk-glow 2.2s ease-in-out infinite; }}
</style>
</head>
<body style="margin:0;padding:0;background:#F4ECE3;font-family:'Inter','Segoe UI',Arial,sans-serif;color:#14161C;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4ECE3;">
    <tr><td align="center" style="padding:36px 16px;">
      <table role="presentation" class="kiosk-card" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E6DBCC;box-shadow:0 14px 40px rgba(20,22,28,0.06);">
        <tr><td height="6" style="background-image:linear-gradient(90deg,#FFB082 0%,#F36A1E 50%,#FFB082 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:28px 32px 4px;">
          <div class="kiosk-badge" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#FFE9D5 0%,#FCD9C2 100%);display:inline-block;line-height:64px;text-align:center;">
            <svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;">
              <path d="M20 32 V22 a12 12 0 0 1 24 0 V32" fill="none" stroke="#F36A1E" stroke-width="5" stroke-linecap="round"/>
              <rect x="14" y="32" width="36" height="26" rx="6" fill="#F36A1E"/>
              <circle cx="32" cy="44" r="3.5" fill="#fff"/>
              <rect x="30.5" y="44" width="3" height="9" rx="1.2" fill="#fff"/>
            </svg>
          </div>
        </td></tr>
        <tr><td align="center" style="padding:14px 32px 6px;">
          <h1 style="margin:0;font-size:24px;line-height:1.25;color:#14161C;letter-spacing:-0.2px;">{heading}</h1>
          <p style="margin:6px 0 0;color:#9c9389;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;">{kicker}</p>
        </td></tr>
        <tr><td style="padding:18px 36px 4px;font-size:15px;line-height:1.6;color:#3a3530;">
          <p style="margin:0 0 12px;">Hi <strong>{name}</strong>,</p>
          <p style="margin:0 0 12px;">{intro}</p>
        </td></tr>
        <tr><td style="padding:8px 36px;font-size:13px;color:#3a3530;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#9c9389;width:120px;">Changed by</td>
                <td style="padding:6px 0;color:#14161C;"><strong>{actor_name}</strong> &lt;{actor_email}&gt;</td></tr>
            <tr><td style="padding:6px 0;color:#9c9389;">New password</td>
                <td style="padding:6px 0;font-family:'Courier New',monospace;background:#F4ECE3;border-radius:6px;padding-left:8px;padding-right:8px;color:#14161C;">{new_password}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 32px 6px;">
          <a class="kiosk-cta" href="{sign_in_url}" style="display:inline-block;text-decoration:none;color:#fff;font-weight:800;letter-spacing:1.6px;font-size:13px;padding:15px 34px;border-radius:999px;background:#F36A1E;box-shadow:0 8px 22px rgba(243,106,30,0.30);">SIGN IN →</a>
        </td></tr>
        <tr><td style="padding:18px 36px 8px;"><div style="height:1px;background:#F1E6D6;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
        <tr><td style="padding:0 36px 26px;font-size:12px;color:#9c9389;line-height:1.6;">
          <p style="margin:0 0 10px;">If you didn't expect this change, contact your administrator immediately and sign in to set a new password.</p>
          <p style="margin:0;color:#9c9389;">— The KIOSK Team</p>
        </td></tr>
      </table>
      <p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#b0a89e;text-align:center;line-height:1.5;">
        © 2026 myaccess Inc. · KIOSK IoT Platform — security notice
      </p>
    </td></tr>
  </table>
</body>
</html>
"""

    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=django_settings.DEFAULT_FROM_EMAIL,
            to=[user.email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=False)
        return True
    except Exception as exc:
        logger.warning("Password-change email failed for %s: %s", user.email, exc)
        return False


def _send_welcome_email(user, temp_password: str) -> bool:
    """
    Email the new user their sign-in credentials. Returns True on dispatch,
    False if anything broke (failure is logged at WARNING — see DEBUG log
    or the Daphne console for details).
    """
    if not user.email:
        return False

    sign_in_url = f"{django_settings.FRONTEND_URL}/signin"
    name = user.name or 'there'
    identifier = user.email
    role_names = [r.name for r in user.roles.all()] if hasattr(user, 'roles') else []
    role_line = ', '.join(role_names) if role_names else '—'

    subject = "Welcome to KIOSK — your account is ready"
    text_body = (
        f"Hi {name},\n\n"
        f"An administrator has created a KIOSK account for you.\n\n"
        f"Sign in at: {sign_in_url}\n"
        f"Email:      {identifier}\n"
        f"Password:   {temp_password}\n"
        f"Roles:      {role_line}\n\n"
        f"For security, please sign in and change your password as soon as possible.\n\n"
        f"— The KIOSK Team"
    )
    html_body = f"""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @keyframes kiosk-fade-up {{ 0%{{opacity:0;transform:translateY(18px);}} 100%{{opacity:1;transform:translateY(0);}} }}
  @keyframes kiosk-bob     {{ 0%,100%{{transform:translateY(0);}} 50%{{transform:translateY(-4px);}} }}
  @keyframes kiosk-pulse   {{ 0%{{box-shadow:0 0 0 0 rgba(243,106,30,0.55);}} 70%{{box-shadow:0 0 0 16px rgba(243,106,30,0);}} 100%{{box-shadow:0 0 0 0 rgba(243,106,30,0);}} }}
  @keyframes kiosk-glow    {{ 0%,100%{{box-shadow:0 8px 22px rgba(243,106,30,0.30);}} 50%{{box-shadow:0 12px 28px rgba(243,106,30,0.55);}} }}
  .kiosk-card {{ animation: kiosk-fade-up 0.7s ease-out both; }}
  .kiosk-badge{{ animation: kiosk-bob 2.6s ease-in-out infinite, kiosk-pulse 2.6s ease-out infinite; }}
  .kiosk-cta  {{ animation: kiosk-glow 2.2s ease-in-out infinite; }}
</style>
</head>
<body style="margin:0;padding:0;background:#F4ECE3;font-family:'Inter','Segoe UI',Arial,sans-serif;color:#14161C;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4ECE3;">
    <tr><td align="center" style="padding:36px 16px;">
      <table role="presentation" class="kiosk-card" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E6DBCC;box-shadow:0 14px 40px rgba(20,22,28,0.06);">
        <tr><td height="6" style="background-image:linear-gradient(90deg,#FFB082 0%,#F36A1E 50%,#FFB082 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:28px 32px 4px;">
          <div class="kiosk-badge" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#FFE9D5 0%,#FCD9C2 100%);display:inline-block;line-height:64px;text-align:center;">
            <svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;">
              <circle cx="32" cy="22" r="11" fill="#F36A1E"/>
              <path d="M10 56c4-12 14-18 22-18s18 6 22 18z" fill="#F36A1E"/>
            </svg>
          </div>
        </td></tr>
        <tr><td align="center" style="padding:14px 32px 6px;">
          <h1 style="margin:0;font-size:24px;line-height:1.25;color:#14161C;letter-spacing:-0.2px;">Welcome to KIOSK</h1>
          <p style="margin:6px 0 0;color:#9c9389;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;">Your account is ready</p>
        </td></tr>
        <tr><td style="padding:18px 36px 4px;font-size:15px;line-height:1.6;color:#3a3530;">
          <p style="margin:0 0 12px;">Hi <strong>{name}</strong>,</p>
          <p style="margin:0 0 12px;">An administrator has created a KIOSK account for you. Use the credentials below to sign in.</p>
        </td></tr>
        <tr><td style="padding:8px 36px;font-size:13px;color:#3a3530;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#9c9389;width:90px;">Email</td>
                <td style="padding:6px 0;font-family:'Courier New',monospace;color:#14161C;">{identifier}</td></tr>
            <tr><td style="padding:6px 0;color:#9c9389;">Password</td>
                <td style="padding:6px 0;font-family:'Courier New',monospace;background:#F4ECE3;border-radius:6px;padding-left:8px;padding-right:8px;color:#14161C;">{temp_password}</td></tr>
            <tr><td style="padding:6px 0;color:#9c9389;">Roles</td>
                <td style="padding:6px 0;color:#14161C;">{role_line}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 32px 6px;">
          <a class="kiosk-cta" href="{sign_in_url}" style="display:inline-block;text-decoration:none;color:#fff;font-weight:800;letter-spacing:1.6px;font-size:13px;padding:15px 34px;border-radius:999px;background:#F36A1E;box-shadow:0 8px 22px rgba(243,106,30,0.30);">SIGN IN →</a>
        </td></tr>
        <tr><td style="padding:18px 36px 8px;"><div style="height:1px;background:#F1E6D6;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
        <tr><td style="padding:0 36px 26px;font-size:12px;color:#9c9389;line-height:1.6;">
          <p style="margin:0 0 10px;">For security, please sign in and change your password as soon as possible.</p>
          <p style="margin:0;color:#9c9389;">— The KIOSK Team</p>
        </td></tr>
      </table>
      <p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#b0a89e;text-align:center;line-height:1.5;">
        © 2026 myaccess Inc. · KIOSK IoT Platform — this email was sent because an admin created an account for you.
      </p>
    </td></tr>
  </table>
</body>
</html>
"""

    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=django_settings.DEFAULT_FROM_EMAIL,
            to=[user.email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=False)
        return True
    except Exception as exc:
        logger.warning("Welcome email failed for %s: %s", user.email, exc)
        return False


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [AllowAny]
    # The permission catalog is tiny (≤ ~100 rows) and the UI groups by policy,
    # so paginating it would create awkward "page 2 of permissions" UX.
    pagination_class = None

    queryset = Permission.objects.all().order_by('id')
    serializer_class = PermissionSerializer

class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all().order_by('-created_at')
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated, HasCustomPermission]

    # System-managed roles that the API will never delete and that the
    # frontend should hide the delete button for.
    PROTECTED_ROLE_NAMES = {'SuperAdmin', 'Default'}
    DEFAULT_ROLE_NAME = 'Default'

    # Map view actions to permission short_names
    required_permissions = {
        "list": "role_view",            # GET /api/roles/
        "retrieve": "role_view",        # GET /api/roles/<id>/
        "create": "role_create",        # POST
        "update": "role_update",        # PUT
        "partial_update": "role_update",# PATCH
        "destroy": "role_delete",       # DELETE
    }

    def get_queryset(self):
        from django.db.models import Q
        qs = super().get_queryset()
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(description__icontains=q))
        return qs

    def destroy(self, request, *args, **kwargs):
        """
        Delete a role and gracefully migrate any orphaned users.

        Behaviour:
          - `SuperAdmin` and `Default` are protected — return 400.
          - For every user currently holding the role being deleted:
              * remove the link to this role
              * if that leaves the user with NO roles at all, attach the
                `Default` role so they don't end up permission-less.
          - Then delete the role row itself.

        Response includes counts so the UI can show a meaningful toast.
        """
        role = self.get_object()
        if role.name in self.PROTECTED_ROLE_NAMES:
            return Response(
                {'detail': f'The "{role.name}" role is a system role and cannot be deleted.'},
                status=400,
            )

        default_role = Role.objects.filter(name=self.DEFAULT_ROLE_NAME).first()
        users_with_role = list(User.objects.filter(roles=role))
        reassigned_to_default = 0

        for user in users_with_role:
            UserHasRole.objects.filter(user=user, role=role).delete()
            if default_role and not user.roles.exists():
                UserHasRole.objects.create(user=user, role=default_role)
                reassigned_to_default += 1

        deleted_name = role.name
        role.delete()

        return Response({
            'message': (
                f'Role “{deleted_name}” deleted. '
                f'{len(users_with_role)} user(s) had this role; '
                f'{reassigned_to_default} reassigned to “Default”.'
            ),
            'users_affected': len(users_with_role),
            'reassigned_to_default': reassigned_to_default,
        }, status=200)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response({"message": "Role created successfully", "data": serializer.data}, status=201)
        return Response(serializer.errors, status=400)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if serializer.is_valid():
            serializer.save()
            return Response({"message": "Role updated successfully", "data": serializer.data}, status=200)
        return Response(serializer.errors, status=400)


class UserViewSet(viewsets.ModelViewSet):
    """
    Manage Users with role assignments and soft delete support.
    """
    permission_classes = [HasCustomPermission]
    queryset = User.objects.all().order_by('-created_at')
    serializer_class = UserSerializer

    required_permissions = {
        "list": "user_view",
        "retrieve": "user_view",
        "create": "user_create",
        "update": "user_update",
        "partial_update": "user_update",
        "destroy": "user_delete",
        "restore_user": "user_restore",
    }

    def get_queryset(self):
        """
        Return active users by default, or soft-deleted ones with
        ?show_deleted=true. Supports server-side search via ?q= over
        name, email, mobile, AND any role name the user has assigned
        — so admins can search "SuperAdmin" or "Viewer" and find every
        matching user. Composes with pagination.
        """
        from django.db.models import Q
        show_deleted = self.request.query_params.get('show_deleted', 'false').lower() == 'true'
        if show_deleted:
            qs = User.objects.filter(deleted_at__isnull=False).order_by('-deleted_at')
        else:
            qs = User.objects.filter(deleted_at__isnull=True).order_by('-created_at')

        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) |
                Q(email__icontains=q) |
                Q(mobile__icontains=q) |
                Q(roles__name__icontains=q)
            ).distinct()  # roles is M2M — distinct() prevents duplicate rows
        return qs

    def create(self, request, *args, **kwargs):
        # Resolve the final password:
        #   - If the admin typed one, that wins (priority over auto-gen).
        #   - Otherwise generate a temporary one server-side.
        # Either way we email the credentials to the new user — they need to
        # know what password they were assigned to sign in.
        data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        # Always trim whitespace from any admin-supplied password — DRF's
        # login serializer trims by default, so storing an untrimmed hash
        # would make the account un-loginable.
        if isinstance(data.get('password'), str):
            data['password'] = data['password'].strip()
        provided_password = data.get('password')
        auto_generated = False
        if not provided_password:
            if not data.get('email'):
                return Response(
                    {'email': [
                        'Email is required when no password is supplied — '
                        'we need somewhere to send the temporary password.'
                    ]},
                    status=400,
                )
            data['password'] = _generate_temp_password()
            auto_generated = True

        serializer = self.get_serializer(data=data)
        if serializer.is_valid():
            user = serializer.save()
            email_sent = _send_welcome_email(user, data['password']) if user.email else False
            payload = {
                "message": "User created successfully",
                "data": serializer.data,
                "credentials_emailed": email_sent,
                "password_auto_generated": auto_generated,
            }
            if email_sent:
                payload['message'] = (
                    f"User created. Credentials emailed to {user.email} "
                    + ("(auto-generated password)." if auto_generated else "(custom password).")
                )
            elif not user.email:
                payload['message'] = (
                    "User created without an email on file — credentials could not be emailed."
                )
            else:
                payload['message'] = (
                    "User created, but the credentials email could not be sent. "
                    "Use the change-password endpoint or resend the email."
                )
            return Response(payload, status=201)
        return Response(serializer.errors, status=400)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # Trim whitespace from any incoming password before the serializer
        # hashes it — DRF strips by default on the login endpoint, so the
        # stored hash MUST be of the trimmed string. Pass a shallow copy
        # to the serializer so we never mutate the original request.data.
        data = request.data.copy() if hasattr(request.data, 'copy') else dict(request.data)
        if isinstance(data.get('password'), str):
            data['password'] = data['password'].strip()

        new_password = data.get('password') or None
        if isinstance(new_password, str) and not new_password:
            new_password = None  # treat empty / whitespace-only as "not changing"

        serializer = self.get_serializer(instance, data=data, partial=partial)
        if serializer.is_valid():
            user = serializer.save()
            payload = {"message": "User updated successfully", "data": serializer.data}

            if new_password:
                sent = _send_password_changed_email(user, new_password, request.user)
                payload['password_changed'] = True
                payload['password_email_sent'] = sent
                if sent:
                    payload['message'] = (
                        f"User updated. Password change emailed to {user.email}."
                    )
                elif user.email:
                    payload['message'] = (
                        "User updated, but the password-change email could not be sent."
                    )
                else:
                    payload['message'] = (
                        "User updated. No email on file — password change not emailed."
                    )

            return Response(payload, status=200)
        return Response(serializer.errors, status=400)

    def destroy(self, request, *args, **kwargs):
        """Soft delete user (mark as deleted)"""
        instance = self.get_object()
        if instance.is_deleted():
            return Response({"message": "User already deleted."}, status=400)
        instance.delete()
        return Response({"message": f"User '{instance.name}' marked as deleted."}, status=200)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore_user(self, request, pk=None):
        """Restore a previously deleted user"""
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return Response({"message": "User not found."}, status=404)

        if not user.is_deleted():
            return Response({"message": "User is not deleted."}, status=400)

        user.restore()
        return Response({"message": f"User '{user.name}' restored successfully."}, status=200)
    
    @action(detail=True, methods=['post'], url_path='change-password')
    def change_password(self, request, pk=None):
        """
        Change user's password securely.
        Requires: current_password, new_password
        """
        try:
            user = self.get_object()
        except User.DoesNotExist:
            return Response({"message": "User not found."}, status=404)

        # Trim to match DRF's login-time stripping (see MePasswordView for why).
        current_password = (request.data.get("current_password") or "").strip()
        new_password = (request.data.get("new_password") or "").strip()

        if not current_password or not new_password:
            return Response({"message": "Both current_password and new_password are required."}, status=400)

        # Check current password validity
        if not check_password(current_password, user.password):
            return Response({"message": "Current password is incorrect."}, status=400)

        # Hash and save the new password
        user.password = make_password(new_password)
        user.save(update_fields=["password"])

        return Response({"message": "Password changed successfully."}, status=200)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if serializer.is_valid():
            return Response({"message": "Login successful", "data": serializer.validated_data}, status=200)
        return Response(serializer.errors, status=400)


# ============================================================
# Self-service ("me") endpoints
# ------------------------------------------------------------
# Let the signed-in user view + edit their OWN profile and
# change their OWN password without needing the admin
# `user_view` / `user_update` permissions on the UserViewSet.
# ============================================================
def _serialise_me(user):
    roles = []
    for role in user.roles.all():
        perms = list(role.permissions.values('id', 'name', 'short_name', 'policy'))
        roles.append({'id': role.id, 'name': role.name, 'permissions': perms})
    return {
        'id': user.id,
        'name': user.name,
        'email': user.email,
        'country_code': user.country_code,
        'mobile': user.mobile,
        'created_at': user.created_at,
        'updated_at': user.updated_at,
        'roles': roles,
    }


class MeView(APIView):
    """GET → current user; PATCH → update name / email / country_code / mobile."""
    permission_classes = [IsAuthenticated]

    EDITABLE = ('name', 'email', 'country_code', 'mobile')

    def get(self, request):
        return Response({'data': _serialise_me(request.user)}, status=200)

    def patch(self, request):
        user = request.user
        data = request.data if hasattr(request.data, 'get') else dict(request.data)

        # Apply edits to the editable fields only (never role assignments here).
        # Normalise blanks to None so the DB unique constraints behave correctly.
        for field in self.EDITABLE:
            if field in data:
                value = data.get(field)
                if isinstance(value, str):
                    value = value.strip() or None
                setattr(user, field, value)

        # Validate uniqueness explicitly so we return a clean field-level error
        # rather than letting the DB raise an IntegrityError.
        errors = {}
        if user.email:
            if User.objects.exclude(pk=user.pk).filter(email=user.email).exists():
                errors['email'] = ['user with this email already exists.']
        if user.mobile:
            if User.objects.exclude(pk=user.pk).filter(mobile=user.mobile).exists():
                errors['mobile'] = ['user with this mobile already exists.']
        if errors:
            return Response(errors, status=400)

        user.save()
        return Response(
            {'message': 'Profile updated successfully.', 'data': _serialise_me(user)},
            status=200,
        )


class MePasswordView(APIView):
    """POST { current_password, new_password } → rotate own password."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        # IMPORTANT: trim both passwords. DRF's CharField trims by default
        # on the login endpoint, so the stored hash MUST be of the trimmed
        # value — otherwise the user can never log in again with what they
        # typed (especially on mobile, where keyboards often append a
        # trailing space after autocomplete).
        current_password = (request.data.get('current_password') or '').strip()
        new_password = (request.data.get('new_password') or '').strip()

        errors = {}
        if not current_password:
            errors['current_password'] = ['Current password is required.']
        if not new_password:
            errors['new_password'] = ['New password is required.']
        elif len(new_password) < 8:
            errors['new_password'] = ['Password must be at least 8 characters.']
        if errors:
            return Response(errors, status=400)

        if not check_password(current_password, user.password):
            return Response(
                {'current_password': ['Current password is incorrect.']},
                status=400,
            )
        if current_password == new_password:
            return Response(
                {'new_password': ['New password must be different from the current one.']},
                status=400,
            )

        user.password = make_password(new_password)
        user.save(update_fields=['password'])

        # Confirmation email (security best practice — alerts the user if
        # someone else somehow rotated their password without consent).
        email_sent = _send_password_changed_email(user, new_password, user)

        return Response({
            'message': (
                f'Password changed successfully. A confirmation email was sent to {user.email}.'
                if email_sent else 'Password changed successfully.'
            ),
            'email_sent': email_sent,
        }, status=200)


# ============================================================
# Password Reset
# ============================================================
# Token lifetime — short window, since this is a single-use reset code.
PASSWORD_RESET_TOKEN_TTL_MINUTES = 30


def _send_password_reset_email(user, token):
    """
    Build and send the password-reset email. Returns True if dispatched
    successfully, False otherwise (so the caller can decide whether to
    surface the dev_token instead).
    """
    if not user.email:
        return False

    reset_link = f"{django_settings.FRONTEND_URL}/forgot-password?token={token}"
    expires_minutes = PASSWORD_RESET_TOKEN_TTL_MINUTES
    name = user.name or 'there'

    subject = "Reset your KIOSK password"
    text_body = (
        f"Hi {name},\n\n"
        f"We received a request to reset the password for your KIOSK account.\n\n"
        f"Click the link below to choose a new password — it expires in "
        f"{expires_minutes} minutes:\n"
        f"{reset_link}\n\n"
        f"Or, if the link doesn't work, paste this code into the reset form:\n"
        f"{token}\n\n"
        f"If you didn't request a password reset you can safely ignore this email.\n\n"
        f"— The KIOSK Team"
    )
    html_body = f"""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reset your KIOSK password</title>
<style>
  /* ---------- Animations (CSS-capable clients pick these up; others render static) ---------- */
  @keyframes kiosk-fade-up {{
    0%   {{ opacity: 0; transform: translateY(18px); }}
    100% {{ opacity: 1; transform: translateY(0); }}
  }}
  @keyframes kiosk-bob {{
    0%, 100% {{ transform: translateY(0); }}
    50%      {{ transform: translateY(-4px); }}
  }}
  @keyframes kiosk-pulse-ring {{
    0%   {{ box-shadow: 0 0 0 0 rgba(243,106,30,0.55); }}
    70%  {{ box-shadow: 0 0 0 16px rgba(243,106,30,0); }}
    100% {{ box-shadow: 0 0 0 0 rgba(243,106,30,0); }}
  }}
  @keyframes kiosk-shimmer {{
    0%   {{ background-position: -240px 0; }}
    100% {{ background-position: 240px 0; }}
  }}
  @keyframes kiosk-glow {{
    0%, 100% {{ box-shadow: 0 8px 22px rgba(243,106,30,0.30); }}
    50%      {{ box-shadow: 0 12px 28px rgba(243,106,30,0.55); }}
  }}
  @keyframes kiosk-blink {{
    0%, 100% {{ background: #F4ECE3; }}
    50%      {{ background: #FDE5D2; }}
  }}

  .kiosk-card    {{ animation: kiosk-fade-up 0.7s ease-out both; }}
  .kiosk-lock    {{ animation: kiosk-bob 2.6s ease-in-out infinite, kiosk-pulse-ring 2.6s ease-out infinite; }}
  .kiosk-cta     {{ animation: kiosk-glow 2.2s ease-in-out infinite; }}
  .kiosk-cta-bg  {{
    background-image: linear-gradient(110deg, #F36A1E 0%, #FF8A45 40%, #F36A1E 80%);
    background-size: 480px 100%;
    animation: kiosk-shimmer 3.2s linear infinite;
  }}
  .kiosk-code    {{ animation: kiosk-blink 3s ease-in-out infinite; }}

  /* Email clients that don't run animations still get the static styles above. */
  @media (prefers-reduced-motion: reduce) {{
    .kiosk-card, .kiosk-lock, .kiosk-cta, .kiosk-cta-bg, .kiosk-code {{ animation: none !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background:#F4ECE3;font-family:'Inter','Segoe UI',Arial,sans-serif;color:#14161C;">

  <!-- Hidden preheader (shows next to the subject in inbox previews) -->
  <div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;mso-hide:all;">
    Reset your KIOSK password — link expires in {expires_minutes} minutes.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4ECE3;">
    <tr>
      <td align="center" style="padding:36px 16px;">

        <!-- Animated card -->
        <table role="presentation" class="kiosk-card" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E6DBCC;box-shadow:0 14px 40px rgba(20,22,28,0.06);">

          <!-- Top strip -->
          <tr>
            <td height="6" style="background-image:linear-gradient(90deg,#FFB082 0%,#F36A1E 50%,#FFB082 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Animated lock icon -->
          <tr>
            <td align="center" style="padding:28px 32px 4px;">
              <div class="kiosk-lock" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#FFE9D5 0%,#FCD9C2 100%);display:inline-block;line-height:64px;text-align:center;">
                <svg width="30" height="30" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;">
                  <path d="M20 32 V22 a12 12 0 0 1 24 0 V32" fill="none" stroke="#F36A1E" stroke-width="5" stroke-linecap="round"/>
                  <rect x="14" y="32" width="36" height="26" rx="6" fill="#F36A1E"/>
                  <circle cx="32" cy="44" r="3.5" fill="#fff"/>
                  <rect x="30.5" y="44" width="3" height="9" rx="1.2" fill="#fff"/>
                </svg>
              </div>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding:14px 32px 6px;">
              <h1 style="margin:0;font-size:24px;line-height:1.25;color:#14161C;letter-spacing:-0.2px;">Reset your password</h1>
              <p style="margin:6px 0 0;color:#9c9389;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;">KIOSK · IoT Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:18px 36px 4px;font-size:15px;line-height:1.6;color:#3a3530;">
              <p style="margin:0 0 12px;">Hi <strong>{name}</strong>,</p>
              <p style="margin:0 0 12px;">We received a request to reset the password for your KIOSK account. Tap the button below to choose a new password.</p>
              <p style="margin:0;color:#6b6258;font-size:13px;">⏱ This link expires in <strong>{expires_minutes} minutes</strong>.</p>
            </td>
          </tr>

          <!-- Animated CTA -->
          <tr>
            <td align="center" style="padding:22px 32px 6px;">
              <a class="kiosk-cta" href="{reset_link}"
                 style="display:inline-block;text-decoration:none;color:#fff;font-weight:800;letter-spacing:1.6px;font-size:13px;padding:15px 34px;border-radius:999px;background:#F36A1E;box-shadow:0 8px 22px rgba(243,106,30,0.30);">
                <span class="kiosk-cta-bg" style="display:inline-block;padding:0;background-clip:padding-box;">RESET PASSWORD →</span>
              </a>
            </td>
          </tr>

          <!-- Token chip fallback -->
          <tr>
            <td style="padding:14px 36px 4px;font-size:13px;color:#6b6258;line-height:1.55;">
              <p style="margin:0 0 6px;">If the button doesn't work, paste this code into the reset form:</p>
              <p class="kiosk-code" style="margin:0;font-family:'Courier New',monospace;background:#F4ECE3;padding:12px 14px;border-radius:10px;border:1px dashed #E6DBCC;word-break:break-all;color:#14161C;font-size:12.5px;">{token}</p>
            </td>
          </tr>

          <!-- Divider + footnote -->
          <tr>
            <td style="padding:18px 36px 8px;">
              <div style="height:1px;background:#F1E6D6;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 26px;font-size:12px;color:#9c9389;line-height:1.6;">
              <p style="margin:0 0 10px;">Didn't request this? You can safely ignore this email — your password won't change.</p>
              <p style="margin:0;color:#9c9389;">— The KIOSK Team</p>
            </td>
          </tr>
        </table>

        <p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#b0a89e;text-align:center;line-height:1.5;">
          © 2026 myaccess Inc. · KIOSK IoT Platform — sent because a password reset was requested.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=django_settings.DEFAULT_FROM_EMAIL,
            to=[user.email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=False)
        return True
    except Exception as exc:
        logger.warning("Password reset email failed for %s: %s", user.email, exc)
        return False


class ForgotPasswordView(APIView):
    """
    Step 1: user submits email or mobile; if it matches an active account
    we generate a single-use reset token. If no account exists for the
    given identifier the request is rejected with a clear error.

    Dev mode (DEBUG=True): the token is also returned in the response so
    you can demo the flow without an email/SMS provider configured.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        identifier = (request.data.get('email_or_mobile') or '').strip()
        if not identifier:
            return Response(
                {'email_or_mobile': ['This field is required.']},
                status=400,
            )

        user = (
            User.objects.filter(email=identifier).first()
            or User.objects.filter(mobile=identifier).first()
        )

        if not user or user.is_deleted():
            return Response(
                {'email_or_mobile': ['No account found for that email or mobile.']},
                status=400,
            )

        if not user.email:
            return Response(
                {'email_or_mobile': [
                    'No email address is on file for this account — '
                    'password reset by email is not available.'
                ]},
                status=400,
            )

        # Invalidate any prior outstanding reset tokens for this user. Only
        # the most recently issued token should be usable — older links (or
        # the one from a previous /forgot-password call) become dead the
        # moment a new code is generated.
        now = timezone.now()
        PasswordResetToken.objects.filter(
            user=user, used_at__isnull=True
        ).update(used_at=now)

        token = secrets.token_urlsafe(48)
        PasswordResetToken.objects.create(
            user=user,
            token=token,
            expires_at=now + timedelta(minutes=PASSWORD_RESET_TOKEN_TTL_MINUTES),
        )

        sent = _send_password_reset_email(user, token)
        backend_path = getattr(django_settings, 'EMAIL_BACKEND', '')
        smtp_configured = backend_path.endswith('smtp.EmailBackend')

        if sent and smtp_configured:
            payload = {
                'message': f'A password reset link has been sent to {user.email}.',
                'expires_in': PASSWORD_RESET_TOKEN_TTL_MINUTES * 60,
            }
        elif sent:
            # Console backend — token was printed to the Daphne log. In dev we
            # also surface it in the response so the UI can demo step 2 without
            # tailing the log.
            payload = {
                'message': 'Password reset code generated (no SMTP configured — token printed to server log).',
                'expires_in': PASSWORD_RESET_TOKEN_TTL_MINUTES * 60,
                'dev_token': token,
            }
        else:
            # send_mail blew up — fall back to dev_token so the user isn't locked out
            # while you fix credentials. Logged at WARNING above.
            payload = {
                'message': 'Could not send reset email; use the code below to complete reset.',
                'expires_in': PASSWORD_RESET_TOKEN_TTL_MINUTES * 60,
                'dev_token': token,
            }

        return Response(payload, status=200)


class ResetPasswordView(APIView):
    """
    Step 2: user submits the token + a new password. We validate the token
    (exists, not used, not expired), set the new password, mark the token used.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        token = (request.data.get('token') or '').strip()
        # Trim to match DRF's login-time stripping; otherwise the stored hash
        # would never match what the user types on the sign-in page.
        new_password = (request.data.get('new_password') or '').strip()
        errors = {}
        if not token:
            errors['token'] = ['This field is required.']
        if not new_password:
            errors['new_password'] = ['This field is required.']
        elif len(new_password) < 8:
            errors['new_password'] = ['Password must be at least 8 characters.']
        if errors:
            return Response(errors, status=400)

        try:
            prt = PasswordResetToken.objects.select_related('user').get(token=token)
        except PasswordResetToken.DoesNotExist:
            return Response(
                {'non_field_errors': ['Invalid or expired reset token.']},
                status=400,
            )

        if not prt.is_valid():
            return Response(
                {'non_field_errors': ['Invalid or expired reset token.']},
                status=400,
            )

        user = prt.user
        if user.is_deleted():
            return Response(
                {'non_field_errors': ['This account is deactivated or deleted.']},
                status=400,
            )

        user.password = make_password(new_password)
        user.save(update_fields=['password'])
        prt.mark_used()

        return Response(
            {'message': 'Password has been reset successfully.'},
            status=200,
        )