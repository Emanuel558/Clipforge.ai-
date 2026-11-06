"""Real FFmpeg integration checks. No AI services or credentials required."""
from pathlib import Path
import json
import subprocess
import time

import pytest
from fastapi.testclient import TestClient
from backend import app as server


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, 'DATA', tmp_path / 'data')
    with TestClient(server.app) as connection:
        yield connection


@pytest.fixture(scope='session')
def sample(tmp_path_factory):
    folder = tmp_path_factory.mktemp('media')
    path = folder / 'sample.mp4'
    # A visible scene change at 2s makes trim accuracy testable.
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                    'color=c=red:s=320x180:r=25:d=2', '-f', 'lavfi', '-i',
                    'color=c=blue:s=320x180:r=25:d=2', '-f', 'lavfi', '-i',
                    'sine=frequency=440:sample_rate=48000:duration=4',
                    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
                    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt',
                    'yuv420p', '-c:a', 'aac', '-threads', '1', str(path)], check=True)
    return path


def wait_until(fetch, status='ready'):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        value = fetch()
        if value['status'] == status:
            return value
        if value['status'] == 'failed':
            pytest.fail(str(value))
        time.sleep(0.05)
    pytest.fail(f'Timed out waiting for {status}')


def upload(client, path):
    response = client.post('/api/projects?filename=sample.mp4', content=path.read_bytes())
    assert response.status_code == 201, response.text
    item = response.json()
    return wait_until(lambda: client.get(f"/api/projects/{item['id']}").json())


def inspect(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format',
                                               '-show_streams', '-of', 'json', str(path)]))


def pixel_at(path, second):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(second), '-i', str(path),
                                   '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo',
                                   '-pix_fmt', 'rgb24', '-threads', '1', 'pipe:1'])
    return tuple(raw[:3])


def test_upload_trim_export_range_download_and_delete(client, sample, tmp_path):
    item = upload(client, sample)
    pid = item['id']
    assert client.get('/api/projects').json()[0]['name'] == 'sample.mp4'
    assert client.get(f'/api/projects/{pid}/poster').headers['content-type'] == 'image/jpeg'
    ranged = client.get(f'/api/projects/{pid}/video', headers={'Range': 'bytes=0-99'})
    assert ranged.status_code == 206
    assert len(ranged.content) == 100
    response = client.post(f'/api/projects/{pid}/exports', json={'start': 1, 'end': 3})
    assert response.status_code == 202
    eid = response.json()['id']
    finished = wait_until(lambda: client.get(f'/api/projects/{pid}/exports').json()[0], 'complete')
    assert finished['progress'] == 100
    result = client.get(f'/api/projects/{pid}/exports/{eid}/download')
    assert result.status_code == 200
    assert 'attachment' in result.headers['content-disposition']
    output = tmp_path / 'download.mp4'
    output.write_bytes(result.content)
    media = inspect(output)
    assert abs(float(media['format']['duration']) - 2) < 0.15
    video = next(stream for stream in media['streams'] if stream['codec_type'] == 'video')
    audio = next(stream for stream in media['streams'] if stream['codec_type'] == 'audio')
    assert video['codec_name'] == 'h264'
    assert audio['codec_name'] == 'aac'
    assert abs(float(video['duration']) - float(audio['duration'])) < 0.12
    red = pixel_at(output, 0.1)
    blue = pixel_at(output, 1.5)
    assert red[0] > 180 and red[2] < 50
    assert blue[2] > 180 and blue[0] < 50
    saved = client.get(f'/api/projects/{pid}').json()
    assert saved['trim_start'] == 1 and saved['trim_end'] == 3
    assert client.delete(f'/api/projects/{pid}').status_code == 204
    assert client.get('/api/projects').json() == []
    assert not (server.DATA / pid).exists()


@pytest.mark.parametrize('trim', [{'start': -1, 'end': 2}, {'start': 3, 'end': 1},
                                 {'start': 0, 'end': 999}, {'start': 1, 'end': 1},
                                 {'start': 'NaN', 'end': 2}])
def test_invalid_trim(client, sample, trim):
    item = upload(client, sample)
    assert client.post(f"/api/projects/{item['id']}/exports", json=trim).status_code == 422


def test_invalid_upload_and_unknown_paths(client, monkeypatch):
    assert client.post('/api/projects?filename=movie.txt', content=b'x').status_code == 415
    assert client.post('/api/projects?filename=movie.mp4', content=b'not a video').status_code == 422
    assert client.post('/api/projects?filename=movie.mp4', content=b'').status_code == 422
    monkeypatch.setattr(server, 'MAX_BYTES', 3)
    assert client.post('/api/projects?filename=movie.mp4', content=b'four').status_code == 413
    assert client.get('/api/projects/invalid').status_code == 404
    assert client.get('/api/projects/00000000-0000-0000-0000-000000000000').status_code == 404
    assert client.get('/api/projects').json() == []
    assert not list(server.DATA.glob('*/source.mp4'))


def test_failed_export_then_retry(client, sample, monkeypatch):
    item = upload(client, sample)
    pid = item['id']
    original = server.ffmpeg_args
    monkeypatch.setattr(server, 'ffmpeg_args', lambda _: ['false'])
    result = client.post(f'/api/projects/{pid}/exports', json={'start': 0, 'end': 1}).json()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        failed = client.get(f'/api/projects/{pid}/exports').json()[0]
        if failed['status'] == 'failed':
            break
        time.sleep(.05)
    assert failed['status'] == 'failed' and failed['error']
    assert client.get(f"/api/projects/{pid}/exports/{result['id']}/download").status_code == 409
    monkeypatch.setattr(server, 'ffmpeg_args', original)
    assert client.post(f'/api/projects/{pid}/exports', json={'start': 0, 'end': 1}).status_code == 202
    wait_until(lambda: client.get(f'/api/projects/{pid}/exports').json()[0], 'complete')


def test_restart_recovery(client, sample):
    item = upload(client, sample)
    server.execute("INSERT INTO exports (id,project_id,start,end,status,created) VALUES ('interrupted',?,0,1,'rendering',0)", (item['id'],))
    server.init_db()
    failed = client.get(f"/api/projects/{item['id']}/exports").json()[0]
    assert failed['status'] == 'failed'
    assert 'restarted' in failed['error']
    assert client.get(f"/api/projects/{item['id']}").json()['status'] == 'ready'


def test_silent_video_and_preview_conversion(client, tmp_path):
    path = tmp_path / 'mpeg4.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                    'testsrc2=size=320x180:rate=25:duration=1', '-c:v', 'mpeg4', str(path)], check=True)
    item = upload(client, path)
    assert (server.DATA / item['id'] / 'preview.mp4').exists()
    result = client.post(f"/api/projects/{item['id']}/exports", json={'start': .1, 'end': .9})
    assert result.status_code == 202
    wait_until(lambda: client.get(f"/api/projects/{item['id']}/exports").json()[0], 'complete')
