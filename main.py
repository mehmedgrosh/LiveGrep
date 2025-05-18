# main.py (Backend)
import os
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def read_root():
    return HTMLResponse(open("static/index.html").read())


@app.get("/search")
async def search_files(path: str, pattern: str):
    if not os.path.isabs(path) or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="Invalid directory path")

    try:
        proc = await asyncio.create_subprocess_exec(
            "ag",
            "--numbers",      # Show line numbers
            "--nogroup",      # Show individual matches
            "--nocolor",      # Disable color output
            "--smart-case",
            pattern,
            cwd=path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            # Split lines and filter empty results
            results = [line.decode().strip() for line in stdout.splitlines() if line]
            return {"results": results}
        return {"results": []}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
