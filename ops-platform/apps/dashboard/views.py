import time
import requests
from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.db.models import Count, Q
from django.db.models.functions import TruncHour
from django.http import JsonResponse
from django.utils import timezone
from django.views import View

from apps.jobs.models import JobRecord
from apps.partners.models import TradingPartner, SFTPLog


ENGINE_URL = getattr(settings, 'ENGINE_API_URL', 'http://engine:3000')


class DashboardMetricsView(View):
    """GET /api/dashboard/metrics/ — live ops metrics for the dashboard."""

    def get(self, request):
        return JsonResponse({
            'system': self._system_health(),
            'pipeline_24h': self._pipeline_24h(),
            'partners': self._partner_status(),
            'recent_failures': self._recent_failures(),
        })

    # ── System health ─────────────────────────────────────────────────────

    def _system_health(self):
        return {
            'engine': self._check_engine(),
            'redis': self._check_redis(),
            'database': self._check_database(),
            'sftp_connectors': self._check_sftp(),
        }

    def _check_engine(self):
        try:
            start = time.monotonic()
            resp = requests.get(f'{ENGINE_URL}/health', timeout=3)
            latency = round((time.monotonic() - start) * 1000)
            return {'status': 'healthy' if resp.ok else 'degraded', 'latency_ms': latency}
        except Exception:
            return {'status': 'unreachable', 'latency_ms': None}

    def _check_redis(self):
        try:
            from django_redis import get_redis_connection
            conn = get_redis_connection('default')
            conn.ping()
            # BullMQ stores jobs under bull:edi-inbound:wait
            try:
                depth = conn.llen('bull:edi-inbound:wait') or 0
            except Exception:
                depth = 0
            return {'status': 'healthy', 'queue_depth': depth}
        except Exception:
            return {'status': 'degraded', 'queue_depth': 0}

    def _check_database(self):
        try:
            with connection.cursor() as cur:
                cur.execute('SELECT 1')
            return {'status': 'healthy'}
        except Exception:
            return {'status': 'degraded'}

    def _check_sftp(self):
        partners = TradingPartner.objects.filter(transport='sftp', is_active=True)
        total = partners.count()
        if total == 0:
            return {'total': 0, 'active': 0, 'failed': 0}

        active = 0
        for p in partners:
            interval_ms = p.sftp_poll_interval_ms or 30000
            threshold = timezone.now() - timedelta(milliseconds=interval_ms * 2)
            has_recent = SFTPLog.objects.filter(
                partner=p, action='CONNECT', status='SUCCESS', timestamp__gte=threshold,
            ).exists()
            if has_recent:
                active += 1

        return {'total': total, 'active': active, 'failed': total - active}

    # ── Pipeline metrics ──────────────────────────────────────────────────

    def _pipeline_24h(self):
        since = timezone.now() - timedelta(hours=24)
        qs = JobRecord.objects.filter(received_at__gte=since)

        total = qs.count()
        successful = qs.filter(status='completed').count()
        failed = qs.filter(status='failed').count()

        # Group by hour
        hourly = (
            qs.annotate(hour=TruncHour('received_at'))
            .values('hour')
            .annotate(
                count=Count('id'),
                failed_count=Count('id', filter=Q(status='failed')),
            )
            .order_by('hour')
        )
        by_hour = [
            {'hour': h['hour'].isoformat(), 'count': h['count'], 'failed': h['failed_count']}
            for h in hourly
        ]

        # Group by transaction set
        by_tx = dict(
            qs.values_list('transaction_set')
            .annotate(c=Count('id'))
            .values_list('transaction_set', 'c')
        )

        return {
            'total': total,
            'successful': successful,
            'failed': failed,
            'by_hour': by_hour,
            'by_transaction_set': by_tx,
        }

    # ── Partner status ────────────────────────────────────────────────────

    def _partner_status(self):
        now = timezone.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())

        result = []
        for p in TradingPartner.objects.filter(is_active=True).order_by('name'):
            jobs = JobRecord.objects.filter(
                Q(trading_partner=p) | Q(job_id__icontains=p.partner_id)
            )
            latest = jobs.order_by('-received_at').first()
            files_today = jobs.filter(received_at__gte=today_start).count()
            files_week = jobs.filter(received_at__gte=week_start).count()

            # SFTP status
            sftp_status = 'n/a'
            if p.transport == 'sftp':
                last_connect = SFTPLog.objects.filter(
                    partner=p, action='CONNECT', status='SUCCESS',
                ).first()
                if last_connect:
                    threshold = now - timedelta(milliseconds=(p.sftp_poll_interval_ms or 30000) * 2)
                    sftp_status = 'connected' if last_connect.timestamp >= threshold else 'stale'
                else:
                    sftp_status = 'never'

            result.append({
                'name': p.name,
                'partner_id': p.partner_id,
                'last_file_received': latest.received_at.isoformat() if latest else None,
                'files_today': files_today,
                'files_this_week': files_week,
                'last_delivery_status': latest.downstream_status_code if latest else None,
                'sftp_status': sftp_status,
            })

        return result

    # ── Recent failures ───────────────────────────────────────────────────

    def _recent_failures(self):
        failures = JobRecord.objects.filter(status='failed').order_by('-received_at')[:5]
        return [
            {
                'id': f.pk,
                'partner': f.trading_partner.partner_id if f.trading_partner else f.source,
                'transaction_set': f.transaction_set,
                'error': (f.error_message or f.downstream_error or 'Unknown error')[:200],
                'created_at': f.received_at.isoformat(),
                'admin_url': f'/admin/jobs/jobrecord/{f.pk}/change/',
            }
            for f in failures
        ]
