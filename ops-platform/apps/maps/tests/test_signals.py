from unittest.mock import patch, MagicMock
from django.test import TestCase, Client
from apps.partners.models import TradingPartner
from apps.maps.models import TransformMap


class TestSignalFiresOnPublish(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_signal_fires_on_is_live_true_with_dsl(self, mock_post):
        mock_post.return_value = MagicMock(ok=True, status_code=200)
        partner = TradingPartner.objects.create(
            name='Test Partner', partner_id='TESTPD', transport='sftp',
        )
        TransformMap.objects.create(
            partner=partner,
            transaction_set='204',
            direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=True,
        )
        mock_post.assert_called_once()
        call_url = mock_post.call_args[0][0]
        self.assertIn('/maps/reload', call_url)
        payload = mock_post.call_args[1]['json']
        self.assertEqual(payload['transaction_set'], '204')
        self.assertEqual(payload['direction'], 'inbound')
        self.assertEqual(payload['partner_key'], 'testpd')
        self.assertIn('b2_element_02', payload['dsl_source'])

    @patch('apps.maps.signals.requests.post')
    def test_signal_does_not_fire_when_not_live(self, mock_post):
        TransformMap.objects.create(
            transaction_set='204', direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=False,
        )
        mock_post.assert_not_called()

    @patch('apps.maps.signals.requests.post')
    def test_signal_does_not_fire_without_dsl_or_transform(self, mock_post):
        TransformMap.objects.create(
            transaction_set='204', direction='inbound',
            dsl_source='', custom_transform_id='',
            is_live=True,
        )
        mock_post.assert_not_called()

    @patch('apps.maps.signals.requests.post')
    def test_signal_fires_for_custom_transform(self, mock_post):
        mock_post.return_value = MagicMock(ok=True, status_code=200)
        partner = TradingPartner.objects.create(
            name='CEVA', partner_id='CEVAPD', transport='sftp',
        )
        TransformMap.objects.create(
            partner=partner,
            transaction_set='204', direction='inbound',
            custom_transform_id='cevapd-204',
            is_live=True,
        )
        mock_post.assert_called_once()
        payload = mock_post.call_args[1]['json']
        self.assertEqual(payload['custom_transform_id'], 'cevapd-204')
        self.assertEqual(payload['partner_key'], 'cevapd')

    @patch('apps.maps.signals.requests.post')
    def test_signal_fails_gracefully_when_engine_down(self, mock_post):
        mock_post.side_effect = Exception('Connection refused')
        # Should not raise
        TransformMap.objects.create(
            transaction_set='204', direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=True,
        )
        mock_post.assert_called_once()

    @patch('apps.maps.signals.requests.post')
    def test_signal_partner_key_is_lowercased(self, mock_post):
        mock_post.return_value = MagicMock(ok=True, status_code=200)
        partner = TradingPartner.objects.create(
            name='Test', partner_id='UPPERCASE', transport='sftp',
        )
        TransformMap.objects.create(
            partner=partner,
            transaction_set='204', direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=True,
        )
        payload = mock_post.call_args[1]['json']
        self.assertEqual(payload['partner_key'], 'uppercase')

    @patch('apps.maps.signals.requests.post')
    def test_signal_null_partner_key_for_default_map(self, mock_post):
        mock_post.return_value = MagicMock(ok=True, status_code=200)
        TransformMap.objects.create(
            partner=None,
            transaction_set='204', direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=True,
        )
        payload = mock_post.call_args[1]['json']
        self.assertIsNone(payload['partner_key'])


class TestPublishedMapsEndpoint(TestCase):

    def setUp(self):
        self.client = Client()

    @patch('apps.maps.signals.requests.post')
    def test_published_returns_only_live_maps(self, mock_post):
        mock_post.return_value = MagicMock(ok=True, status_code=200)
        partner = TradingPartner.objects.create(
            name='Test', partner_id='TESTPD', transport='sftp',
        )
        TransformMap.objects.create(
            partner=partner, transaction_set='204', direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=True,
        )
        TransformMap.objects.create(
            partner=partner, transaction_set='211', direction='inbound',
            dsl_source='$map heading.bol.bol_element_01 to bol',
            is_live=False,
        )

        response = self.client.get('/api/maps/published/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['transaction_set'], '204')

    @patch('apps.maps.signals.requests.post')
    def test_published_response_shape(self, mock_post):
        mock_post.return_value = MagicMock(ok=True, status_code=200)
        partner = TradingPartner.objects.create(
            name='Test', partner_id='TESTPD', transport='sftp',
        )
        TransformMap.objects.create(
            partner=partner, transaction_set='204', direction='inbound',
            dsl_source='$map heading.b2.b2_element_02 to scac',
            is_live=True, version=2,
        )

        response = self.client.get('/api/maps/published/')
        entry = response.json()[0]
        self.assertEqual(entry['partner_key'], 'testpd')
        self.assertEqual(entry['transaction_set'], '204')
        self.assertEqual(entry['direction'], 'inbound')
        self.assertIn('dsl_source', entry)
        self.assertIn('custom_transform_id', entry)
        self.assertEqual(entry['version'], 2)
