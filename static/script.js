// LiveGrep script.js - Main application logic

let abortController = null
let currentSearchType = "quick"
const debounceDelay = 300
const resultLimit = 50
let selectedResult = null

// Context panel elements
const contextBody = document.getElementById("context-body")
const contextFileNameEl = document.getElementById("context-file-name")
const contextFileTypeBadge = document.getElementById("context-file-type-badge")
const contextLineIndicator = document.getElementById("context-line-indicator")

// Call hierarchy modal elements
const hierarchyModal = document.getElementById("hierarchy-modal-overlay")
const hierarchyModalClose = document.getElementById("hierarchy-modal-close")
const hierarchyModalBody = document.getElementById("hierarchy-modal-body")
const hierarchyFunctionName = document.getElementById("hierarchy-function-name")

// Context menu elements
const contextMenu = document.getElementById("context-menu")
const showCallHierarchyItem = document.getElementById("show-call-hierarchy")

// Context menu state
let contextMenuTarget = null
let selectedFunctionName = null

// Initialize Mermaid
document.addEventListener("DOMContentLoaded", () => {
  const mermaid = window.mermaid // Declare mermaid variable
  if (mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 14,
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: "basis",
      },
      sequence: {
        useMaxWidth: true,
        wrap: true,
      },
      gantt: {
        useMaxWidth: true,
      },
    })
  }
})

// Modal functionality for call hierarchy
function openHierarchyModal() {
  hierarchyModal.classList.add("show")
  document.body.style.overflow = "hidden"
}

function closeHierarchyModal() {
  hierarchyModal.classList.remove("show")
  document.body.style.overflow = "auto"
}

// Close modal on click outside or close button
hierarchyModalClose.addEventListener("click", closeHierarchyModal)
hierarchyModal.addEventListener("click", (e) => {
  if (e.target === hierarchyModal) closeHierarchyModal()
})

// Close modal on ESC key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (hierarchyModal.classList.contains("show")) {
      closeHierarchyModal()
    }
    hideContextMenu()
  }
})

// Context menu functionality
function showContextMenu(x, y, functionName) {
  selectedFunctionName = functionName
  contextMenu.style.left = `${x}px`
  contextMenu.style.top = `${y}px`
  contextMenu.style.display = "block"

  // Enable/disable menu items based on context
  const isValidFunction = functionName && functionName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  showCallHierarchyItem.classList.toggle("disabled", !isValidFunction)
}

function hideContextMenu() {
  contextMenu.style.display = "none"
  contextMenuTarget = null
  selectedFunctionName = null
}

// Hide context menu when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu()
  }
})

// Context menu item handlers
showCallHierarchyItem.addEventListener("click", (e) => {
  if (!showCallHierarchyItem.classList.contains("disabled") && selectedFunctionName) {
    loadCallHierarchy(selectedFunctionName)
    hideContextMenu()
  }
})

async function performSearch(isFullSearch = false) {
  const path = document.getElementById("directory").value
  const pattern = document.getElementById("pattern").value
  const resultsDiv = document.getElementById("results")

  if (!path || !pattern) {
    resultsDiv.innerHTML = ""
    // Clear context panel
    clearContextPanel()
    return
  }

  if (abortController) abortController.abort()
  abortController = new AbortController()

  currentSearchType = isFullSearch ? "full" : "quick"
  resultsDiv.innerHTML = '<div class="info">Searching... (press Enter for full results)</div>'

  try {
    const limit = isFullSearch ? 0 : resultLimit
    // Fixed: Added the limit parameter to the URL
    const response = await fetch(
      `/search?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}&limit=${limit}`,
      {
        signal: abortController.signal,
      },
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Server error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error("Invalid response format from server")
    }

    displayResults(data)
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Search error:", err)
      resultsDiv.innerHTML = `<div class="error">${err.message}</div>`
    }
  }
}

function parseSearchResult(line) {
  // Parse ag output format: filename:line_number:content
  const match = line.match(/^([^:]+):(\d+):(.*)$/)
  if (match) {
    return {
      filePath: match[1],
      lineNumber: Number.parseInt(match[2]),
      content: match[3],
    }
  }
  return null
}

