from contextlib import asynccontextmanager
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .context_schema import ApprovedContext
from .context_store import ContextStore
from .mcp_server import create_mcp_server

def create_app(context_store: ContextStore | None = None):
    store = context_store if context_store is not None else ContextStore()
    mcp = create_mcp_server(store)
    mcp_app = mcp.streamable_http_app()

    @asynccontextmanager
    async def lifespan(app):
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title='Shiji Feige', lifespan=lifespan)
    app.state.store = store
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]', 'testserver'])
    app.add_middleware(CORSMiddleware, allow_origin_regex=r'chrome-extension://[a-p]{32}',
                       allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Content-Type'])

    @app.middleware('http')
    async def check_origin(request: Request, call_next):
        # CORS alone does not prevent a webpage from writing to localhost.
        origin = request.headers.get('origin')
        if origin and not re.fullmatch(r'chrome-extension://[a-p]{32}|http://(127\.0\.0\.1|localhost)(:\d+)?', origin):
            return JSONResponse({'ok': False, 'error': {'code': 'ORIGIN_REJECTED'}}, status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    def missing():
        raise HTTPException(status_code=404, detail={'code': 'CONTEXT_NOT_FOUND', 'message': 'Context not found or expired'})

    @app.get('/health')
    def health():
        return {'ok': True, 'data': {'service': 'web-context-agent-bridge', 'mcp_path': '/mcp', 'schema_versions':['1.0','2.0']}, 'error': None}

    @app.post('/v1/contexts')
    def create_context(context: ApprovedContext):
        try:
            context_id = store.put(context)
        except ValueError as error:
            raise HTTPException(status_code=409, detail={'code':'REQUEST_CONFLICT'}) from error
        return {'ok': True, 'data': {'context_id': context_id}, 'error': None}

    @app.get('/v1/contexts/latest')
    def latest_context():
        item = store.latest()
        if item is None:
            missing()
        context_id, context = item
        return {'ok': True, 'data': {'context_id': context_id, 'context': context.model_dump(mode='json')}, 'error': None}

    @app.get('/v1/contexts/{context_id}/receipt')
    def receipt(context_id: str):
        result = store.receipt(context_id)
        if result is None:
            missing()
        return {'ok': True, 'data': result, 'error': None}

    @app.get('/v1/contexts/{context_id}')
    def get_context(context_id: str):
        context = store.get(context_id)
        if context is None:
            missing()
        return {'ok': True, 'data': {'context_id': context_id, 'context': context.model_dump(mode='json')}, 'error': None}

    @app.delete('/v1/contexts')
    def clear_context():
        store.clear()
        return {'ok': True, 'data': {'cleared': True}, 'error': None}

    app.mount('/', mcp_app)
    return app


store = ContextStore()
app = create_app(store)
