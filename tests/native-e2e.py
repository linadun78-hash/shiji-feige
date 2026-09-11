"""Windows-only real browser/native-host integration in an isolated registration."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import uuid
import winreg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.native_setup import extension_id, registration_files
from server.desktop import Config, stop


def main():
    run = ROOT / 'evaluations' / ('native-e2e-' + uuid.uuid4().hex)
    project = run / '安装 中文 & path' / 'project'
    project.mkdir(parents=True)
    state = run / 'state'
    keys = []
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    for folder in ['extension', 'server', 'scripts']:
        shutil.copytree(ROOT / folder, project / folder, ignore=shutil.ignore_patterns('__pycache__'))
    host_name = 'com.shiji.feige.test_' + uuid.uuid4().hex
    background = project / 'extension' / 'src' / 'background.js'
    background.write_text(background.read_text(encoding='utf-8').replace('127.0.0.1:8766', f'127.0.0.1:{port}').replace('com.shiji.feige', host_name), encoding='utf-8')
    content = project / 'extension' / 'src' / 'content.js'
    content.write_text(content.read_text(encoding='utf-8').replace("mode:startedInExtension?'closed':'open'", "mode:'open'"), encoding='utf-8')
    desktop = project / 'server' / 'desktop.py'
    original = desktop.read_text(encoding='utf-8')
    original = original.replace("return Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local' / 'state')) / 'ShijiFeige'", 'return Path(' + repr(str(state)) + ')')
    desktop.write_text(original.replace('8766', str(port)), encoding='utf-8')
    manifest = registration_files(project, run / 'native', extension_id(project / 'extension' / 'manifest.json'))
    data = json.loads(manifest.read_text(encoding='utf-8'))
    data['name'] = host_name
    manifest.write_text(json.dumps(data), encoding='utf-8')
    try:
        for browser in [r'Microsoft\Edge', r'Google\Chrome']:
            key = rf'Software\{browser}\NativeMessagingHosts\{host_name}'
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_WRITE) as handle:
                winreg.SetValueEx(handle, '', 0, winreg.REG_SZ, str(manifest))
            keys.append(key)
        env = dict(os.environ, FEIGE_E2E_PROJECT=str(project), FEIGE_E2E_STATE=str(state),
                   FEIGE_E2E_PORT=str(port), FEIGE_E2E_OUTPUT=str(run), PYTHON_PATH=sys.executable)
        subprocess.run(['node', str(ROOT / 'tests' / 'browser-autostart.cjs')], env=env, cwd=ROOT, check=True, timeout=140)
        print(json.dumps({'ok': True, 'test_port': port, 'artifacts': str(run)}))
    finally:
        result = stop(Config(state_dir=state, port=port))
        for key in keys:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as handle:
                assert winreg.QueryValueEx(handle, '')[0] == str(manifest)
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
        if not result['ok']:
            raise RuntimeError('Test service cleanup failed: ' + str(result))


if __name__ == '__main__':
    main()
