from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "flashcards.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".txt"}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2 MB

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sets (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                name TEXT NOT NULL,
                                                stored_filename TEXT NOT NULL,
                                                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cards (
                                                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                 set_id INTEGER NOT NULL,
                                                 polish TEXT NOT NULL,
                                                 english TEXT NOT NULL,
                                                 FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
                );

            CREATE TABLE IF NOT EXISTS sessions (
                                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                    set_id INTEGER NOT NULL,
                                                    direction TEXT NOT NULL,
                                                    mode TEXT NOT NULL DEFAULT 'all',
                                                    started_at TEXT NOT NULL,
                                                    finished_at TEXT NOT NULL,
                                                    total INTEGER NOT NULL,
                                                    correct INTEGER NOT NULL,
                                                    incorrect INTEGER NOT NULL,
                                                    FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
                );

            CREATE TABLE IF NOT EXISTS session_answers (
                                                           id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                           session_id INTEGER NOT NULL,
                                                           card_id INTEGER NOT NULL,
                                                           is_correct INTEGER NOT NULL,
                                                           FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
                );
            """
        )


# Ważne dla Render/Gunicorn:
# gunicorn uruchamia aplikację jako app:app, więc blok __main__ się nie wykona.
init_db()


def parse_txt(content: str):
    cards = []
    errors = []

    for line_no, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        if "-->" not in line:
            errors.append(f"Linia {line_no}: brak separatora '-->'")
            continue

        polish, english = line.split("-->", 1)
        polish = polish.strip()
        english = english.strip()

        if not polish or not english:
            errors.append(f"Linia {line_no}: pusta definicja lub odpowiedź")
            continue

        cards.append({"polish": polish, "english": english})

    return cards, errors


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/sets")
def list_sets():
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                s.id,
                s.name,
                s.created_at,
                COUNT(DISTINCT c.id) AS card_count,
                COALESCE(MAX(se.finished_at), '') AS last_studied
            FROM sets s
                     LEFT JOIN cards c ON c.set_id = s.id
                     LEFT JOIN sessions se ON se.set_id = s.id
            GROUP BY s.id
            ORDER BY s.created_at DESC
            """
        ).fetchall()

    return jsonify([dict(row) for row in rows])


@app.get("/api/sets/<int:set_id>")
def get_set(set_id: int):
    with get_db() as conn:
        set_row = conn.execute(
            "SELECT id, name, created_at FROM sets WHERE id = ?",
            (set_id,),
        ).fetchone()

        if not set_row:
            return jsonify({"error": "Nie znaleziono zestawu."}), 404

        cards = conn.execute(
            """
            SELECT id, polish, english
            FROM cards
            WHERE set_id = ?
            ORDER BY id
            """,
            (set_id,),
        ).fetchall()

    return jsonify(
        {
            "set": dict(set_row),
            "cards": [dict(card) for card in cards],
        }
    )


@app.post("/api/upload")
def upload():
    if "file" not in request.files:
        return jsonify({"error": "Nie wybrano pliku."}), 400

    file = request.files["file"]
    if not file or not file.filename:
        return jsonify({"error": "Nie wybrano pliku."}), 400

    original_name = file.filename
    suffix = Path(original_name).suffix.lower()

    if suffix not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Obsługiwane są tylko pliki .txt."}), 400

    raw = file.read()

    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            content = raw.decode("cp1250")
        except UnicodeDecodeError:
            return jsonify(
                {
                    "error": (
                        "Nie udało się odczytać kodowania pliku. "
                        "Zapisz go jako UTF-8."
                    )
                }
            ), 400

    cards, errors = parse_txt(content)

    if not cards:
        return jsonify(
            {
                "error": "Nie znaleziono żadnych poprawnych fiszek.",
                "details": errors[:10],
            }
        ), 400

    now = datetime.now()
    created_at = now.isoformat(timespec="seconds")
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    safe_name = secure_filename(original_name) or "slownik.txt"
    stored_filename = f"{timestamp}_{safe_name}"
    stored_path = UPLOAD_DIR / stored_filename

    try:
        stored_path.write_bytes(raw)
    except OSError:
        stored_filename = ""

    with get_db() as conn:
        cursor = conn.execute(
            """
            INSERT INTO sets (name, stored_filename, created_at)
            VALUES (?, ?, ?)
            """,
            (original_name, stored_filename, created_at),
        )
        set_id = cursor.lastrowid

        conn.executemany(
            """
            INSERT INTO cards (set_id, polish, english)
            VALUES (?, ?, ?)
            """,
            [(set_id, card["polish"], card["english"]) for card in cards],
        )

    return jsonify(
        {
            "set_id": set_id,
            "name": original_name,
            "card_count": len(cards),
            "warnings": errors[:10],
        }
    )


