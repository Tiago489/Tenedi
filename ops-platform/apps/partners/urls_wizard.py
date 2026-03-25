from django.urls import path
from .views_wizard import WizardStartView, WizardStepView

urlpatterns = [
    path('', WizardStartView.as_view(), name='wizard_start'),
    path('step/<int:step>/', WizardStepView.as_view(), name='wizard_step'),
]
