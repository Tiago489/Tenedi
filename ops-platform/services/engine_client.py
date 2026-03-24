import os
import requests
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

ENGINE_URL = os.environ.get('ENGINE_URL', 'http://localhost:3000')


class EngineClient:
    def __init__(self):
        self.base_url = ENGINE_URL.rstrip('/')
        self.api_key = getattr(settings, 'ENGINE_API_KEY', '')
        self.session = requests.Session()
        if self.api_key:
            self.session.headers['Authorization'] = f'Bearer {self.api_key}'
        self.session.headers['Content-Type'] = 'application/json'

    def _get(self, path: str) -> dict | list:
        url = f'{self.base_url}{path}'
        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, data: dict) -> dict:
        url = f'{self.base_url}{path}'
        resp = self.session.post(url, json=data, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def compile_dsl(self, dsl: str, transaction_set: str) -> dict:
        """Compile DSL and validate against stored sample JEDI fixture."""
        return self._post('/maps/compile', {
            'dsl': dsl,
            'transactionSet': transaction_set,
        })

    def publish_map(self, map_data: dict) -> dict:
        """Publish a compiled map to the engine (goes live immediately)."""
        return self._post('/maps', map_data)

    def rollback_map(self, transaction_set: str, direction: str, version: int) -> dict:
        """Rollback a map to a specific version."""
        return self._post('/maps/rollback', {
            'transactionSet': transaction_set,
            'direction': direction,
            'version': version,
        })

    def list_maps(self) -> list:
        """List all active maps with version and publishedAt."""
        return self._get('/maps')

    def get_vocabulary(self) -> list[str]:
        """Fetch AI-generatable keyword tokens from the engine."""
        result = self._get('/maps/vocabulary')
        return result.get('keywords', [])

    def get_health(self) -> dict:
        """Check engine health."""
        return self._get('/health')
