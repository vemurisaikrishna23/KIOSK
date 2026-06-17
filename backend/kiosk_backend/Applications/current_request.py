"""
Thread-local access to the current HTTP request, so the activity-log signals
can attribute a change to the user who made it (the "actor").

The middleware just stashes the request for the duration of the call; the
actual user is resolved lazily (only when something is actually logged) from
the request's session user or its JWT Authorization header. This keeps
read-only requests cost-free.
"""
import threading

_state = threading.local()


def get_current_request():
    return getattr(_state, 'request', None)


def actor_display_name(u):
    """Human-readable name for a User instance (empty for None)."""
    if u is None:
        return ''
    return (getattr(u, 'name', None) or getattr(u, 'email', '') or str(u))[:150]


def get_current_actor():
    """
    Best-effort User instance behind the current request (or None for
    anonymous / system / automated contexts — i.e. no user is involved).
    """
    req = get_current_request()
    if req is None:
        return None
    # 1) Session-authenticated Django user.
    try:
        u = getattr(req, 'user', None)
        if u is not None and getattr(u, 'is_authenticated', False):
            return u
    except Exception:
        pass
    # 2) JWT bearer token (the SPA's auth scheme — DRF doesn't set it on the
    #    Django request, so decode it ourselves).
    try:
        header = req.META.get('HTTP_AUTHORIZATION', '') if hasattr(req, 'META') else ''
        if header.startswith('Bearer '):
            from rest_framework_simplejwt.tokens import AccessToken
            from django.contrib.auth import get_user_model
            uid = AccessToken(header.split(' ', 1)[1]).get('user_id')
            if uid is not None:
                return get_user_model().objects.filter(pk=uid).only('id', 'name', 'email').first()
    except Exception:
        pass
    return None


def get_current_actor_name():
    """Best-effort display name of the user behind the current request."""
    return actor_display_name(get_current_actor())


class CurrentRequestMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _state.request = request
        try:
            return self.get_response(request)
        finally:
            _state.request = None
