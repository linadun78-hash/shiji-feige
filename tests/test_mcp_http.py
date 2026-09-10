import asyncio
import json
import socket
import threading
import time

import httpx
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from server.app import create_app
from test_context_store import payload


def test_extension_post_is_readable_via_real_mcp_protocol():
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(), log_level='error'))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert server.started
        asyncio.run(check_protocol(f'http://127.0.0.1:{port}'))
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()
        assert not thread.is_alive()


async def check_protocol(base):
    async with httpx.AsyncClient(base_url=base, trust_env=False) as http:
        assert (await http.get('/v1/contexts/latest')).status_code == 404
        data = payload()
        data['selection']['text'] = data['content']['text'] = 'Approved and edited [email]'
        submitted = await http.post('/v1/contexts', json=data)
        context_id = submitted.json()['data']['context_id']
        receipt_url = f'/v1/contexts/{context_id}/receipt'
        assert (await http.get(receipt_url)).json()['data']['mcp_read_at'] is None
        async with streamable_http_client(base + '/mcp', http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                names = {tool.name for tool in (await session.list_tools()).tools}
                assert names == {'get_selected_context', 'get_page_outline', 'clear_context'}
                await session.call_tool('get_page_outline', {})
                assert (await http.get(receipt_url)).json()['data']['mcp_read_at'] is None
                result = await session.call_tool('get_selected_context', {'context_id': context_id})
                assert not result.isError
                received = json.loads(result.content[0].text)
                assert received['data']['context']['content']['text'] == data['content']['text']
                assert received['data']['context']['selection']['text'] == data['content']['text']
                assert (await http.get(receipt_url)).json()['data']['mcp_read_at']
                missing = await session.call_tool('get_selected_context', {'context_id': 'missing'})
                assert json.loads(missing.content[0].text)['error']['code'] == 'CONTEXT_NOT_FOUND'
                await session.call_tool('clear_context', {})
                assert (await http.get(receipt_url)).status_code == 404
        blocked = await http.post('/v1/contexts', json=data, headers={'Origin': 'https://unrelated.example'})
        assert blocked.status_code == 403
        assert (await http.get('/v1/contexts/latest')).status_code == 404
