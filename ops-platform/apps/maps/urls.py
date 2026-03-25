from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    TransformMapViewSet, ReferenceTableViewSet, MappingExampleView,
    MapSyncView, PublishedMapsView, ConvertStediView, ValidateExampleView, GenerateWithAIView,
)

router = DefaultRouter()
router.register('transform-maps', TransformMapViewSet)
router.register('reference-tables', ReferenceTableViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('mapping-examples/', MappingExampleView.as_view()),
    path('sync/', MapSyncView.as_view()),
    path('published/', PublishedMapsView.as_view()),
    path('convert-stedi/', ConvertStediView.as_view()),
    path('validate-example/', ValidateExampleView.as_view()),
    path('generate-with-ai/', GenerateWithAIView.as_view()),
]
