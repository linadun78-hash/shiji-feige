"""Protocol client used by the real-extension integration test."""
import asyncio
import json
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main():
    async with httpx.AsyncClient(trust_env=False) as http:
        async with streamable_http_client(sys.argv[1], http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool('get_selected_context', {'context_id': sys.argv[2]})
                assert not result.isError
                print(json.dumps(json.loads(result.content[0].text), ensure_ascii=True))


if __name__ == '__main__':
    asyncio.run(main())
