"""Single-user Phase 1 API. Media jobs run outside HTTP request threads."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4
import json
import logging
import math
import os
import shutil
import sqlite3
import subprocess
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

log = logging.getLogger(__name__)
DATA = Path(os.environ.get('CLIPFORGE_DATA', 'data')).resolve()
MAX_BYTES = 1024 * 1024 * 1024
MAX_SECONDS = 1800
JOB_TIMEOUT = 3600
pool: ThreadPoolExecutor | None = None
job_lock = threading.Lock()


def db():
    connection = sqlite3.connect(DATA / 'projects.sqlite3', timeout=15)
    connection.row_factory = sqlite3.Row
    return connection


def execute(sql, args=()):
    with db() as connection:
        connection.execute(sql, args)


def rows(sql, args=()):
    with db() as connection:
        return [dict(row) for row in connection.execute(sql, args).fetchall()]


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.executescript('''
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, duration REAL NOT NULL,
            width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL,
            created REAL NOT NULL, status TEXT NOT NULL, error TEXT,
            trim_start REAL NOT NULL DEFAULT 0, trim_end REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS exports (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
            start REAL NOT NULL, end REAL NOT NULL, status TEXT NOT NULL,
            progress REAL NOT NULL DEFAULT 0, error TEXT, created REAL NOT NULL);
        ''')
        connection.execute("UPDATE exports SET status='failed', error='The server restarted. Please export again.' WHERE status IN ('queued','rendering')")
        connection.execute("UPDATE projects SET status='failed', error='The server restarted during preparation. Please upload again.' WHERE status='processing'")


@asynccontextmanager
async def lifespan(app):
    global pool
    for program in ('ffmpeg', 'ffprobe'):
        if not shutil.which(program):
            raise RuntimeError(f'{program} is missing. Follow README.md setup instructions.')
    init_db()
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='media')
    yield
    pool.shutdown(wait=True, cancel_futures=True)
    pool = None


app = FastAPI(title='ClipForge AI', lifespan=lifespan)


def project_id(value: str):
    try:
        return str(UUID(value))
    except ValueError:
        raise HTTPException(404, 'Project not found.') from None


def get_project(value: str):
    result = rows('SELECT * FROM projects WHERE id=?', (project_id(value),))
    if not result:
        raise HTTPException(404, 'Project not found.')
    return result[0]


def inspect_media(path):
    try:
        result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                                 '-show_format', '-show_streams', '-of', 'json', str(path)],
                                capture_output=True, text=True, timeout=30, check=True)
        info = json.loads(result.stdout)
        video = next(s for s in info['streams'] if s['codec_type'] == 'video'
                     and not s.get('disposition', {}).get('attached_pic'))
        duration = float(info['format']['duration'])
        if 'mp4' not in info['format']['format_name'].split(','):
            raise ValueError()
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError()
        if duration > MAX_SECONDS:
            raise HTTPException(413, 'Use a video shorter than 30 minutes for this version.')
        width, height = int(video['width']), int(video['height'])
        if width < 2 or height < 2 or max(width, height) > 4096:
            raise HTTPException(422, 'Use a video with dimensions up to 4096 pixels.')
        return duration, width, height, video, info['streams']
    except (subprocess.SubprocessError, ValueError, KeyError, StopIteration):
        raise HTTPException(422, 'This file is not a readable MP4 video. Try another MP4 file.') from None


def ffmpeg_args(source):
    return ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-protocol_whitelist', 'file,pipe', '-i', str(source)]


def encode_args():
    return ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c:v', 'libx264',
            '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-threads', '2']


def prepare_video(pid, needs_preview):
    folder = DATA / pid
    try:
        source = folder / 'source.mp4'
        if needs_preview:
            subprocess.run(ffmpeg_args(source) + encode_args() + [str(folder / 'preview.mp4')],
                           capture_output=True, check=True, timeout=JOB_TIMEOUT)
        subprocess.run(ffmpeg_args(source) + ['-frames:v', '1', '-vf', 'scale=640:-2',
                       '-threads', '1', str(folder / 'poster.jpg')],
                       capture_output=True, check=True, timeout=60)
        execute("UPDATE projects SET status='ready', error=NULL WHERE id=?", (pid,))
    except Exception:
        log.exception('Video preparation failed: %s', pid)
        execute("UPDATE projects SET status='failed', error=? WHERE id=?",
                ('Video preparation failed. Try a different MP4 or upload again.', pid))


def render_export(eid, pid, start, end):
    output = DATA / pid / f'{eid}.mp4'
    execute("UPDATE exports SET status='rendering' WHERE id=?", (eid,))
    command = ffmpeg_args(DATA / pid / 'source.mp4')
    command += ['-ss', str(start), '-t', str(end - start)] + encode_args()
    command += ['-progress', 'pipe:1', '-nostats', str(output)]
    try:
        # A watchdog bounds execution even while stdout has no progress lines.
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              text=True) as process:
            timer = threading.Timer(JOB_TIMEOUT, process.kill)
            timer.start()
            try:
                for line in process.stdout:
                    key, _, value = line.strip().partition('=')
                    if key == 'out_time_us':
                        try:
                            progress = min(99, max(0, float(value) / 1_000_000 / (end - start) * 100))
                            execute('UPDATE exports SET progress=? WHERE id=?', (progress, eid))
                        except ValueError:
                            pass
                if process.wait() != 0 or not output.exists() or output.stat().st_size == 0:
                    raise RuntimeError('FFmpeg failed')
            finally:
                timer.cancel()
        execute("UPDATE exports SET status='complete', progress=100 WHERE id=?", (eid,))
    except Exception:
        log.exception('Export failed: %s', eid)
        output.unlink(missing_ok=True)
        execute("UPDATE exports SET status='failed', error=? WHERE id=?",
                ('Export failed or exceeded the time limit. Retry with a shorter selection.', eid))


@app.get('/api/health')
def health():
    return {'status': 'ok', 'phase': 1}


@app.get('/api/projects')
def list_projects():
    return rows('SELECT * FROM projects ORDER BY created DESC')


@app.post('/api/projects', status_code=201)
async def upload(request: Request, filename: str = 'video.mp4'):
    name = Path(filename.replace('\\', '/')).name[:200]
    if not name.lower().endswith('.mp4'):
        raise HTTPException(415, 'Choose an MP4 video.')
    if int(request.headers.get('content-length', '0')) > MAX_BYTES:
        raise HTTPException(413, 'The upload limit is 1 GB.')
    pid = str(uuid4())
    folder = DATA / pid
    folder.mkdir(parents=True)
    size = 0
    try:
        with (folder / 'source.mp4').open('wb') as file:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, 'The upload limit is 1 GB.')
                await run_in_threadpool(file.write, chunk)
        duration, width, height, video, streams = await run_in_threadpool(inspect_media, folder / 'source.mp4')
        needs_preview = video['codec_name'] != 'h264' or video.get('pix_fmt') != 'yuv420p' or any(s['codec_type'] == 'audio' and s['codec_name'] != 'aac' for s in streams)
        with job_lock:
            pending = rows("SELECT id FROM projects WHERE status='processing'")
            if len(pending) >= 3:
                raise HTTPException(429, 'Several videos are preparing. Wait and upload again.')
            execute('INSERT INTO projects (id,name,duration,width,height,bytes,created,status,trim_end) VALUES (?,?,?,?,?,?,?,?,?)',
                    (pid, name, duration, width, height, size, time.time(), 'processing', duration))
            pool.submit(prepare_video, pid, needs_preview)
        return get_project(pid)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise


@app.get('/api/projects/{pid}')
def project(pid: str):
    return get_project(pid)


@app.get('/api/projects/{pid}/video')
def video(pid: str):
    item = get_project(pid)
    if item['status'] != 'ready':
        raise HTTPException(409, 'Video preparation is not complete.')
    folder = DATA / item['id']
    path = folder / 'preview.mp4'
    return FileResponse(path if path.exists() else folder / 'source.mp4', media_type='video/mp4')


@app.get('/api/projects/{pid}/poster')
def poster(pid: str):
    item = get_project(pid)
    path = DATA / item['id'] / 'poster.jpg'
    if not path.exists():
        raise HTTPException(404, 'Thumbnail is not ready.')
    return FileResponse(path, media_type='image/jpeg')


class Trim(BaseModel):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)


@app.get('/api/projects/{pid}/exports')
def exports(pid: str):
    item = get_project(pid)
    return rows('SELECT * FROM exports WHERE project_id=? ORDER BY created DESC', (item['id'],))


@app.post('/api/projects/{pid}/exports', status_code=202)
def create_export(pid: str, trim: Trim):
    item = get_project(pid)
    if item['status'] != 'ready':
        raise HTTPException(409, 'Wait for video preparation to finish.')
    if trim.start >= trim.end or trim.end > item['duration'] + 0.001:
        raise HTTPException(422, 'Start must be before end, and both times must stay inside the video.')
    pid = item['id']
    eid = str(uuid4())
    with job_lock:
        if rows("SELECT id FROM exports WHERE project_id=? AND status IN ('queued','rendering')", (pid,)):
            raise HTTPException(409, 'An export is already running for this project.')
        if len(rows("SELECT id FROM exports WHERE status IN ('queued','rendering')")) >= 4:
            raise HTTPException(429, 'The export queue is full. Try again shortly.')
        execute('UPDATE projects SET trim_start=?, trim_end=? WHERE id=?', (trim.start, trim.end, pid))
        execute('INSERT INTO exports (id,project_id,start,end,status,created) VALUES (?,?,?,?,?,?)',
                (eid, pid, trim.start, trim.end, 'queued', time.time()))
        pool.submit(render_export, eid, pid, trim.start, trim.end)
    return rows('SELECT * FROM exports WHERE id=?', (eid,))[0]


@app.get('/api/projects/{pid}/exports/{eid}/download')
def download(pid: str, eid: str):
    item = get_project(pid)
    found = rows('SELECT * FROM exports WHERE id=? AND project_id=?', (project_id(eid), item['id']))
    if not found:
        raise HTTPException(404, 'Export not found.')
    if found[0]['status'] != 'complete':
        raise HTTPException(409, 'The export is not ready to download.')
    path = DATA / item['id'] / f"{found[0]['id']}.mp4"
    if not path.exists():
        raise HTTPException(404, 'The exported file is missing. Please export again.')
    return FileResponse(path, media_type='video/mp4', filename=f'clipforge-{eid[:8]}.mp4')


@app.delete('/api/projects/{pid}', status_code=204)
def delete_project(pid: str):
    with job_lock:
        item = get_project(pid)
        if item['status'] == 'processing' or rows("SELECT id FROM exports WHERE project_id=? AND status IN ('queued','rendering')", (pid,)):
            raise HTTPException(409, 'Wait for processing to finish before deleting.')
        shutil.rmtree(DATA / item['id'], ignore_errors=True)
        with db() as connection:
            connection.execute('DELETE FROM exports WHERE project_id=?', (pid,))
            connection.execute('DELETE FROM projects WHERE id=?', (pid,))


# Production-style local serving: npm run build, then start only FastAPI.
frontend_dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if frontend_dist.exists():
    app.mount('/', StaticFiles(directory=frontend_dist, html=True), name='frontend')
