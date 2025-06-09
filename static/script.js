// LiveGrep script.js - Main application logic

let abortController = null
let currentSearchType = "quick"
const debounceDelay = 300
const resultLimit = 50
let selectedResult = null

// Modal functionality
const modal = document.getElementById("modal-overlay")
const modalClose = document.getElementById("modal-close")
const modalBody = document.getElementById("modal-body")

function openModal() {
  modal.classList.add("show")
  document.body.style.overflow = "hidden"
}

function closeModal() {
  modal.classList.remove("show")
  document.body.style.overflow = "auto"
}

// Close modal on click outside or close button
modalClose.addEventListener("click", closeModal)
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal()
})

// Close modal on ESC key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("show")) {
    closeModal()
  }
})

async function performSearch(isFullSearch = false) {
  const path = document.getElementById("directory").value
  const pattern = document.getElementById("pattern").value
  const resultsDiv = document.getElementById("results")

  if (!path || !pattern) {
    resultsDiv.innerHTML = ""
    return
  }

  if (abortController) abortController.abort()
  abortController = new AbortController()

  currentSearchType = isFullSearch ? "full" : "quick"
  resultsDiv.innerHTML = '<div class="info">Searching... (press Enter for full results)</div>'

  try {
    const limit = isFullSearch ? 0 : resultLimit
    const response = await fetch(`/search?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}`, {
      signal: abortController.signal,
    })

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

      // Load file content in modal
      const filePath = item.dataset.file
      const lineNumber = Number.parseInt(item.dataset.line)
      const basePath = document.getElementById("directory").value

      loadFileContentInModal(filePath, lineNumber)
    })
  })
}

async function loadFileContentInModal(filePath, lineNumber) {
  const modalFileNameEl = document.getElementById("modal-file-name")
  const modalFileTypeBadge = document.getElementById("modal-file-type-badge")
  const modalLineIndicator = document.getElementById("modal-line-indicator")
  const basePath = document.getElementById("directory").value

  // Open modal immediately
  openModal()

  // Update modal header
  const fileName = filePath.split("/").pop()
  modalFileNameEl.textContent = `${fileName} - ${filePath}`
  modalLineIndicator.textContent = `Line ${lineNumber}`
  modalLineIndicator.style.display = "inline-block"

  // Show loading in modal body
  modalBody.innerHTML = '<div class="loading">Loading file content...</div>'

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
    modalFileTypeBadge.textContent = data.file_type.toUpperCase()
    modalFileTypeBadge.style.display = "inline-block"

    displayFileContentInModal(data)
  } catch (err) {
    console.error("Error loading file content:", err)
    modalBody.innerHTML = `<div class="error">Error loading file: ${err.message}</div>`
    modalFileTypeBadge.style.display = "none"
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

function displayFileContentInModal(data) {
  const marked = window.marked // Declare marked variable
  const Prism = window.Prism // Declare Prism variable

  if (data.file_type === "markdown") {
    // Render markdown
    const fullContent = data.context.map((line) => line.content).join("\n")
    const htmlContent = marked.parse(fullContent)
    modalBody.innerHTML = `<div class="markdown-content">${htmlContent}</div>`
  } else {
    // For code files, first create a pre>code element for Prism
    const prismLanguage = getPrismLanguage(data.file_type)
    const codeContent = data.context.map((line) => line.content).join("\n")

    // Create a temporary container for syntax highlighting
    const tempContainer = document.createElement("div")
    tempContainer.innerHTML = `<pre><code class="language-${prismLanguage}">${escapeHtml(codeContent)}</code></pre>`

    // Apply Prism highlighting
    Prism.highlightAllUnder(tempContainer)

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

    modalBody.innerHTML = content

    // Scroll to the highlighted line
    setTimeout(() => {
      const highlightedLine = modalBody.querySelector(".highlight-line")
      if (highlightedLine) {
        const containerHeight = modalBody.clientHeight
        const lineTop = highlightedLine.offsetTop
        const targetScroll = Math.max(0, lineTop - containerHeight / 2)

        modalBody.scrollTo({
          top: targetScroll,
          behavior: "smooth",
        })
      }
    }, 100)
  }
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
