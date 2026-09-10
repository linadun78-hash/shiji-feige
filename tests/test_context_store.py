from datetime import datetime, timezone
from fastapi.testclient import TestClient
from server.app import app, store

client = TestClient(app)

def payload():
    return {"schema_version":"1.0","source":{"site":"example.com","url":"https://example.com/x","title":"X","captured_at":datetime.now(timezone.utc).isoformat()},"selection":{"mode":"selection","text":"hello"},"content":{"format":"markdown","text":"hello"},"privacy":{"redacted_fields":[]}}

def setup_function():
    store.clear()

def test_health_and_context_lifecycle():
    assert client.get('/health').status_code == 200
    response = client.post('/v1/contexts', json=payload())
    assert response.status_code == 200
    context_id = response.json()['data']['context_id']
    latest = client.get('/v1/contexts/latest')
    assert latest.status_code == 200
    assert latest.json()['data']['context_id'] == context_id
    assert latest.json()['data']['context']['content']['text'] == 'hello'
    assert client.delete('/v1/contexts').status_code == 200
    assert client.get('/v1/contexts/latest').status_code == 404

def test_invalid_payload_is_not_stored():
    assert client.post('/v1/contexts', json={"bad": True}).status_code == 422
    assert client.get('/v1/contexts/latest').status_code == 404
