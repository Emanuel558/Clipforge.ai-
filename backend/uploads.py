"""Bounded, resumable transfers for the private Phase 1 workspace."""
import asyncio
from contextlib import contextmanager
import errno
import logging
import os
from pathlib import Path
import shutil
import threading
import time
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

CHUNK_BYTES = 4 * 1024 * 1024
IDLE_SECONDS = 90
CHUNK_SECONDS = 600
SESSION_SECONDS = 24 * 3600
DISK_RESERVE = 256 * 1024 * 1024
active = set()
active_lock = threading.Lock()
log = logging.getLogger(__name__)


class NewUpload(BaseModel):
    id: UUID
    filename: str = Field(min_length=1, max_length=240)
    size: int = Field(gt=0, strict=True)


@contextmanager
def exclusive(uid):
    with active_lock:
        if uid in active:
            raise HTTPException(409, 'This upload is busy. Wait a moment and resume.')
        active.add(uid)
    try:
        yield
    finally:
        with active_lock:
            active.discard(uid)


def folder(s, uid):
    return s.DATA / 'uploads' / uid


def disk_error(exc):
    log.warning('Upload storage error: %s', exc)
    if exc.errno in (errno.ENOSPC, errno.EDQUOT):
        return HTTPException(507, 'The workspace is out of disk space. Delete unused projects, then resume.')
    return HTTPException(503, 'The workspace could not save this upload. Resume after checking the server.')


def session(s, uid):
    uid = s.project_id(uid)
    found = s.rows('SELECT * FROM uploads WHERE id=?', (uid,))
    if not found:
        raise HTTPException(404, 'Upload session not found. Choose the file again to restart.')
    row = found[0]
    if row['updated'] < time.time() - SESSION_SECONDS:
        raise HTTPException(410, 'This upload expired after 24 hours. Choose the file again to restart.')
    row['chunk_bytes'] = CHUNK_BYTES
    return row


def cleanup(s):
    # Called at startup and session creation. An active request never expires underneath itself.
    for row in s.rows('SELECT * FROM uploads WHERE updated < ?', (time.time() - SESSION_SECONDS,)):
        uid = row['id']
        with active_lock:
            if uid in active:
                continue
            shutil.rmtree(folder(s, uid), ignore_errors=True)
            if not s.rows('SELECT id FROM projects WHERE id=?', (uid,)):
                shutil.rmtree(s.DATA / uid, ignore_errors=True)
            s.execute('DELETE FROM uploads WHERE id=?', (uid,))


def initialize(s):
    s.execute('''CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL,
        received INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'uploading',
        error TEXT, updated REAL NOT NULL)''')
    s.execute("UPDATE uploads SET status='failed', error='The server restarted during validation. Choose the file again.' WHERE status='validating'")
    cleanup(s)
    for row in s.rows("SELECT * FROM uploads WHERE status='uploading'"):
        part = folder(s, row['id']) / 'source.part'
        # A crash after fsync but before the DB receipt leaves unacknowledged bytes.
        if part.exists() and part.stat().st_size >= row['received']:
            with part.open('r+b') as file:
                file.truncate(row['received'])
        elif row['received']:
            s.execute("UPDATE uploads SET status='failed', error='Saved upload data is missing. Choose the file again.' WHERE id=?", (row['id'],))
    for row in s.rows("SELECT id FROM uploads WHERE status='failed'"):
        shutil.rmtree(folder(s, row['id']), ignore_errors=True)
        if not s.rows('SELECT id FROM projects WHERE id=?', (row['id'],)):
            shutil.rmtree(s.DATA / row['id'], ignore_errors=True)
    for chunk in (s.DATA / 'uploads').glob('*/chunk.tmp'):
        chunk.unlink(missing_ok=True)


async def receive_chunk(request, target, expected):
    count = 0
    deadline = time.monotonic() + CHUNK_SECONDS
    iterator = request.stream().__aiter__()
    try:
        with target.open('wb') as file:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                try:
                    block = await asyncio.wait_for(anext(iterator), min(IDLE_SECONDS, remaining))
                except StopAsyncIteration:
                    break
                count += len(block)
                if count > expected:
                    raise HTTPException(413, 'This chunk exceeds the expected upload size.')
                await run_in_threadpool(file.write, block)
        if count != expected:
            raise HTTPException(422, 'The chunk arrived incomplete. Resume to resend this chunk.')
    except TimeoutError:
        raise HTTPException(408, 'Upload stalled. Resume to resend the unfinished chunk.') from None
    except ClientDisconnect:
        raise HTTPException(408, 'Connection interrupted. Resume the upload.') from None
    except OSError as exc:
        raise disk_error(exc) from None


def append_chunk(s, uid, offset, chunk):
    destination = folder(s, uid) / 'source.part'
    try:
        with destination.open('a+b') as output:
            output.truncate(offset)
            with chunk.open('rb') as source:
                shutil.copyfileobj(source, output, length=256 * 1024)
            output.flush()
            os.fsync(output.fileno())
        s.execute('UPDATE uploads SET received=?, updated=?, error=NULL WHERE id=?',
                  (offset + chunk.stat().st_size, time.time(), uid))
    except BaseException:
        # Do not acknowledge partially appended bytes. A retry starts at the prior receipt.
        if destination.exists():
            with destination.open('r+b') as output:
                output.truncate(offset)
        raise


