"""Local background lifecycle. Native callers cannot supply these CLI settings."""
import argparse
from contextlib import contextmanager
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SERVICE = 'web-context-agent-bridge'


def default_state():
    return Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local' / 'state')) / 'ShijiFeige'


@dataclass
class Config:
    state_dir: Path = field(default_factory=default_state)
    port: int = 8766


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def status(config):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(f'http://127.0.0.1:{config.port}/health', timeout=0.6) as response:
            value = json.loads(response.read(16384))
        if isinstance(value, dict) and value.get('ok') and isinstance(value.get('data'), dict) and value['data'].get('service') == SERVICE:
            return {'ok': True, 'running': True, 'port': config.port}
    except (OSError, ValueError, urllib.error.URLError):
        pass
    return {'ok': True, 'running': False}


@contextmanager
def file_lock(path, timeout=20):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b'0')
            handle.flush()
        deadline = time.monotonic() + timeout
        while True:
            try:
                handle.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('LOCK_TIMEOUT')
                time.sleep(0.1)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == 'nt':
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def read_state(config):
    try:
        return json.loads((config.state_dir / 'instance.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), encoding='utf-8')
    temporary.replace(path)


def start(config):
    try:
        with file_lock(config.state_dir / 'start.lock'):
            if status(config)['running']:
                return {'ok': True, 'running': True, 'reused': True}
            with socket.socket() as probe:
                try:
                    if os.name == 'nt':
                        probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                    probe.bind(('127.0.0.1', config.port))
                except OSError:
                    return {'ok': False, 'error': 'PORT_OCCUPIED'}
            python = Path(sys.executable)
            windowless = python.with_name('pythonw.exe')
            if os.name == 'nt' and windowless.exists():
                python = windowless
            startup_log = config.state_dir / 'startup.log'
            if startup_log.exists() and startup_log.stat().st_size > 1024 * 1024:
                startup_log.write_bytes(b'')
            with startup_log.open('ab') as log:
                child = subprocess.Popen(
                    [str(python), '-m', 'server.desktop', 'serve', '--state-dir', str(config.state_dir.resolve()),
                     '--port', str(config.port)], cwd=ROOT,
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS) if os.name == 'nt' else 0,
                    start_new_session=os.name != 'nt',
                )
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if status(config)['running']:
                    return {'ok': True, 'running': True, 'reused': False}
                if child.poll() is not None:
                    return {'ok': False, 'error': 'START_FAILED'}
                time.sleep(0.15)
            # Only terminate the child this call created, never a process found by PID.
            child.terminate()
            child.wait(timeout=5)
            return {'ok': False, 'error': 'START_TIMEOUT'}
    except TimeoutError:
        return {'ok': False, 'error': 'START_TIMEOUT'}
    except OSError:
        return {'ok': False, 'error': 'START_FAILED'}


def stop(config):
    try:
        with file_lock(config.state_dir / 'start.lock'):
            state = read_state(config)
            if not status(config)['running']:
                return {'ok': True, 'running': False}
            if not state.get('instance') or state.get('port') != config.port:
                return {'ok': False, 'error': 'UNMANAGED_SERVICE'}
            write_json(config.state_dir / 'stop.json', {'instance': state['instance']})
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if not status(config)['running'] and read_state(config).get('instance') != state['instance']:
                    return {'ok': True, 'running': False}
                time.sleep(0.15)
            return {'ok': False, 'error': 'STOP_TIMEOUT'}
    except (OSError, TimeoutError):
        return {'ok': False, 'error': 'STOP_FAILED'}


def serve(config):
    import uvicorn
    from .app import create_app
    with file_lock(config.state_dir / 'service.lock', timeout=0):
        instance = uuid4().hex
        logfile = str(config.state_dir / 'service.log')
        logging = {'version': 1, 'disable_existing_loggers': False,
                   'formatters': {'plain': {'format': '%(asctime)s %(levelname)s %(message)s'}},
                   'handlers': {'file': {'class': 'logging.handlers.RotatingFileHandler', 'filename': logfile,
                                        'maxBytes': 1024 * 1024, 'backupCount': 2, 'encoding': 'utf-8', 'formatter': 'plain'}},
                   'root': {'handlers': ['file'], 'level': 'WARNING'}}
        server = uvicorn.Server(uvicorn.Config(create_app(), host='127.0.0.1', port=config.port,
                                               access_log=False, log_config=logging))
        finished = threading.Event()
        def watch_stop():
            while not finished.wait(0.25):
                try:
                    signal = json.loads((config.state_dir / 'stop.json').read_text(encoding='utf-8'))
                    if signal.get('instance') == instance:
                        server.should_exit = True
                        return
                except (OSError, ValueError):
                    pass
        write_json(config.state_dir / 'instance.json', {'instance': instance, 'pid': os.getpid(), 'port': config.port})
        watcher = threading.Thread(target=watch_stop, daemon=True)
        watcher.start()
        try:
            server.run()
        finally:
            finished.set()
            watcher.join(timeout=1)
            if read_state(config).get('instance') == instance:
                (config.state_dir / 'instance.json').unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'status', 'serve'])
    parser.add_argument('--state-dir', type=Path, default=default_state())
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    config = Config(args.state_dir, args.port)
    if args.action == 'serve':
        serve(config)
        return
    result = {'start': start, 'stop': stop, 'status': status}[args.action](config)
    print(json.dumps(result))
    sys.exit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
