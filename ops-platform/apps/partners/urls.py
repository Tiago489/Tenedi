from django.urls import path
from .views import PartnerDetailView, PartnerListView

urlpatterns = [
    path('', PartnerListView.as_view()),
    path('<str:partner_id>/', PartnerDetailView.as_view()),
]