function displayResults(data) {
  const resultsDiv = document.getElementById("results")
  const pattern = document.getElementById("pattern").value

  if (!data.results || data.results.length === 0) {
    resultsDiv.innerHTML = '<div class="info">No results found</div>'
    clearContextPanel()
    return
  }

  let content = ""
  const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escapedPattern})`, "gi")

  data.results.forEach((line, index) => {
    const parsed = parseSearchResult(line)
    if (parsed) {
      const highlighted = parsed.content.replace(regex, '<span class="highlight">$1</span>')
      content += `
                <div class="result-item" data-index="${index}" data-file="${parsed.filePath}" data-line="${parsed.lineNumber}">
                    <div class="file-path">${parsed.filePath}</div>
                    <span class="line-number">${parsed.lineNumber}:</span>${highlighted}
                </div>
            `
    } else {
      // Fallback for lines that don't match expected format
      const highlighted = line.replace(regex, '<span class="highlight">$1</span>')
      content += `<div class="result-item">${highlighted}</div>`
    }
  })

  if (data.limited && currentSearchType === "quick") {
    content += `<div class="info">Showing first ${resultLimit} results. Press Enter for full search.</div>`
  } else if (currentSearchType === "full") {
    content += `<div class="info">Showing all ${data.results.length} results</div>`
  }

  resultsDiv.innerHTML = content

  // Add click handlers to result items
  document.querySelectorAll(".result-item[data-file]").forEach((item) => {
    item.addEventListener("click", () => {
      // Remove previous selection
      if (selectedResult) {
        selectedResult.classList.remove("selected")
      }

      // Select current item
      item.classList.add("selected")
      selectedResult = item

      // Load file content in right panel
      const filePath = item.dataset.file
      const lineNumber = Number.parseInt(item.dataset.line)

      loadFileContentInPanel(filePath, lineNumber)
    })
  })
}

function clearContextPanel() {
  contextBody.innerHTML = '<div class="empty-context">Click on a search result to view its context</div>'
  contextFileNameEl.textContent = "File Context"
  contextFileTypeBadge.style.display = "none"
  contextLineIndicator.style.display = "none"
}

async function loadFileContentInPanel(filePath, lineNumber) {
  const basePath = document.getElementById("directory").value

  // Update context header
  const fileName = filePath.split("/").pop()
  contextFileNameEl.textContent = `${fileName} - ${filePath}`
  contextLineIndicator.textContent = `Line ${lineNumber}`
  contextLineIndicator.style.display = "inline-block"

  // Show loading in context body
  contextBody.innerHTML = '<div class="loading">Loading file content...</div>'

  try {
    const response = await fetch(
      `/file-content?file_path=${encodeURIComponent(filePath)}&line_number=${lineNumber}&context_lines=20&base_path=${encodeURIComponent(basePath)}`,
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Server error: ${response.status}`)
    }

    const data = await response.json()

    // Update file type badge
    contextFileTypeBadge.textContent = data.file_type.toUpperCase()
    contextFileTypeBadge.style.display = "inline-block"

    displayFileContentInPanel(data)
  } catch (err) {
    console.error("Error loading file content:", err)
    contextBody.innerHTML = `<div class="error">Error loading file: ${err.message}</div>`
    contextFileTypeBadge.style.display = "none"
  }
}

// Map file types to Prism language identifiers
function getPrismLanguage(fileType) {
  const languageMap = {
    c: "c",
    cpp: "cpp",
    python: "python",
    javascript: "javascript",
    html: "markup",
    css: "css",
    json: "json",
    markdown: "markdown",
    text: "text",
  }

  return languageMap[fileType] || "text"
}

// Wait for Prism to be fully loaded
function waitForPrism() {
  return new Promise((resolve) => {
    if (window.Prism && window.Prism.languages) {
      resolve()
    } else {
      setTimeout(() => waitForPrism().then(resolve), 50)
    }
  })
}

