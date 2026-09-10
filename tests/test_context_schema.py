from datetime import datetime, timezone
import pytest
from pydantic import ValidationError
from server.context_schema import ContextEnvelope

def payload():
    return {
        "schema_version": "1.0",
        "source": {"site": "example.com", "url": "https://example.com/jobs/1", "title": "Example job", "captured_at": datetime.now(timezone.utc)},
        "selection": {"mode": "selection", "heading": "Requirements", "text": "Python and SQL"},
        "content": {"format": "markdown", "text": "## Requirements\nPython and SQL"},
        "privacy": {"redacted_fields": []},
    }

def test_valid_context_envelope():
    context = ContextEnvelope.model_validate(payload())
    assert context.selection.text == "Python and SQL"
    assert context.source.url.startswith("https://")

def test_region_capture_is_accepted():
    data = payload()
    data["selection"]["mode"] = "region"
    assert ContextEnvelope.model_validate(data).selection.mode == "region"

@pytest.mark.parametrize("change", [
    {"selection": {"mode": "selection", "text": "   "}},
    {"source": {"site": "example.com", "url": "relative", "title": "x", "captured_at": datetime.now(timezone.utc)}},
    {"selection": {"mode": "unsupported", "text": "x"}},
])
def test_invalid_context_is_rejected(change):
    data = payload()
    data.update(change)
    with pytest.raises(ValidationError):
        ContextEnvelope.model_validate(data)
