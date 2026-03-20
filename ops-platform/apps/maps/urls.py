from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TransformMapViewSet, ReferenceTableViewSet

router = DefaultRouter()
router.register('transform-maps', TransformMapViewSet)
router.register('reference-tables', ReferenceTableViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
