from django.urls import path
from .views import JobRecordCreateView

urlpatterns = [
    path('', JobRecordCreateView.as_view()),
]
