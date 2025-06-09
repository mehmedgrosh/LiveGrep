# main.py
import os
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def read_root():
    return HTMLResponse(open("static/index.html").read())


@app.get("/search")
async def search_files(path: str, pattern: str, limit: int = 50):
    if not os.path.isabs(path) or not os.path.exists(path):
        return JSONResponse(
            status_code=400,
            content={"error": "Invalid directory path", "results": [], "limited": False}
        )

    try:
        # Base command for ag
        cmd = [
            "ag",
            "--numbers",
            "--nogroup",
            "--nocolor",
            "--smart-case",
            pattern
        ]

        # Start the process
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        # Read output line by line with limit
        results = []
        count = 0
        while limit <= 0 or count < limit:
            line = await proc.stdout.readline()
            if not line:
                break
            results.append(line.decode().strip())
            count += 1

        # Check if we have more results than the limit
        limited = False
        if limit > 0 and count == limit:
            # Check if there might be more results
            line = await proc.stdout.readline()
            if line:
                limited = True

        # Terminate the process if it's still running
        if proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.sleep(0.1)
                if proc.returncode is None:
                    proc.kill()
            except:
                pass
            await proc.wait()

        return {
            "results": results,
            "limited": limited
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "results": [], "limited": False}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
