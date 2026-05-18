from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import *
from rest_framework_simplejwt.views import (
    TokenVerifyView,
    TokenRefreshView,
)

router = DefaultRouter()
router.register(r'roles', RoleViewSet,basename='role')
router.register(r'permissions', PermissionViewSet, basename='permission')
router.register(r'users', UserViewSet, basename='user')


urlpatterns = [
    path('', include(router.urls)),
    path('login/', LoginView.as_view(), name='login'),
    path('forgot-password/', ForgotPasswordView.as_view(), name='forgot_password'),
    path('reset-password/', ResetPasswordView.as_view(), name='reset_password'),
    path('me/', MeView.as_view(), name='me'),
    path('me/password/', MePasswordView.as_view(), name='me_password'),
    path('token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
]