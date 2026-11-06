"""Resumption, bounded chunks and predictable errors, with real media validation."""
import asyncio
import errno
import os
from pathlib import Path
import shutil
import subprocess
import time
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from backend import app as server
from backend import uploads
from .test_workflow import client, sample, wait_until


def create(client, size, uid=None):
    return client.post('/api/uploads', json={'id': uid or str(uuid4()), 'filename': 'test.mp4', 'size': size})


def put(client, uid, offset, content):
    return client.put(f'/api/uploads/{uid}?offset={offset}', content=content)


def test_resume_duplicate_receipt_finalize_and_export(client, sample, monkeypatch):
    content = sample.read_bytes()
    monkeypatch.setattr(uploads, 'CHUNK_BYTES', 4096)
    created = create(client, len(content)).json()
    uid = created['id']
    first = put(client, uid, 0, content[:4096])
    assert first.status_code == 200 and first.json()['received'] == 4096
    # The sender lost its receipt. Replaying must never append duplicate bytes.
    assert put(client, uid, 0, content[:4096]).status_code == 409
    assert client.get(f'/api/uploads/{uid}').json()['received'] == 4096
    assert create(client, len(content), uid).json()['received'] == 4096
    assert client.post(f'/api/uploads/{uid}/complete').status_code == 409
    # Restart recovery preserves confirmed bytes and truncates an uncommitted append.
    part = uploads.folder(server, uid) / 'source.part'
    with part.open('ab') as file:
        file.write(b'unacknowledged')
    uploads.initialize(server)
    assert part.stat().st_size == 4096
    for offset in range(4096, len(content), 4096):
        assert put(client, uid, offset, content[offset:offset+4096]).status_code == 200
    response = client.post(f'/api/uploads/{uid}/complete')
    assert response.status_code == 202
    wait_until(lambda: client.get(f'/api/uploads/{uid}').json(), 'complete')
    wait_until(lambda: client.get(f'/api/projects/{uid}').json())
    assert (server.DATA / uid / 'source.mp4').read_bytes() == content
    # Finalization is idempotent and creates exactly one project.
    assert client.post(f'/api/uploads/{uid}/complete').status_code == 202
    assert len(client.get('/api/projects').json()) == 1
    result = client.post(f'/api/projects/{uid}/exports', json={'start': 1, 'end': 3})
    assert result.status_code == 202
    wait_until(lambda: client.get(f'/api/projects/{uid}/exports').json()[0], 'complete')


def test_chunk_size_offset_and_length_limits(client, monkeypatch):
    monkeypatch.setattr(uploads, 'CHUNK_BYTES', 4)
    uid = create(client, 10).json()['id']
    assert put(client, uid, -1, b'abcd').status_code == 409
    assert put(client, uid, 0, b'abcde').status_code == 422
    assert put(client, uid, 0, b'ab').status_code == 422
    assert put(client, uid, 0, b'abcd').json()['received'] == 4
    assert put(client, uid, 4, b'efgh').json()['received'] == 8
    assert put(client, uid, 8, b'ij').json()['received'] == 10
    assert put(client, uid, 10, b'').status_code == 409
    assert client.get(f'/api/uploads/{uid}').json()['received'] == 10


def test_validation_failure_has_readable_status_and_cleans_files(client):
    uid = create(client, 4).json()['id']
    assert put(client, uid, 0, b'nope').status_code == 200
    assert client.post(f'/api/uploads/{uid}/complete').status_code == 202
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        status = client.get(f'/api/uploads/{uid}').json()
        if status['status'] == 'failed':
            break
        time.sleep(.05)
    assert status['status'] == 'failed' and 'MP4' in status['error']
    assert not uploads.folder(server, uid).exists()
    assert client.get('/api/projects').json() == []
    assert client.delete(f'/api/uploads/{uid}').status_code == 204


def test_disk_space_capacity_expiry_and_discard(client, monkeypatch):
    real_usage = shutil.disk_usage
    monkeypatch.setattr(uploads.shutil, 'disk_usage', lambda _: shutil._ntuple_diskusage(100, 99, 1))
    assert create(client, 100).status_code == 507
    monkeypatch.setattr(uploads.shutil, 'disk_usage', real_usage)
    uid = create(client, 4).json()['id']
    assert put(client, uid, 0, b'data').status_code == 200
    assert client.delete(f'/api/uploads/{uid}').status_code == 204
    assert not uploads.folder(server, uid).exists()
    uid = create(client, 4).json()['id']
    server.execute('UPDATE uploads SET updated=0 WHERE id=?', (uid,))
    assert client.get(f'/api/uploads/{uid}').status_code == 410
    uploads.cleanup(server)
    assert not uploads.folder(server, uid).exists()
    assert client.get(f'/api/uploads/{uid}').status_code == 404
    for _ in range(3):
        assert create(client, 4).status_code == 201
    assert create(client, 4).status_code == 429


def test_storage_failure_does_not_advance_receipt(client, monkeypatch):
    uid = create(client, 4).json()['id']
    def fail(*args):
        raise OSError(errno.ENOSPC, 'disk full')
    monkeypatch.setattr(uploads.os, 'fsync', fail)
    assert put(client, uid, 0, b'data').status_code == 507
    assert client.get(f'/api/uploads/{uid}').json()['received'] == 0
    assert (uploads.folder(server, uid) / 'source.part').stat().st_size == 0
    assert not (uploads.folder(server, uid) / 'chunk.tmp').exists()


