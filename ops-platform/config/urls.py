from django.contrib import admin
from django.urls import path, include

from apps.dashboard.views import DashboardMetricsView

admin.site.site_header = 'Tenet EDI Ops'
admin.site.site_title = 'Tenet EDI'
admin.site.index_title = 'Operations Platform'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/dashboard/metrics/', DashboardMetricsView.as_view()),
    path('api/maps/', include('apps.maps.urls')),
    path('api/jobs/', include('apps.jobs.urls')),
    path('api/partners/', include('apps.partners.urls')),
]
