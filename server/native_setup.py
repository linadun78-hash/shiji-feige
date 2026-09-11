"""Register only the current Windows user's Edge/Chrome native host."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from .desktop import ROOT, default_state

HOST = 'com.shiji.feige'
KEYS = [rf'Software\{browser}\NativeMessagingHosts\{HOST}' for browser in [r'Microsoft\Edge', r'Google\Chrome']]


def extension_id(manifest):
    key = base64.b64decode(json.loads(manifest.read_text(encoding='utf-8'))['key'], validate=True)
    return ''.join(chr(ord('a') + int(n, 16)) for n in hashlib.sha256(key).hexdigest()[:32])


def registration_files(project, directory, identifier):
    if not re.fullmatch('[a-p]{32}', identifier):
        raise ValueError('INVALID_EXTENSION_ID')
    directory.mkdir(parents=True, exist_ok=True)
    python = Path(sys.executable).resolve()
    script = (project / 'scripts' / 'native-host.py').resolve()
    # Batch expansion must not reinterpret literal percent characters in install paths.
    quoted = [str(path).replace('%', '%%') for path in [python, script]]
    if any('\n' in path or '\r' in path or '"' in path for path in quoted):
        raise ValueError('UNSUPPORTED_INSTALL_PATH')
    launcher = directory / 'native-host.cmd'
    launcher.write_text('@echo off\nchcp 65001 >nul\nsetlocal DisableDelayedExpansion\n' + f'"{quoted[0]}" "{quoted[1]}" %*\n', encoding='utf-8')
    manifest = directory / 'host.json'
    manifest.write_text(json.dumps({'name': HOST, 'description': 'Shiji Feige local launcher',
                                   'path': str(launcher.resolve()), 'type': 'stdio',
                                   'allowed_origins': [f'chrome-extension://{identifier}/']}, indent=2), encoding='utf-8')
    return manifest


def install(identifier):
    import winreg
    import fastapi, uvicorn, mcp  # Fail before registering an unusable Python environment.
    manifest = registration_files(ROOT, default_state() / 'native', identifier)
    for key in KEYS:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_WRITE) as handle:
            winreg.SetValueEx(handle, '', 0, winreg.REG_SZ, str(manifest))
    return {'ok': True, 'extension_id': identifier, 'manifest': str(manifest)}


def uninstall():
    import winreg
    expected = default_state() / 'native' / 'host.json'
    for key in KEYS:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as handle:
                current = winreg.QueryValueEx(handle, '')[0]
            if Path(current) == expected:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
        except FileNotFoundError:
            pass
    return {'ok': True, 'registered': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'uninstall'])
    parser.add_argument('--extension-id')
    args = parser.parse_args()
    if os.name != 'nt' or sys.version_info < (3, 10):
        parser.exit(1, 'Windows and Python 3.10+ are required.\n')
    try:
        result = install(args.extension_id or extension_id(ROOT / 'extension' / 'manifest.json')) if args.action == 'install' else uninstall()
        print(json.dumps(result))
    except (OSError, ValueError, ImportError, KeyError) as error:
        parser.exit(1, f'Registration failed: {error}\nInstall dependencies: python -m pip install -r server/requirements.txt\n')


if __name__ == '__main__':
    main()