def test_concurrent_chunk_is_rejected_without_corruption(client):
    uid = create(client, 4).json()['id']
    with uploads.exclusive(uid):
        assert put(client, uid, 0, b'data').status_code == 409
        assert client.post(f'/api/uploads/{uid}/complete').status_code == 409
        assert client.delete(f'/api/uploads/{uid}').status_code == 409
    assert put(client, uid, 0, b'data').json()['received'] == 4


def test_stream_disconnect_idle_and_overflow(tmp_path, monkeypatch):
    async def run(events, delay=0, expected=4):
        async def receive():
            if delay:
                await asyncio.sleep(delay)
            return events.pop(0)
        request = Request({'type': 'http', 'method': 'PUT', 'path': '/', 'headers': []}, receive)
        with pytest.raises(HTTPException) as caught:
            await uploads.receive_chunk(request, tmp_path / 'chunk', expected)
        return caught.value.status_code
    assert asyncio.run(run([{'type': 'http.request', 'body': b'ab', 'more_body': True}, {'type': 'http.disconnect'}])) == 408
    assert asyncio.run(run([{'type': 'http.request', 'body': b'ab', 'more_body': False}])) == 422
    assert asyncio.run(run([{'type': 'http.request', 'body': b'abcde', 'more_body': False}])) == 413
    monkeypatch.setattr(uploads, 'IDLE_SECONDS', .01)
    assert asyncio.run(run([], delay=.1)) == 408


def test_bad_metadata_restart_and_inspection_timeout(client, monkeypatch):
    assert create(client, server.MAX_BYTES + 1).status_code == 413
    assert create(client, 0).status_code == 422
    uid = create(client, 4).json()['id']
    assert create(client, 5, uid).status_code == 409
    server.execute("UPDATE uploads SET status='validating' WHERE id=?", (uid,))
    uploads.initialize(server)
    assert client.get(f'/api/uploads/{uid}').json()['status'] == 'failed'
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('ffprobe', 30)
    monkeypatch.setattr(server.subprocess, 'run', timeout)
    with pytest.raises(HTTPException) as caught:
        server.inspect_media(Path('unused'))
    assert caught.value.status_code == 504


@pytest.mark.skipif(os.environ.get('CLIPFORGE_LARGE_TEST') != '1', reason='Opt-in 676 MiB transfer test')
def test_676_mib_25m51s_transfer(client, tmp_path):
    """Real byte volume and source duration, without retaining user footage."""
    path = tmp_path / 'long.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                    'color=c=blue:s=160x90:r=1:d=1551', '-f', 'lavfi', '-i',
                    'anullsrc=r=16000:cl=mono', '-t', '1551', '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-threads', '1', str(path)], check=True)
    total = 676 * 1024 * 1024
    # An MP4 free box adds valid padding without manufacturing complex footage.
    with path.open('ab') as file:
        padding = total - file.tell()
        file.write(padding.to_bytes(4, 'big') + b'free')
        file.truncate(total)
    uid = create(client, total).json()['id']
    with path.open('rb') as source:
        offset = 0
        while chunk := source.read(uploads.CHUNK_BYTES):
            response = put(client, uid, offset, chunk)
            assert response.status_code == 200, response.text
            offset += len(chunk)
            assert response.json()['received'] == offset
    assert client.post(f'/api/uploads/{uid}/complete').status_code == 202
    item = wait_until(lambda: client.get(f'/api/projects/{uid}').json() if client.get(f'/api/projects/{uid}').status_code == 200 else {'status': 'processing'})
    assert item['bytes'] == total and abs(item['duration'] - 1551) < .1
    assert (server.DATA / uid / 'source.mp4').stat().st_size == total


def test_completion_returns_before_validation_and_is_idempotent(client, monkeypatch):
    uid = create(client, 4).json()['id']
    assert put(client, uid, 0, b'data').status_code == 200
    submitted = []
    monkeypatch.setattr(server.pool, 'submit', lambda *args: submitted.append(args))
    assert client.post(f'/api/uploads/{uid}/complete').json()['status'] == 'validating'
    assert client.post(f'/api/uploads/{uid}/complete').json()['status'] == 'validating'
    assert len(submitted) == 1
    assert client.get('/api/projects').json() == []
    assert client.delete(f'/api/uploads/{uid}').status_code == 409


def test_total_chunk_deadline_even_with_incoming_data(tmp_path, monkeypatch):
    monkeypatch.setattr(uploads, 'IDLE_SECONDS', 1)
    monkeypatch.setattr(uploads, 'CHUNK_SECONDS', .01)
    async def run():
        async def receive():
            await asyncio.sleep(.006)
            return {'type': 'http.request', 'body': b'a', 'more_body': True}
        request = Request({'type': 'http', 'method': 'PUT', 'path': '/', 'headers': []}, receive)
        with pytest.raises(HTTPException) as caught:
            await uploads.receive_chunk(request, tmp_path / 'chunk', 4)
        assert caught.value.status_code == 408
    asyncio.run(run())
