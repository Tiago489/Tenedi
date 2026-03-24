from django.urls import path
from .views import PartnerDetailView, PartnerListView, SFTPLogCreateView

urlpatterns = [
    path('sftp-logs/', SFTPLogCreateView.as_view()),
    path('', PartnerListView.as_view()),
    path('<str:partner_id>/', PartnerDetailView.as_view()),
]