// Enhanced syntax highlighting with proper loading checks
async function applySyntaxHighlighting(container, language) {
  await waitForPrism()

  // Ensure the specific language is loaded
  if (language === "c" && !window.Prism.languages.c) {
    console.warn("C language not loaded for Prism")
    return false
  }

  if (language === "cpp" && !window.Prism.languages.cpp) {
    console.warn("C++ language not loaded for Prism")
    return false
  }

  try {
    window.Prism.highlightAllUnder(container)
    return true
  } catch (error) {
    console.error("Error applying syntax highlighting:", error)
    return false
  }
}

// Process Mermaid diagrams in markdown content
async function processMermaidDiagrams(container) {
  const mermaid = window.mermaid // Declare mermaid variable
  if (!mermaid) {
    console.warn("Mermaid not loaded")
    return
  }

  const mermaidBlocks = container.querySelectorAll("code.language-mermaid, pre code.language-mermaid")

  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i]
    const mermaidCode = block.textContent || block.innerText

    try {
      // Create a unique ID for this diagram
      const diagramId = `mermaid-diagram-${Date.now()}-${i}`

      // Create container for the diagram
      const diagramContainer = document.createElement("div")
      diagramContainer.className = "mermaid"
      diagramContainer.id = diagramId
      diagramContainer.textContent = mermaidCode

      // Replace the code block with the diagram container
      const parentPre = block.closest("pre")
      if (parentPre) {
        parentPre.parentNode.replaceChild(diagramContainer, parentPre)
      } else {
        block.parentNode.replaceChild(diagramContainer, block)
      }

      // Render the diagram
      await mermaid.run({
        nodes: [diagramContainer],
      })
    } catch (error) {
      console.error("Error rendering Mermaid diagram:", error)

      // Show error message
      const errorDiv = document.createElement("div")
      errorDiv.className = "mermaid-error"
      errorDiv.innerHTML = `
        <strong>Mermaid Diagram Error:</strong><br>
        ${escapeHtml(error.message)}<br><br>
        <strong>Diagram Code:</strong><br>
        <pre>${escapeHtml(mermaidCode)}</pre>
      `

      // Replace the problematic block
      const parentPre = block.closest("pre")
      if (parentPre) {
        parentPre.parentNode.replaceChild(errorDiv, parentPre)
      } else {
        block.parentNode.replaceChild(errorDiv, block)
      }
    }
  }
}

async function displayFileContentInPanel(data) {
  const marked = window.marked // Declare marked variable

  if (data.file_type === "markdown") {
    // Render markdown
    const fullContent = data.context.map((line) => line.content).join("\n")
    const htmlContent = marked.parse(fullContent)

    // Create container and set HTML
    const markdownContainer = document.createElement("div")
    markdownContainer.className = "markdown-content"
    markdownContainer.innerHTML = htmlContent

    // Clear context body and add markdown container
    contextBody.innerHTML = ""
    contextBody.appendChild(markdownContainer)

    // Process Mermaid diagrams
    await processMermaidDiagrams(markdownContainer)
  } else {
    // For code files, first create a pre>code element for Prism
    const prismLanguage = getPrismLanguage(data.file_type)
    const codeContent = data.context.map((line) => line.content).join("\n")

    // Create a temporary container for syntax highlighting
    const tempContainer = document.createElement("div")
    tempContainer.innerHTML = `<pre><code class="language-${prismLanguage}">${escapeHtml(codeContent)}</code></pre>`

    // Apply Prism highlighting with proper loading check
    const highlightingSuccess = await applySyntaxHighlighting(tempContainer, prismLanguage)

    // Get the highlighted HTML
    const highlightedCode = tempContainer.querySelector("code").innerHTML
    const highlightedLines = highlightedCode.split("\n")

    // Build the final display with line numbers and highlighting
    let content = ""
    data.context.forEach((line, index) => {
      const lineClass = line.is_match ? "code-line highlight-line" : "code-line"
      const highlightedContent = highlightedLines[index] || escapeHtml(line.content)

      content += `
                <div class="${lineClass}">
                    <div class="code-line-number">${line.line_number}</div>
                    <div class="code-line-content">${highlightedContent}</div>
                </div>
            `
    })

    contextBody.innerHTML = content

    // Add right-click context menu to function names in C/C++ files
    if (data.file_type === "c" || data.file_type === "cpp") {
      addContextMenuToFunctions()
    }

    // Scroll to the highlighted line
    setTimeout(() => {
      const highlightedLine = contextBody.querySelector(".highlight-line")
      if (highlightedLine) {
        const containerHeight = contextBody.clientHeight
        const lineTop = highlightedLine.offsetTop
        const targetScroll = Math.max(0, lineTop - containerHeight / 2)

        contextBody.scrollTo({
          top: targetScroll,
          behavior: "smooth",
        })
      }
    }, 100)
  }
}

