from uuid import uuid4
from datetime import datetime, timezone
from threading import RLock
from .context_schema import ContextEnvelope, TaskBatch

class ContextStore:
    def __init__(self, capacity: int = 20):
        if capacity < 1:
            raise ValueError('capacity must be positive')
        self._capacity = capacity
        self._lock = RLock()
        self._items: dict[str, ContextEnvelope | TaskBatch] = {}
        self._requests: dict[str, str] = {}
        self._receipts: dict[str, dict] = {}
        self._latest_id: str | None = None

    def put(self, context: ContextEnvelope | TaskBatch) -> str:
        context_id = str(uuid4())
        with self._lock:
            request_id = str(context.request_id) if isinstance(context, TaskBatch) else None
            if request_id in self._requests:
                existing = self._requests[request_id]
                if self._items[existing] != context:
                    raise ValueError('REQUEST_CONFLICT')
                return existing
            self._items[context_id] = context.model_copy(deep=True)
            if request_id:
                self._requests[request_id] = context_id
            self._receipts[context_id] = {'context_id': context_id, 'saved_at': datetime.now(timezone.utc).isoformat(), 'mcp_read_at': None}
            self._latest_id = context_id
            while len(self._items) > self._capacity:
                oldest = next(iter(self._items))
                old = self._items[oldest]
                if isinstance(old, TaskBatch):
                    self._requests.pop(str(old.request_id), None)
                del self._items[oldest]
                del self._receipts[oldest]
        return context_id

    def latest(self):
        with self._lock:
            return None if self._latest_id is None else (self._latest_id, self.get(self._latest_id))

    def get(self, context_id: str):
        with self._lock:
            context = self._items.get(context_id)
            return context.model_copy(deep=True) if context else None

    def read_for_mcp(self, context_id: str | None = None):
        with self._lock:
            context_id = context_id or self._latest_id
            context = self.get(context_id)
            if context is None:
                return None
            if self._receipts[context_id]['mcp_read_at'] is None:
                self._receipts[context_id]['mcp_read_at'] = datetime.now(timezone.utc).isoformat()
            return context_id, context

    def receipt(self, context_id: str):
        with self._lock:
            receipt = self._receipts.get(context_id)
            return dict(receipt) if receipt else None

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._receipts.clear()
            self._requests.clear()
            self._latest_id = None
