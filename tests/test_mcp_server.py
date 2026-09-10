from datetime import datetime, timezone
from server.context_schema import ContextEnvelope
from server.context_store import ContextStore
from server.mcp_server import get_page_outline, get_selected_context, clear_context, create_mcp_server

def context():
    return ContextEnvelope.model_validate({"schema_version":"1.0","source":{"site":"x","url":"https://x.test","title":"Title","captured_at":datetime.now(timezone.utc)},"selection":{"mode":"selection","text":"body"},"content":{"format":"markdown","text":"body","blocks":[{"text":"body"}]}})

def test_tools_return_not_found_without_context():
    store = ContextStore()
    assert get_selected_context(store)["error"]["code"] == "CONTEXT_NOT_FOUND"
    assert get_page_outline(store)["error"]["code"] == "CONTEXT_NOT_FOUND"

def test_tools_expose_latest_and_clear():
    store = ContextStore(); context_id = store.put(context())
    assert get_selected_context(store)["data"]["context_id"] == context_id
    outline = get_page_outline(store)["data"]
    assert outline["title"] == "Title" and "text" not in outline
    assert clear_context(store)["data"]["cleared"] is True

def test_mcp_server_registers_tools():
    server = create_mcp_server(ContextStore())
    assert server is not None


def test_snapshots_are_isolated_and_old_receipts_expire():
    store = ContextStore(capacity=2)
    original = context()
    first = store.put(original)
    original.content.text = 'Later edit'
    assert store.get(first).content.text == 'body'
    retrieved = store.get(first)
    retrieved.content.text = 'Reader mutation'
    assert store.get(first).content.text == 'body'
    second = store.put(context())
    assert store.receipt(first)['mcp_read_at'] is None
    get_selected_context(store, first)
    assert store.receipt(first)['mcp_read_at']
    assert store.receipt(second)['mcp_read_at'] is None
    store.put(context())
    assert store.get(first) is None
    assert store.receipt(first) is None