function addContextMenuToFunctions() {
  // Add right-click handlers to detect function names
  const codeLines = contextBody.querySelectorAll(".code-line-content")

  codeLines.forEach((line) => {
    line.addEventListener("contextmenu", (e) => {
      e.preventDefault()

      // Try to extract function name from the clicked position
      const selection = window.getSelection()
      let functionName = null

      // If there's a selection, use it
      if (selection.toString().trim()) {
        const selectedText = selection.toString().trim()
        if (selectedText.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
          functionName = selectedText
        }
      } else {
        // Try to find function name near the click position
        const text = line.textContent
        const clickX = e.clientX
        const rect = line.getBoundingClientRect()
        const relativeX = clickX - rect.left

        // Rough estimation of character position
        const charWidth = 7 // approximate character width in monospace font
        const charPosition = Math.floor(relativeX / charWidth)

        // Extract word at position
        const words = text.split(/\s+/)
        let currentPos = 0

        for (const word of words) {
          if (currentPos <= charPosition && charPosition <= currentPos + word.length) {
            // Check if this looks like a function name
            const cleanWord = word.replace(/[^\w]/g, "")
            if (cleanWord.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
              functionName = cleanWord
              break
            }
          }
          currentPos += word.length + 1 // +1 for space
        }
      }

      if (functionName) {
        showContextMenu(e.clientX, e.clientY, functionName)
      }
    })
  })
}

