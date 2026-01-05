#!/usr/bin/env python3
"""
Simple API Server for Research Bot Data
Serves JSON data from the research bot to frontend pages
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DATA_DIR = Path(__file__).parent / "data"

class APIHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        # API endpoints
        if path == '/api/market':
            self.serve_json('market_data.json')
        elif path == '/api/futures':
            self.serve_json('futures_data.json')
        elif path == '/api/onchain':
            self.serve_json('onchain_data.json')
        elif path == '/api/sentiment':
            self.serve_json('sentiment.json')
        elif path == '/api/news':
            self.serve_json('news_data.json')
        elif path == '/api/setups':
            self.serve_json('trade_setups.json')
        elif path == '/api/all':
            self.serve_all_data()
        elif path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok'}).encode())
        else:
            self.send_error(404, 'Not Found')
    
    def serve_json(self, filename):
        filepath = DATA_DIR / filename
        if filepath.exists():
            with open(filepath, 'r') as f:
                data = json.load(f)
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        else:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'No data yet', 'data': []}).encode())
    
    def serve_all_data(self):
        """Serve all data in one response"""
        all_data = {}
        files = ['market_data', 'futures_data', 'onchain_data', 'sentiment', 'news_data', 'trade_setups']
        
        for name in files:
            filepath = DATA_DIR / f"{name}.json"
            if filepath.exists():
                with open(filepath, 'r') as f:
                    all_data[name] = json.load(f)
            else:
                all_data[name] = None
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(all_data).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

def run_server(port=8081):
    server = HTTPServer(('0.0.0.0', port), APIHandler)
    print(f"🚀 Research Bot API running at http://localhost:{port}")
    print(f"   Endpoints:")
    print(f"   - /api/all      - All data")
    print(f"   - /api/market   - Market data")
    print(f"   - /api/futures  - Futures data")
    print(f"   - /api/onchain  - On-chain data")
    print(f"   - /api/sentiment - Sentiment data")
    print(f"   - /api/news     - News/signals")
    print(f"   - /api/setups   - Trade setups")
    print(f"   - /health       - Health check")
    server.serve_forever()

if __name__ == '__main__':
    run_server()
