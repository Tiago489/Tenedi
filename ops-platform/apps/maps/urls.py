from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TransformMapViewSet, ReferenceTableViewSet, MappingExampleView

router = DefaultRouter()
router.register('transform-maps', TransformMapViewSet)
router.register('reference-tables', ReferenceTableViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('mapping-examples/', MappingExampleView.as_view()),
]