async function loadCallHierarchy(functionName) {
  const basePath = document.getElementById("directory").value

  if (!basePath) {
    alert("Please set a directory path first")
    return
  }

  // Open modal and show loading
  openHierarchyModal()
  hierarchyFunctionName.textContent = functionName
  hierarchyModalBody.innerHTML = '<div class="loading">Building recursive call hierarchy...</div>'

  try {
    const response = await fetch(
      `/call-hierarchy?function_name=${encodeURIComponent(functionName)}&base_path=${encodeURIComponent(basePath)}&max_depth=10`,
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Server error: ${response.status}`)
    }

    const data = await response.json()
    displayCallHierarchy(data)
  } catch (err) {
    console.error("Error loading call hierarchy:", err)
    hierarchyModalBody.innerHTML = `<div class="error">Error loading call hierarchy: ${err.message}</div>`
  }
}

function displayCallHierarchy(data) {
  if (!data.callers || data.callers.length === 0) {
    hierarchyModalBody.innerHTML = `
      <div class="no-callers">
        <p>No callers found for function <strong>${data.function_name}</strong></p>
        <p>This function might be a main function, entry point, or not found in the current directory.</p>
      </div>
    `
    return
  }

  const totalNodes = countTotalNodes(data)

  let content = `
    <div class="hierarchy-stats">
      <strong>${data.function_name}</strong> is called by <strong>${data.total_callers}</strong> function${data.total_callers !== 1 ? "s" : ""} 
      (${totalNodes} total references)
    </div>
    
    <div class="hierarchy-tree">
      <div class="hierarchy-node root">
        <span class="function-name">${data.function_name}</span>
        <span class="root-label">Target Function</span>
      </div>
  `

  content += renderHierarchyNodes(data.callers, 0)
  content += "</div>"

  hierarchyModalBody.innerHTML = content

  // Add click handlers and expand/collapse functionality
  addHierarchyInteractivity()
}

function countTotalNodes(data) {
  let count = 1 // Root node

  function countRecursive(callers) {
    for (const caller of callers) {
      count++
      if (caller.callers && caller.callers.length > 0) {
        countRecursive(caller.callers)
      }
    }
  }

  if (data.callers) {
    countRecursive(data.callers)
  }

  return count
}

function renderHierarchyNodes(callers, depth) {
  let content = ""

  callers.forEach((caller, index) => {
    const hasChildren = caller.callers && caller.callers.length > 0
    const isRecursive = caller.is_recursive
    const nodeId = `node-${depth}-${index}`

    let nodeClasses = "hierarchy-node caller"
    if (hasChildren) nodeClasses += " expandable"
    if (isRecursive) nodeClasses += " recursive"

    // Clean up the file path - show only filename if it's long
    const fileName = caller.file_path.split("/").pop()
    const displayPath = caller.file_path.length > 40 ? `.../${fileName}` : caller.file_path

    content += `
      <div class="${nodeClasses}" 
           data-file="${caller.file_path}" 
           data-line="${caller.line_number}"
           data-node-id="${nodeId}"
           title="Click to view ${caller.file_path}:${caller.line_number}">
        <div class="hierarchy-main">
          ${hasChildren ? `<span class="expand-toggle" data-target="${nodeId}">▶</span>` : '<span class="expand-spacer"></span>'}
          <span class="function-name ${isRecursive ? "recursive" : ""}">${caller.caller_function}</span>
          ${isRecursive ? '<span class="recursive-badge">RECURSIVE</span>' : ""}
        </div>
        <div class="hierarchy-location">
          <span class="file-info">${displayPath}:${caller.line_number}</span>
        </div>
        ${
          hasChildren
            ? `<div class="caller-children" data-children="${nodeId}">
          ${renderHierarchyNodes(caller.callers, depth + 1)}
        </div>`
            : ""
        }
      </div>
    `
  })

  return content
}

function addHierarchyInteractivity() {
  // Add click handlers to caller nodes for navigation
  const callerNodes = hierarchyModalBody.querySelectorAll(".hierarchy-node.caller")
  callerNodes.forEach((node) => {
    node.addEventListener("click", (e) => {
      // Don't navigate if clicking on expand toggle
      if (e.target.classList.contains("expand-toggle")) {
        return
      }

      const filePath = node.getAttribute("data-file")
      const lineNumber = Number.parseInt(node.getAttribute("data-line"))

      console.log("Hierarchy click:", filePath, lineNumber) // Debug log

      if (filePath && lineNumber) {
        // Close hierarchy modal first
        closeHierarchyModal()

        // Small delay to ensure modal is closed before loading content
        setTimeout(() => {
          loadFileContentInPanel(filePath, lineNumber)
        }, 100)
      }
    })
  })

  // Add expand/collapse functionality
  const expandToggles = hierarchyModalBody.querySelectorAll(".expand-toggle")
  expandToggles.forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation()

      const targetId = toggle.dataset.target
      const childrenContainer = hierarchyModalBody.querySelector(`[data-children="${targetId}"]`)
      const parentNode = toggle.closest(".hierarchy-node")

      if (childrenContainer) {
        const isExpanded = childrenContainer.classList.contains("expanded")

        if (isExpanded) {
          // Collapse
          childrenContainer.classList.remove("expanded")
          toggle.textContent = "▶"
          toggle.classList.remove("expanded")
          parentNode.classList.remove("expanded")
        } else {
          // Expand
          childrenContainer.classList.add("expanded")
          toggle.textContent = "▼"
          toggle.classList.add("expanded")
          parentNode.classList.add("expanded")
        }
      }
    })
  })
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

// Debounce function
let timeout
function debouncedSearch() {
  clearTimeout(timeout)
  timeout = setTimeout(() => performSearch(false), debounceDelay)
}

// Event listeners
document.getElementById("pattern").addEventListener("input", debouncedSearch)
document.getElementById("directory").addEventListener("input", debouncedSearch)

// Enter key for full search
document.getElementById("pattern").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(timeout)
    performSearch(true)
  }
})
