from django.apps import AppConfig


class ApplicationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'Applications'

    def ready(self):
        # Wire up internal activity logging (post_save / post_delete handlers).
        try:
            from . import signals
            signals.register()
        except Exception:
            pass
