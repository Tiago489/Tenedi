from django.contrib import admin
from django.urls import path, include

admin.site.site_header = 'Tenet EDI Ops'
admin.site.site_title = 'Tenet EDI'
admin.site.index_title = 'Operations Platform'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/maps/', include('apps.maps.urls')),
]
