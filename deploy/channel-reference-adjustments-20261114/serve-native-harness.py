#!/usr/bin/env python3
"""Temporary fixture static server; parent starts/stops it. No application/API proxy."""
import argparse,hashlib,json,pathlib,http.server,urllib.parse
p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8818);a=p.parse_args()
ROOT=pathlib.Path('/home/ubuntu/work/channel-reference-adjustments-20261114/deploy-prep/native-ui-harness')
m=json.loads((ROOT/'harness-manifest.json').read_bytes());assert m['fixtureOnly'] is True and m['businessNetworkBlocked'] is True
for n,h in m['packageHashes'].items():assert hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h, 'Static pin drift '+n
allowed=set(m['packageHashes'])|{'harness-manifest.json'}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        name=urllib.parse.urlparse(self.path).path.lstrip('/') or 'index.html'
        if name not in allowed:self.send_error(403,'Only pinned static fixture files; business APIs forbidden');return
        file=ROOT/name
        if not file.is_file() or file.is_symlink():self.send_error(404);return
        data=file.read_bytes();expected=m['packageHashes'].get(name)
        if expected and hashlib.sha256(data).hexdigest()!=expected:self.send_error(409,'Fixture pin drift');return
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8' if name.endswith('.html') else 'text/javascript; charset=utf-8' if name.endswith('.js') else 'text/css; charset=utf-8' if name.endswith('.css') else 'application/json')
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_POST(self):self.send_error(403,'No writes or business APIs')
    do_PUT=do_POST;do_DELETE=do_POST;do_PATCH=do_POST
print('Readonly native factory fixture http://0.0.0.0:%s ; no app/API proxy; parent browser only'%a.port,flush=True)
http.server.ThreadingHTTPServer(('0.0.0.0',a.port),Handler).serve_forever()