def finalize(s, uid):
    destination = s.DATA / uid
    try:
        row = session(s, uid)
        source = folder(s, uid) / 'source.part'
        duration, width, height, video, streams = s.inspect_media(source)
        needs_preview = video['codec_name'] != 'h264' or video.get('pix_fmt') != 'yuv420p' or any(
            stream['codec_type'] == 'audio' and stream['codec_name'] != 'aac' for stream in streams)
        destination.mkdir(parents=True, exist_ok=True)
        source.replace(destination / 'source.mp4')
        with s.db() as connection:
            connection.execute('INSERT INTO projects (id,name,duration,width,height,bytes,created,status,trim_end) VALUES (?,?,?,?,?,?,?,?,?)',
                               (uid, row['name'], duration, width, height, row['size'], time.time(), 'processing', duration))
            connection.execute("UPDATE uploads SET status='complete', updated=? WHERE id=?", (time.time(), uid))
        shutil.rmtree(folder(s, uid), ignore_errors=True)
    except Exception as exc:
        log.exception('Upload validation failed: %s', uid)
        if isinstance(exc, HTTPException):
            message = exc.detail
        elif isinstance(exc, OSError):
            message = disk_error(exc).detail
        else:
            message = 'Video validation failed. Check the server and choose the file again.'
        s.execute("UPDATE uploads SET status='failed', error=?, updated=? WHERE id=?", (message, time.time(), uid))
        shutil.rmtree(folder(s, uid), ignore_errors=True)
        if not s.rows('SELECT id FROM projects WHERE id=?', (uid,)):
            shutil.rmtree(destination, ignore_errors=True)
        return
    s.prepare_video(uid, needs_preview)


def install(app, s):
    @app.post('/api/uploads', status_code=201)
    def create_upload(body: NewUpload):
        uid = str(body.id)
        name = Path(body.filename.replace('\\', '/')).name
        if not name.lower().endswith('.mp4'):
            raise HTTPException(415, 'Choose an MP4 video.')
        if body.size > s.MAX_BYTES:
            raise HTTPException(413, 'The upload limit is 1 GB.')
        with s.job_lock:
            cleanup(s)
            existing = s.rows('SELECT * FROM uploads WHERE id=?', (uid,))
            if existing:
                if existing[0]['name'] != name or existing[0]['size'] != body.size:
                    raise HTTPException(409, 'This upload session belongs to a different file.')
                return session(s, uid)
            if len(s.rows("SELECT id FROM uploads WHERE status IN ('uploading','validating')")) >= 3:
                raise HTTPException(429, 'Three uploads are already active. Resume or discard an existing upload first.')
            if shutil.disk_usage(s.DATA).free < body.size * 2 + DISK_RESERVE:
                raise HTTPException(507, 'Not enough workspace disk space for this video and preview. Delete unused projects first.')
            try:
                folder(s, uid).mkdir(parents=True)
                s.execute('INSERT INTO uploads (id,name,size,updated) VALUES (?,?,?,?)', (uid, name, body.size, time.time()))
            except OSError as exc:
                shutil.rmtree(folder(s, uid), ignore_errors=True)
                raise disk_error(exc) from None
        return session(s, uid)

    @app.get('/api/uploads/{uid}')
    def upload_status(uid: str):
        return session(s, uid)

    @app.put('/api/uploads/{uid}', status_code=200)
    async def put_chunk(uid: str, request: Request, offset: int):
        uid = s.project_id(uid)
        with exclusive(uid):
            row = session(s, uid)
            if row['status'] != 'uploading':
                raise HTTPException(409, 'This upload is no longer accepting chunks.')
            if offset != row['received']:
                raise HTTPException(409, 'The saved offset changed. Resume from the server receipt.')
            expected = min(CHUNK_BYTES, row['size'] - offset)
            if expected <= 0:
                raise HTTPException(409, 'All bytes are saved. Finish the upload.')
            header = request.headers.get('content-length')
            if header is not None:
                try:
                    length = int(header)
                except ValueError:
                    raise HTTPException(400, 'Invalid upload length.') from None
                if length != expected:
                    raise HTTPException(422, 'The chunk length does not match the expected size.')
            chunk = folder(s, uid) / 'chunk.tmp'
            try:
                await receive_chunk(request, chunk, expected)
                await run_in_threadpool(append_chunk, s, uid, offset, chunk)
            except OSError as exc:
                raise disk_error(exc) from None
            finally:
                chunk.unlink(missing_ok=True)
            return session(s, uid)

    @app.post('/api/uploads/{uid}/complete', status_code=202)
    def complete_upload(uid: str):
        uid = s.project_id(uid)
        with exclusive(uid), s.job_lock:
            row = session(s, uid)
            if row['status'] in ('validating', 'complete', 'failed'):
                return row
            if row['received'] != row['size']:
                raise HTTPException(409, 'Upload is incomplete. Resume before finishing.')
            pending = len(s.rows("SELECT id FROM projects WHERE status='processing'")) + len(s.rows("SELECT id FROM uploads WHERE status='validating'"))
            if pending >= 3:
                raise HTTPException(429, 'Video preparation is busy. Resume shortly to finish this saved upload.')
            s.execute("UPDATE uploads SET status='validating', updated=? WHERE id=?", (time.time(), uid))
            s.pool.submit(finalize, s, uid)
            return session(s, uid)

    @app.delete('/api/uploads/{uid}', status_code=204)
    def discard_upload(uid: str):
        uid = s.project_id(uid)
        with exclusive(uid):
            row = session(s, uid)
            if row['status'] == 'validating':
                raise HTTPException(409, 'The video is being checked. Open the dashboard once preparation finishes.')
            shutil.rmtree(folder(s, uid), ignore_errors=True)
            s.execute('DELETE FROM uploads WHERE id=?', (uid,))
