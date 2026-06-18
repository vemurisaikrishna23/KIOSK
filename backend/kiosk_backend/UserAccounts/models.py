from django.db import models
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, BaseUserManager


# -------------------------
# Custom User Manager
# -------------------------
class UserManager(BaseUserManager):
    def create_user(self, email, mobile, password=None, **extra_fields):
        if not email and not mobile:
            raise ValueError("Email or Mobile is required")
        email = self.normalize_email(email)
        user = self.model(email=email, mobile=mobile, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, mobile, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(email, mobile, password, **extra_fields)
# -----------------------------------
# Permission Model
# -----------------------------------
class Permission(models.Model):
    name = models.CharField(max_length=100, unique=True)
    short_name = models.CharField(max_length=50, unique=True)
    policy = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


# -----------------------------------
# Role Model
# -----------------------------------
class Role(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    permissions = models.ManyToManyField(Permission, through='RoleHasPermission', related_name='roles')

    def __str__(self):
        return self.name


# -----------------------------------
# Role-Permission Mapping
# -----------------------------------
class RoleHasPermission(models.Model):
    role = models.ForeignKey(Role, on_delete=models.CASCADE)
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE)

    class Meta:
        unique_together = ('role', 'permission')

    def __str__(self):
        return f"{self.role.name} → {self.permission.short_name}"





# -------------------------
# User Model
# -------------------------
class User(AbstractBaseUser, PermissionsMixin):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True, null=True, blank=True)
    country_code = models.CharField(max_length=10, blank=True, null=True)
    mobile = models.CharField(max_length=20, unique=True, null=True, blank=True)
    # Chosen avatar variant ("<palette>-<pattern>", e.g. "3-2"). Blank = the
    # default auto-generated icon. Picked by the user on their Profile page.
    avatar = models.CharField(max_length=20, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    created_by = models.IntegerField(blank=True, null=True)
    updated_by = models.IntegerField(blank=True, null=True)

    # Auth-specific fields
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    # Relations
    roles = models.ManyToManyField('Role', through='UserHasRole', related_name='users')

    # UserManager
    objects = UserManager()

    USERNAME_FIELD = 'email'   # or 'mobile' if you prefer
    REQUIRED_FIELDS = ['mobile']

    def __str__(self):
        return f"{self.name} ({'DELETED' if self.is_deleted() else 'ACTIVE'})"

    def delete(self, using=None, keep_parents=False):
        """Soft delete"""
        self.deleted_at = timezone.now()
        self.save(update_fields=['deleted_at'])

    def restore(self):
        """Restore deleted user"""
        self.deleted_at = None
        self.save(update_fields=['deleted_at'])

    def is_deleted(self):
        return self.deleted_at is not None


# -----------------------------------
# User-Role Mapping
# -----------------------------------
class UserHasRole(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.ForeignKey(Role, on_delete=models.CASCADE)

    class Meta:
        unique_together = ('user', 'role')

    def __str__(self):
        return f"{self.user.name} → {self.role.name}"


# -----------------------------------
# Password Reset Tokens
# -----------------------------------
class PasswordResetToken(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='password_reset_tokens'
    )
    token = models.CharField(max_length=128, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']

    def is_valid(self):
        return self.used_at is None and timezone.now() < self.expires_at

    def mark_used(self):
        self.used_at = timezone.now()
        self.save(update_fields=['used_at'])
