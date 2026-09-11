"""One bounded native message; stdout is reserved for the browser protocol."""
import json
import os
import struct
import sys
from .desktop import Config, start, status


def read_exact(stream, size):
    result = bytearray()
    while len(result) < size:
        chunk = stream.read(size - len(result))
        if not chunk:
            raise ValueError('TRUNCATED_MESSAGE')
        result.extend(chunk)
    return bytes(result)


def read_message(stream):
    size = struct.unpack('<I', read_exact(stream, 4))[0]
    if not 0 < size <= 65536:
        raise ValueError('INVALID_MESSAGE_SIZE')
    return json.loads(read_exact(stream, size).decode('utf-8'))


def write_message(stream, value):
    data = json.dumps(value, ensure_ascii=False).encode('utf-8')
    stream.write(struct.pack('<I', len(data)) + data)
    stream.flush()


def dispatch(message, launch, inspect):
    if not isinstance(message, dict) or set(message) != {'action'}:
        return {'ok': False, 'error': 'INVALID_REQUEST'}
    if message['action'] == 'start':
        return launch()
    if message['action'] == 'status':
        return inspect()
    return {'ok': False, 'error': 'INVALID_REQUEST'}


def main():
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    try:
        config = Config()
        result = dispatch(read_message(sys.stdin.buffer), lambda: start(config), lambda: status(config))
    except (ValueError, OSError):
        result = {'ok': False, 'error': 'INVALID_REQUEST'}
    write_message(sys.stdout.buffer, result)
