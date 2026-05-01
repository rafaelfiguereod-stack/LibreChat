"""
Minimal LibreChat RAG API service.

Implements the endpoints LibreChat expects:
  GET  /health     - liveness check
  POST /embed      - embed a file into the vector store
  POST /text       - parse/embed raw text
  DELETE /documents - remove documents from the vector store
"""

import os
import io
import uuid
import logging
from contextlib import asynccontextmanager

import psycopg2
from pgvector.psycopg2 import register_vector
import numpy as np

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("POSTGRES_DB", "mydatabase")
DB_USER = os.getenv("POSTGRES_USER", "myuser")
DB_PASS = os.getenv("POSTGRES_PASSWORD", "mypassword")
VECTOR_DIM = 384  # dimension for stub embeddings


def get_conn():
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT,
        dbname=DB_NAME, user=DB_USER, password=DB_PASS,
    )
    register_vector(conn)
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id UUID PRIMARY KEY,
            file_id TEXT,
            user_id TEXT,
            content TEXT,
            embedding vector(%d)
        )
    """ % VECTOR_DIM)
    conn.commit()
    cur.close()
    conn.close()
    logger.info("Database initialized.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
    except Exception as e:
        logger.warning(f"DB init failed (will retry on first request): {e}")
    yield


app = FastAPI(title="LibreChat RAG API", lifespan=lifespan)


def stub_embed(text: str) -> np.ndarray:
    """Deterministic stub embedding — not semantically meaningful."""
    rng = np.random.default_rng(abs(hash(text)) % (2**31))
    vec = rng.standard_normal(VECTOR_DIM).astype(np.float32)
    return vec / (np.linalg.norm(vec) + 1e-9)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/embed")
async def embed(
    file: UploadFile = File(...),
    file_id: str = Form(...),
    user_id: str = Form(None),
):
    content = (await file.read()).decode("utf-8", errors="replace")
    embedding = stub_embed(content)

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO documents (id, file_id, user_id, content, embedding) VALUES (%s, %s, %s, %s, %s)",
            (str(uuid.uuid4()), file_id, user_id, content[:4096], embedding.tolist()),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"DB insert failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": "File embedded successfully", "file_id": file_id}


@app.post("/text")
async def embed_text(
    text: str = Form(...),
    file_id: str = Form(...),
    user_id: str = Form(None),
):
    embedding = stub_embed(text)

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO documents (id, file_id, user_id, content, embedding) VALUES (%s, %s, %s, %s, %s)",
            (str(uuid.uuid4()), file_id, user_id, text[:4096], embedding.tolist()),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"DB insert failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": "Text embedded successfully", "file_id": file_id}


@app.delete("/documents")
async def delete_documents(file_ids: list[str] | None = None):
    if not file_ids:
        return {"message": "No file_ids provided"}

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM documents WHERE file_id = ANY(%s)", (file_ids,))
        deleted = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"DB delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": f"Deleted {deleted} document(s)"}
