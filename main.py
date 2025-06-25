"""LiveGrep - Code Search Application with Call Hierarchy."""

import os
import asyncio
import re
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Serve the main HTML page."""
    return HTMLResponse(open("static/index.html").read())


@app.get("/search")
async def search_files(path: str, pattern: str, limit: int = 50):
    """Search for files matching the given pattern."""
    if not os.path.isabs(path) or not os.path.exists(path):
        return JSONResponse(
            status_code=400,
            content={
                "error": "Invalid directory path",
                "results": [],
                "limited": False
            }
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
            except Exception:
                pass
            await proc.wait()

        return {
            "results": results,
            "limited": limited
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": str(e),
                "results": [],
                "limited": False
            }
        )


@app.get("/file-content")
async def get_file_content(
    file_path: str,
    line_number: int,
    context_lines: int = 10,
    base_path: str = None
):
    """Get file content with context around a specific line number."""
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
        file_type = _get_file_type(file_extension)

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


def _get_file_type(file_extension: str) -> str:
    """Determine file type based on extension."""
    type_mapping = {
        '.c': 'c',
        '.h': 'c',
        '.hpp': 'c',
        '.cpp': 'cpp',
        '.cc': 'cpp',
        '.cxx': 'cpp',
        '.py': 'python',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.html': 'html',
        '.htm': 'html',
        '.css': 'css',
        '.json': 'json'
    }
    return type_mapping.get(file_extension, 'text')


@app.get("/call-hierarchy")
async def get_call_hierarchy(
    function_name: str,
    base_path: str,
    max_depth: int = 10
):
    """Get recursive call hierarchy for a function using cscope and cflow."""
    try:
        if not os.path.isabs(base_path) or not os.path.exists(base_path):
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid directory path"}
            )

        # Check if cscope database exists, if not create it
        await build_cscope_database(base_path)

        # Build recursive call hierarchy
        hierarchy = await build_recursive_hierarchy(
            function_name, base_path, max_depth
        )

        return hierarchy

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Error generating call hierarchy: {str(e)}"}
        )


async def build_cscope_database(base_path: str):
    """Build cscope database for the given directory."""
    try:
        # Find all C/C++ files recursively
        find_cmd = [
            "find", base_path,
            "-name", "*.c", "-o",
            "-name", "*.cpp", "-o",
            "-name", "*.cc", "-o",
            "-name", "*.cxx", "-o",
            "-name", "*.h", "-o",
            "-name", "*.hpp"
        ]

        find_proc = await asyncio.create_subprocess_exec(
            *find_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await find_proc.communicate()

        if find_proc.returncode != 0:
            raise Exception(f"Failed to find source files: {stderr.decode()}")

        # Write file list to cscope.files
        files_list_path = os.path.join(base_path, "cscope.files")
        with open(files_list_path, 'w') as f:
            f.write(stdout.decode())

        # Build cscope database
        cscope_cmd = ["cscope", "-b", "-q", "-k"]

        cscope_proc = await asyncio.create_subprocess_exec(
            *cscope_cmd,
            cwd=base_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await cscope_proc.communicate()

        if cscope_proc.returncode != 0:
            print(f"Cscope database build warning: {stderr.decode()}")

    except Exception as e:
        print(f"Cscope database build failed: {e}")


async def build_recursive_hierarchy(
    function_name: str,
    base_path: str,
    max_depth: int,
    visited=None,
    current_depth=0
):
    """Build recursive call hierarchy like cflow."""
    if visited is None:
        visited = set()

    # Prevent infinite recursion
    if current_depth >= max_depth or function_name in visited:
        return {
            "function_name": function_name,
            "callers": [],
            "total_callers": 0,
            "depth": current_depth,
            "is_recursive": function_name in visited
        }

    visited.add(function_name)

    # Find direct callers
    direct_callers = await find_function_callers(function_name, base_path)

    # Build recursive structure
    recursive_callers = []
    for caller in direct_callers:
        caller_function = caller.get("caller_function", "unknown")

        # Skip if caller function is unknown or same as current function
        if caller_function == "unknown" or caller_function == function_name:
            caller["callers"] = []
            caller["total_callers"] = 0
            caller["depth"] = current_depth + 1
            recursive_callers.append(caller)
            continue

        # Recursively find callers of this caller
        sub_hierarchy = await build_recursive_hierarchy(
            caller_function, base_path, max_depth, visited.copy(),
            current_depth + 1
        )

        # Merge the information
        caller["callers"] = sub_hierarchy["callers"]
        caller["total_callers"] = len(sub_hierarchy["callers"])
        caller["depth"] = current_depth + 1
        caller["is_recursive"] = sub_hierarchy.get("is_recursive", False)

        recursive_callers.append(caller)

    visited.remove(function_name)

    return {
        "function_name": function_name,
        "callers": recursive_callers,
        "total_callers": len(recursive_callers),
        "depth": current_depth,
        "max_depth_reached": current_depth >= max_depth - 1
    }


def is_function_declaration(code_line: str, function_name: str) -> bool:
    """Check if a line contains a function declaration (not a call)."""
    # Remove leading/trailing whitespace
    line = code_line.strip()

    # Skip empty lines and comments
    if not line or line.startswith('//') or line.startswith('/*') or \
       line.startswith('*'):
        return True

    # Common patterns for function declarations (to exclude):
    declaration_patterns = [
        # Function prototypes ending with semicolon
        rf'\b{re.escape(function_name)}\s*$$[^)]*$$\s*;',
        # Function declarations in header files
        rf'^\s*(?:extern\s+)?(?:static\s+)?(?:inline\s+)?'
        rf'(?:\w+\s+)*{re.escape(function_name)}\s*$$[^)]*$$\s*;',
        # Function pointer declarations
        rf'$$\s*\*\s*{re.escape(function_name)}\s*$$',
        # typedef function declarations
        rf'typedef\s+.*{re.escape(function_name)}',
    ]

    for pattern in declaration_patterns:
        if re.search(pattern, line, re.IGNORECASE):
            return True

    # Check if it's a function definition
    definition_patterns = [
        rf'^\s*(?:static\s+)?(?:inline\s+)?(?:\w+\s+)*'
        rf'{re.escape(function_name)}\s*$$[^)]*$$\s*\{{',
        rf'^\s*(?:static\s+)?(?:inline\s+)?(?:\w+\s+)*'
        rf'{re.escape(function_name)}\s*$$[^)]*$$\s*$',
    ]

    for pattern in definition_patterns:
        if re.search(pattern, line, re.IGNORECASE):
            return True  # This is a definition, not a call

    return False


def is_function_call(code_line: str, function_name: str) -> bool:
    """Check if a line contains an actual function call."""
    line = code_line.strip()

    # Skip empty lines and comments
    if not line or line.startswith('//') or line.startswith('/*') or \
       line.startswith('*'):
        return False

    # Skip preprocessor directives
    if line.startswith('#'):
        return False

    # Look for function call patterns
    call_patterns = [
        # Direct function call: function_name(
        rf'\b{re.escape(function_name)}\s*\(',
        # Function call with assignment: var = function_name(
        rf'=\s*{re.escape(function_name)}\s*\(',
        # Function call in expression: ... function_name( ...
        rf'[^\w]{re.escape(function_name)}\s*\(',
        # Function call at start of line
        rf'^\s*{re.escape(function_name)}\s*\(',
    ]

    for pattern in call_patterns:
        if re.search(pattern, line):
            # Additional check: make sure it's not a declaration
            if not is_function_declaration(line, function_name):
                return True

    return False


async def find_function_callers(function_name: str, base_path: str):
    """Find all callers of a function, excluding declarations."""
    callers = []

    try:
        # Try cscope first
        cscope_cmd = ["cscope", "-d", "-L", "-3", function_name]

        cscope_proc = await asyncio.create_subprocess_exec(
            *cscope_cmd,
            cwd=base_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await cscope_proc.communicate()

        if cscope_proc.returncode == 0 and stdout:
            # Parse cscope output
            for line in stdout.decode().strip().split('\n'):
                if line.strip():
                    parts = line.split(' ', 3)
                    if len(parts) >= 4:
                        file_path = parts[0]
                        function_context = parts[1]
                        line_number = parts[2]
                        code_line = parts[3]

                        # Skip if this is a function declaration/definition
                        if is_function_declaration(code_line, function_name):
                            continue

                        # Skip if this doesn't look like a function call
                        if not is_function_call(code_line, function_name):
                            continue

                        # Make file path relative to base_path
                        if file_path.startswith(base_path):
                            file_path = os.path.relpath(file_path, base_path)

                        # Extract actual caller function name from context
                        caller_func = extract_caller_function(
                            function_context, code_line
                        )

                        callers.append({
                            "file_path": file_path,
                            "function_context": function_context,
                            "line_number": int(line_number),
                            "code_line": code_line.strip(),
                            "caller_function": caller_func
                        })
        else:
            # Fallback to grep-based search
            callers = await grep_function_callers(function_name, base_path)

    except Exception:
        # Fallback to grep-based search
        callers = await grep_function_callers(function_name, base_path)

    return callers


def extract_caller_function(function_context: str, code_line: str) -> str:
    """Extract the actual caller function name from cscope output."""
    # If function_context looks like a function name, use it
    if function_context and function_context != "<global>" and \
       function_context.replace("_", "").replace(".", "").isalnum():
        return function_context

    # Try to extract function name from the code line
    # Pattern to match function definitions
    func_def_pattern = (
        r'^\s*(?:static\s+)?(?:inline\s+)?(?:\w+\s+)*'
        r'(\w+)\s*$$[^)]*$$\s*\{'
    )
    match = re.match(func_def_pattern, code_line)
    if match:
        return match.group(1)

    # If we can't determine the caller function, return the context
    return function_context if function_context and \
        function_context != "<global>" else "unknown"


async def grep_function_callers(function_name: str, base_path: str):
    """Fallback method using grep to find function callers."""
    callers = []

    try:
        # Use grep to find function calls (not declarations)
        pattern = f"{function_name}\\s*\\("

        grep_cmd = [
            "grep", "-rn", "--include=*.c", "--include=*.cpp",
            "--include=*.cc", "--include=*.cxx",
            # Exclude header files to avoid declarations
            "--exclude=*.h", "--exclude=*.hpp",
            "-E", pattern, base_path
        ]

        grep_proc = await asyncio.create_subprocess_exec(
            *grep_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await grep_proc.communicate()

        if grep_proc.returncode == 0 and stdout:
            for line in stdout.decode().strip().split('\n'):
                if line.strip():
                    parts = line.split(':', 2)
                    if len(parts) >= 3:
                        file_path = parts[0]
                        line_number = parts[1]
                        code_line = parts[2]

                        # Skip if this is a function declaration/definition
                        if is_function_declaration(code_line, function_name):
                            continue

                        # Skip if this doesn't look like a function call
                        if not is_function_call(code_line, function_name):
                            continue

                        # Make file path relative to base_path
                        if file_path.startswith(base_path):
                            file_path = os.path.relpath(file_path, base_path)

                        # Try to determine the caller function
                        caller_func = await find_containing_function(
                            file_path, int(line_number), base_path
                        )

                        callers.append({
                            "file_path": file_path,
                            "function_context": caller_func,
                            "line_number": int(line_number),
                            "code_line": code_line.strip(),
                            "caller_function": caller_func
                        })

    except Exception as e:
        print(f"Grep fallback failed: {e}")

    return callers


async def find_containing_function(
    file_path: str,
    line_number: int,
    base_path: str
) -> str:
    """Find which function contains the given line number."""
    try:
        full_path = os.path.join(base_path, file_path) if not \
            os.path.isabs(file_path) else file_path

        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        # Look backwards from the line to find the containing function
        func_pattern = (
            r'^\s*(?:static\s+)?(?:inline\s+)?(?:\w+\s+)*'
            r'(\w+)\s*$$[^)]*$$\s*\{'
        )

        for i in range(min(line_number - 1, len(lines) - 1), -1, -1):
            line = lines[i].strip()
            match = re.match(func_pattern, line)
            if match:
                return match.group(1)

        return "unknown"

    except Exception:
        return "unknown"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
