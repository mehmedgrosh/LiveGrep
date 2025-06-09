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

@app.get("/file-content")
async def get_file_content(file_path: str, line_number: int, context_lines: int = 10, base_path: str = None):
    """Get file content with context around a specific line number"""
    try:
        # If file_path is relative and we have a base_path, make it absolute
        if base_path and not os.path.isabs(file_path):
            full_path = os.path.join(base_path, file_path)
        else:
            full_path = file_path
        
        # Normalize the path to handle any .. or . components
        full_path = os.path.normpath(full_path)
        
        # Security check - ensure the file exists
        if not os.path.exists(full_path):
            return JSONResponse(
                status_code=400,
                content={"error": f"File not found: {full_path}"}
            )
        
        # Check if it's a regular file
        if not os.path.isfile(full_path):
            return JSONResponse(
                status_code=400,
                content={"error": "Path is not a file"}
            )
        
        # Determine file type based on extension
        file_extension = os.path.splitext(full_path)[1].lower()
        file_type = "text"
        
        if file_extension in ['.c']:
            file_type = "c"
        elif file_extension in ['.h', '.hpp']:
            file_type = "c"  # Use C highlighting for header files
        elif file_extension in ['.cpp', '.cc', '.cxx']:
            file_type = "cpp"
        elif file_extension in ['.py']:
            file_type = "python"
        elif file_extension in ['.js', '.jsx']:
            file_type = "javascript"
        elif file_extension in ['.md', '.markdown']:
            file_type = "markdown"
        elif file_extension in ['.html', '.htm']:
            file_type = "html"
        elif file_extension in ['.css']:
            file_type = "css"
        elif file_extension in ['.json']:
            file_type = "json"
        
        # Read the file
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        
        # Calculate context range
        total_lines = len(lines)
        start_line = max(1, line_number - context_lines)
        end_line = min(total_lines, line_number + context_lines)
        
        # Extract context lines
        context = []
        for i in range(start_line - 1, end_line):
            if i < len(lines):  # Make sure we don't go out of bounds
                context.append({
                    "line_number": i + 1,
                    "content": lines[i].rstrip('\n\r'),
                    "is_match": i + 1 == line_number
                })
        
        return {
            "file_path": file_path,
            "file_type": file_type,
            "target_line": line_number,
            "total_lines": total_lines,
            "context": context
        }
        
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Error reading file: {str(e)}"}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