@app.post("/api/sessions")
def save_session():
    data = request.get_json(silent=True) or {}

    try:
        set_id = int(data["set_id"])
        direction = str(data["direction"])
        mode = str(data.get("mode", "all"))
        started_at = str(data["started_at"])
        answers = list(data["answers"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Nieprawidłowe dane sesji."}), 400

    if direction not in {"pl-en", "en-pl"}:
        return jsonify({"error": "Nieprawidłowy kierunek nauki."}), 400

    if mode not in {"all", "mistakes"}:
        mode = "all"

    cleaned_answers = []
    correct = 0
    incorrect = 0

    for item in answers:
        try:
            card_id = int(item["card_id"])
            is_correct = bool(item["is_correct"])
        except (KeyError, TypeError, ValueError):
            continue

        cleaned_answers.append((card_id, 1 if is_correct else 0))

        if is_correct:
            correct += 1
        else:
            incorrect += 1

    if not cleaned_answers:
        return jsonify({"error": "Sesja nie zawiera odpowiedzi."}), 400

    finished_at = datetime.now().isoformat(timespec="seconds")
    total = len(cleaned_answers)

    with get_db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM sets WHERE id = ?",
            (set_id,),
        ).fetchone()

        if not exists:
            return jsonify({"error": "Nie znaleziono zestawu."}), 404

        cursor = conn.execute(
            """
            INSERT INTO sessions (
                set_id, direction, mode, started_at, finished_at,
                total, correct, incorrect
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                set_id,
                direction,
                mode,
                started_at,
                finished_at,
                total,
                correct,
                incorrect,
            ),
        )
        session_id = cursor.lastrowid

        conn.executemany(
            """
            INSERT INTO session_answers (session_id, card_id, is_correct)
            VALUES (?, ?, ?)
            """,
            [
                (session_id, card_id, is_correct)
                for card_id, is_correct in cleaned_answers
            ],
        )

    return jsonify(
        {
            "session_id": session_id,
            "total": total,
            "correct": correct,
            "incorrect": incorrect,
        }
    )


@app.get("/api/history/<int:set_id>")
def get_history(set_id: int):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                direction,
                mode,
                started_at,
                finished_at,
                total,
                correct,
                incorrect
            FROM sessions
            WHERE set_id = ?
            ORDER BY finished_at DESC
                LIMIT 20
            """,
            (set_id,),
        ).fetchall()

    return jsonify([dict(row) for row in rows])


@app.delete("/api/sets/<int:set_id>")
def delete_set(set_id: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT stored_filename FROM sets WHERE id = ?",
            (set_id,),
        ).fetchone()

        if not row:
            return jsonify({"error": "Nie znaleziono zestawu."}), 404

        conn.execute("DELETE FROM sets WHERE id = ?", (set_id,))

    stored_filename = row["stored_filename"]
    if stored_filename:
        stored_path = UPLOAD_DIR / stored_filename
        try:
            if stored_path.exists():
                stored_path.unlink()
        except OSError:
            pass

    return jsonify({"ok": True})


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.errorhandler(413)
def too_large(_error):
    return jsonify(
        {"error": "Plik jest za duży. Maksymalny rozmiar to 2 MB."}
    ), 413


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
