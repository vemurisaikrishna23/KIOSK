from django.contrib import admin
from .models import *


admin.site.register(Permission)
admin.site.register(Role)
admin.site.register(RoleHasPermission)
admin.site.register(User)
admin.site.register(UserHasRole)


