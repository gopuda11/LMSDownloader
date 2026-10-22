"""Package only extension runtime files and attribution, without personal fixtures."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'manifest.json').read_text())['version']
files = ['manifest.json', 'background.js', 'recovery.js', 'ilos.js', 'popup-ilos.js', 'page-capture.js',
         'content-bridge.js', 'popup.js', 'popup.html', 'style.css', 'rules.json',
         'documents.js', 'document-scanner.js', 'converter.html', 'converter.js', 'converter.css',
         'sandbox.html', 'sandbox.css', 'THIRD_PARTY_NOTICES.md', 'icon-16.png', 'icon-48.png', 'icon-128.png', 'logo.svg', 'LICENSE', 'README.md']
files += sorted(str(p.relative_to(root)) for p in (root / 'img').glob('usage-*')
                if p.suffix in {'.jpg', '.png'})
files += sorted(str(p.relative_to(root)) for p in (root / 'vendor').rglob('*') if p.is_file())
output = root / 'dist' / f'LMSDownloader-v{version}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
print(output)
