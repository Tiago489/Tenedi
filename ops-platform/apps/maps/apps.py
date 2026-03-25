from django.apps import AppConfig


class MapsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.maps'

    def ready(self):
        import apps.maps.signals  # noqa: F401 — register post_save signal
