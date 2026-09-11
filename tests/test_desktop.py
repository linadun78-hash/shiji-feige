import importlib.util
import io
import json
import socket
import struct
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest


@pytest.fixture
def tmp_path():
    folder = Path(__file__).resolve().parents[1] / 'evaluations' / 'native-tests' / uuid4().hex
    folder.mkdir(parents=True)
    return folder


def modules():
    assert importlib.util.find_spec('server.desktop'), 'Background lifecycle is not implemented'
    assert importlib.util.find_spec('server.native_host'), 'Native host is not implemented'
    from server import desktop, native_host
    return desktop, native_host


def test_native_protocol_limits_and_exact_action():
    _, host = modules()
    output = io.BytesIO()
    host.write_message(output, {'ok': True, 'text': '飞鸽'})
    output.seek(0)
    assert host.read_message(output) == {'ok': True, 'text': '飞鸽'}
    for raw in [b'\x01', struct.pack('<I', 1000000), struct.pack('<I', 5) + b'{}']:
        with pytest.raises(ValueError):
            host.read_message(io.BytesIO(raw))
    calls = []
    assert host.dispatch({'action': 'start'}, lambda: calls.append('start') or {'ok': True}, lambda: {})['ok']
    for value in [{'action': 'exec'}, {'action': 'start', 'command': 'anything'}, [], None]:
        assert host.dispatch(value, lambda: calls.append('bad'), lambda: {}) == {'ok': False, 'error': 'INVALID_REQUEST'}
    assert calls == ['start']


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def test_background_start_reuse_stop_restart(tmp_path):
    desktop, _ = modules()
    config = desktop.Config(state_dir=tmp_path, port=free_port())
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda _: desktop.start(config), range(3)))
        assert all(item['ok'] for item in results), results
        state = json.loads((tmp_path / 'instance.json').read_text())
        assert desktop.status(config)['running']
        assert desktop.start(config)['ok']
        assert json.loads((tmp_path / 'instance.json').read_text())['instance'] == state['instance']
        assert desktop.stop(config)['ok']
        assert not desktop.status(config)['running']
        assert desktop.start(config)['ok']
        assert json.loads((tmp_path / 'instance.json').read_text())['instance'] != state['instance']
    finally:
        desktop.stop(config)
    assert not desktop.status(config)['running']


def test_occupied_port_is_not_replaced(tmp_path):
    desktop, _ = modules()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        sock.listen()
        config = desktop.Config(state_dir=tmp_path, port=sock.getsockname()[1])
        result = desktop.start(config)
        assert result == {'ok': False, 'error': 'PORT_OCCUPIED'}
        assert not (tmp_path / 'instance.json').exists()
        assert desktop.stop(config)['ok']


def test_native_registration_uses_exact_extension_id(tmp_path):
    _, host = modules()
    assert importlib.util.find_spec('server.native_setup'), 'Native registration is not implemented'
    from server.native_setup import extension_id, registration_files
    project = Path(__file__).resolve().parents[1]
    identifier = extension_id(project / 'extension' / 'manifest.json')
    assert len(identifier) == 32 and set(identifier) <= set('abcdefghijklmnop')
    manifest = registration_files(project, tmp_path, identifier)
    data = json.loads(manifest.read_text())
    assert data['name'] == 'com.shiji.feige'
    assert data['allowed_origins'] == [f'chrome-extension://{identifier}/']
    assert Path(data['path']).exists()
    with pytest.raises(ValueError):
        registration_files(project, tmp_path, '*')
