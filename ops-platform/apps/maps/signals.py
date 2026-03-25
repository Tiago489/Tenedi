import logging
import requests
from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import TransformMap

logger = logging.getLogger('maps.signals')


@receiver(post_save, sender=TransformMap)
def notify_engine_on_publish(sender, instance, **kwargs):
    """When a TransformMap is saved with is_live=True, notify the engine to reload it."""
    if not instance.is_live:
        return
    if not instance.dsl_source and not instance.custom_transform_id:
        return

    engine_url = getattr(settings, 'ENGINE_API_URL', 'http://engine:3000').rstrip('/')
    partner_key = instance.partner.partner_id.lower() if instance.partner else None

    try:
        resp = requests.post(
            f'{engine_url}/maps/reload',
            json={
                'partner_key': partner_key,
                'transaction_set': instance.transaction_set,
                'direction': instance.direction,
                'dsl_source': instance.dsl_source or '',
                'custom_transform_id': instance.custom_transform_id or '',
                'version': instance.version,
            },
            timeout=5,
        )
        if resp.ok:
            logger.info('Notified engine of map reload: %s-%s:%s', partner_key, instance.transaction_set, instance.direction)
        else:
            logger.warning('Engine map reload returned %s: %s', resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning('Failed to notify engine of map reload: %s', e)
