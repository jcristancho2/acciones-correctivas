"""Servidor local para la aplicación de acciones correctivas.

Sirve el HTML estático y mantiene los registros en SQLite sin dependencias
externas. Está destinado a uso local (127.0.0.1), no a exponerlo en red.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).parent
DATABASE = ROOT / "acciones_correctivas.sqlite3"


def _connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE IF NOT EXISTS acciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT NOT NULL,
            creado_en TEXT NOT NULL,
            actualizado_en TEXT NOT NULL
        )"""
    )
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(row: sqlite3.Row) -> dict:
    record = json.loads(row["payload"])
    record.update(id=row["id"], creado_en=row["creado_en"], actualizado_en=row["actualizado_en"])
    return record


class ActionsHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, status: HTTPStatus, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError
            return value
        except (ValueError, json.JSONDecodeError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido"})
            return None

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/acciones":
            with _connection() as conn:
                rows = conn.execute("SELECT * FROM acciones ORDER BY id DESC").fetchall()
            self._json(HTTPStatus.OK, [_row(row) for row in rows])
            return
        if path == "/api/avisos":
            self._json(HTTPStatus.OK, [])
            return
        if unquote(path) in ("/", "/index.html"):
            page = (ROOT / "index.html").read_text(encoding="utf-8")
            page = page.replace("</body>", '<script src="/save-feedback.js"></script></body>')
            body = page.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/acciones":
            self._json(HTTPStatus.NOT_FOUND, {"error": "Ruta no encontrada"})
            return
        payload = self._body()
        if payload is None:
            return
        now = _now()
        with _connection() as conn:
            cur = conn.execute(
                "INSERT INTO acciones (payload, creado_en, actualizado_en) VALUES (?, ?, ?)",
                (json.dumps(payload, ensure_ascii=False), now, now),
            )
        self._json(HTTPStatus.CREATED, {"id": cur.lastrowid})

    def do_PUT(self) -> None:
        prefix = "/api/acciones/"
        path = urlparse(self.path).path
        if not path.startswith(prefix) or not path[len(prefix):].isdigit():
            self._json(HTTPStatus.NOT_FOUND, {"error": "Ruta no encontrada"})
            return
        payload = self._body()
        if payload is None:
            return
        action_id = int(path[len(prefix):])
        with _connection() as conn:
            cur = conn.execute(
                "UPDATE acciones SET payload = ?, actualizado_en = ? WHERE id = ?",
                (json.dumps(payload, ensure_ascii=False), _now(), action_id),
            )
        if cur.rowcount == 0:
            self._json(HTTPStatus.NOT_FOUND, {"error": "Registro no encontrado"})
            return
        self._json(HTTPStatus.OK, {"id": action_id})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8091), ActionsHandler)
    print("Acciones correctivas: http://127.0.0.1:8091/")
    server.serve_forever()
