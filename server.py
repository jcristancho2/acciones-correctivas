"""API de acciones correctivas con Firestore para producción y SQLite local."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT))
DATABASE = DATA_DIR / "acciones_correctivas.sqlite3"
FIREBASE_CREDENTIALS = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
_firestore = None
_firestore_lock = threading.Lock()


def _firestore_client():
    """Devuelve Firestore cuando Render tiene la credencial de Firebase.

    SQLite se conserva para desarrollo local y para iniciar la aplicación antes
    de configurar Render.
    """
    global _firestore
    if not FIREBASE_CREDENTIALS and not FIREBASE_SERVICE_ACCOUNT_JSON:
        return None
    if _firestore is None:
        # ThreadingHTTPServer atiende solicitudes en paralelo. Sin este candado,
        # dos solicitudes de arranque pueden intentar crear la app de Firebase a
        # la vez y una de ellas falla antes de guardar o listar el registro.
        with _firestore_lock:
            if _firestore is None:
                import firebase_admin
                from firebase_admin import credentials, firestore

                if not firebase_admin._apps:
                    credential_source = (
                        json.loads(FIREBASE_SERVICE_ACCOUNT_JSON)
                        if FIREBASE_SERVICE_ACCOUNT_JSON
                        else FIREBASE_CREDENTIALS
                    )
                    firebase_admin.initialize_app(credentials.Certificate(credential_source))
                _firestore = firestore.client()
    return _firestore


def _connection() -> sqlite3.Connection:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
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
    conn.execute(
        """CREATE TABLE IF NOT EXISTS auditoria_acciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            accion_id INTEGER NOT NULL,
            evento TEXT NOT NULL,
            detalle TEXT NOT NULL,
            creado_en TEXT NOT NULL
        )"""
    )
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(row: sqlite3.Row) -> dict:
    record = json.loads(row["payload"])
    record.update(id=row["id"], creado_en=row["creado_en"], actualizado_en=row["actualizado_en"])
    return record


def _firestore_actions() -> list[dict] | None:
    db = _firestore_client()
    if db is None:
        return None
    return [document.to_dict() for document in db.collection("acciones").order_by("id", direction="DESCENDING").stream(timeout=25)]


def _next_firestore_id(db) -> int:
    from firebase_admin import firestore

    counter = db.collection("_meta").document("acciones")
    transaction = db.transaction()

    @firestore.transactional
    def increment(transaction):
        snapshot = counter.get(transaction=transaction)
        last_id = int(snapshot.to_dict().get("last_id", 0)) if snapshot.exists else 0
        next_id = last_id + 1
        transaction.set(counter, {"last_id": next_id})
        return next_id

    return increment(transaction)


def _create_action(payload: dict) -> int:
    db = _firestore_client()
    now = _now()
    if db is not None:
        action_id = _next_firestore_id(db)
        db.collection("acciones").document(str(action_id)).set(
            {**payload, "id": action_id, "creado_en": now, "actualizado_en": now}, timeout=25
        )
        db.collection("acciones").document(str(action_id)).collection("bitacora").add(
            {"evento": "creado", "detalle": payload, "creado_en": now}, timeout=25
        )
        return action_id
    with _connection() as conn:
        cur = conn.execute(
            "INSERT INTO acciones (payload, creado_en, actualizado_en) VALUES (?, ?, ?)",
            (json.dumps(payload, ensure_ascii=False), now, now),
        )
        conn.execute(
            "INSERT INTO auditoria_acciones (accion_id, evento, detalle, creado_en) VALUES (?, ?, ?, ?)",
            (cur.lastrowid, "creado", json.dumps(payload, ensure_ascii=False), now),
        )
    return cur.lastrowid


def _update_action(action_id: int, payload: dict) -> bool:
    db = _firestore_client()
    if db is not None:
        document = db.collection("acciones").document(str(action_id))
        if not document.get(timeout=25).exists:
            return False
        document.update({**payload, "id": action_id, "actualizado_en": _now()}, timeout=25)
        document.collection("bitacora").add(
            {"evento": "actualizado", "detalle": payload, "creado_en": _now()}, timeout=25
        )
        return True
    with _connection() as conn:
        cur = conn.execute(
            "UPDATE acciones SET payload = ?, actualizado_en = ? WHERE id = ?",
            (json.dumps(payload, ensure_ascii=False), _now(), action_id),
        )
        if cur.rowcount:
            conn.execute(
                "INSERT INTO auditoria_acciones (accion_id, evento, detalle, creado_en) VALUES (?, ?, ?, ?)",
                (action_id, "actualizado", json.dumps(payload, ensure_ascii=False), _now()),
            )
    return cur.rowcount > 0


def _validate_payload(payload: dict) -> str | None:
    """Comprueba identificadores y el cierre de acciones sin alterar registros previos."""
    for key in ("acciones_multiples", "correcciones_multiples"):
        try:
            entries = json.loads(payload.get(key, "[]"))
        except (TypeError, json.JSONDecodeError):
            return f"{key} debe contener una lista válida"
        if not isinstance(entries, list):
            return f"{key} debe contener una lista válida"
        ids = [entry.get("id") for entry in entries if isinstance(entry, dict)]
        if any(not item for item in ids) or len(ids) != len(set(ids)):
            return f"Cada elemento de {key} debe tener un identificador único"
    return None


def _delete_action(action_id: int) -> bool:
    db = _firestore_client()
    if db is not None:
        document = db.collection("acciones").document(str(action_id))
        if not document.get(timeout=25).exists:
            return False
        document.delete(timeout=25)
        return True
    with _connection() as conn:
        cur = conn.execute("DELETE FROM acciones WHERE id = ?", (action_id,))
    return cur.rowcount > 0


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
            actions = _firestore_actions()
            if actions is None:
                with _connection() as conn:
                    rows = conn.execute("SELECT * FROM acciones ORDER BY id DESC").fetchall()
                actions = [_row(row) for row in rows]
            self._json(HTTPStatus.OK, actions)
            return
        if path == "/api/avisos":
            self._json(HTTPStatus.OK, [])
            return
        if unquote(path) in ("/", "/index.html"):
            page = (ROOT / "index.html").read_text(encoding="utf-8")
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
        error = _validate_payload(payload)
        if error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": error})
            return
        self._json(HTTPStatus.CREATED, {"id": _create_action(payload)})

    def do_PUT(self) -> None:
        prefix = "/api/acciones/"
        path = urlparse(self.path).path
        if not path.startswith(prefix) or not path[len(prefix):].isdigit():
            self._json(HTTPStatus.NOT_FOUND, {"error": "Ruta no encontrada"})
            return
        payload = self._body()
        if payload is None:
            return
        error = _validate_payload(payload)
        if error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": error})
            return
        action_id = int(path[len(prefix):])
        if not _update_action(action_id, payload):
            self._json(HTTPStatus.NOT_FOUND, {"error": "Registro no encontrado"})
            return
        self._json(HTTPStatus.OK, {"id": action_id})

    def do_DELETE(self) -> None:
        prefix = "/api/acciones/"
        path = urlparse(self.path).path
        if not path.startswith(prefix) or not path[len(prefix):].isdigit():
            self._json(HTTPStatus.NOT_FOUND, {"error": "Ruta no encontrada"})
            return
        action_id = int(path[len(prefix):])
        if not _delete_action(action_id):
            self._json(HTTPStatus.NOT_FOUND, {"error": "Registro no encontrado"})
            return
        self._json(HTTPStatus.OK, {"id": action_id})


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8091"))
    server = ThreadingHTTPServer((host, port), ActionsHandler)
    print(f"Acciones correctivas: http://{host}:{port}/")
    server.serve_forever()
