# main.py (Backend)
import os
import asyncio
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def read_root():
    return HTMLResponse(open("static/index.html").read())


@app.get("/search")
async def search_files(
    path: str,
    pattern: str,
    limit: Optional[int] = Query(10, description="Max results to return, 0 for unlimited")
):
    if not os.path.isabs(path) or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="Invalid directory path")

    try:
        ag_args = [
            "ag",
            "--numbers",
            "--nogroup",
            "--nocolor",
            "--smart-case",
        ]
        if limit and limit > 0:
            ag_args += [f"--max-count={limit}"]
        ag_args.append(pattern)

        proc = await asyncio.create_subprocess_exec(
            *ag_args,
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
