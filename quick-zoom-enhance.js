#!/usr/bin/env node
/**
 * Quick Zoom Enhancement Script
 * Usage: node quick-zoom-enhance.js <file_or_directory>
 */

const fs = require('fs');
const path = require('path');

// Simple zoom enhancement template
const ZOOM_CSS = `
    /* Zoom+Pan Enhancement CSS */
    .zoom-controls {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      background: rgba(255, 255, 255, 0.95);
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      backdrop-filter: blur(5px);
      min-width: 80px;
    }

    .zoom-btn-row {
      display: flex;
      gap: 8px;
    }

    .zoom-btn {
      width: 32px;
      height: 32px;
      border: 2px solid #4a90e2;
      background: white;
      cursor: pointer;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 18px;
      color: #4a90e2;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .zoom-btn:hover {
      background: #4a90e2;
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }

    .zoom-btn:active {
      transform: translateY(0);
    }

    .zoom-level {
      font-size: 12px;
      font-weight: bold;
      color: #333;
      background: rgba(74, 144, 226, 0.1);
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid rgba(74, 144, 226, 0.3);
      min-width: 45px;
      text-align: center;
    }

    .zoom-reset {
      width: 60px;
      height: 28px;
      font-size: 11px;
      background: #f8f9fa;
      border: 2px solid #6c757d;
      color: #6c757d;
    }

    .zoom-reset:hover {
      background: #6c757d;
      color: white;
    }

    #activity-viewport {
      overflow: hidden;
      position: relative;
      width: 100%;
      height: 100%;
    }

    #root {
      transform-origin: 0 0;
      transition: transform 0.2s ease;
      cursor: grab;
    }

    #root:active {
      cursor: grabbing;
    }

    #root.dragging {
      cursor: grabbing !important;
    }

    #root * {
      pointer-events: auto;
    }

    #root.panning * {
      pointer-events: none;
    }
`;

const ZOOM_HTML = `
    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <div class="zoom-btn-row">
        <button class="zoom-btn" onclick="zoomIn()" title="Yakınlaştır">+</button>
        <button class="zoom-btn" onclick="zoomOut()" title="Uzaklaştır">-</button>
      </div>
      <div class="zoom-level" id="zoom-level">100%</div>
      <button class="zoom-btn zoom-reset" onclick="resetZoom()" title="Orijinal boyut">1:1</button>
    </div>
`;

const ZOOM_JS = `
    // Zoom+Pan Enhancement
    let currentZoom = 1, currentPanX = 0, currentPanY = 0, isDragging = false;
    
    function updateTransform() {
      const root = document.getElementById('root');
      const zoomLevel = document.getElementById('zoom-level');
      if (root) root.style.transform = \`scale(\${currentZoom}) translate(\${currentPanX}px, \${currentPanY}px)\`;
      if (zoomLevel) zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
    }
    
    function zoomIn() { currentZoom = Math.min(currentZoom * 1.2, 3); updateTransform(); saveZoomState(); }
    function zoomOut() { currentZoom = Math.max(currentZoom / 1.2, 0.5); updateTransform(); saveZoomState(); }
    function resetZoom() { currentZoom = 1; currentPanX = 0; currentPanY = 0; updateTransform(); saveZoomState(); }
    
    function saveZoomState() {
      try { localStorage.setItem('activityZoom', JSON.stringify({zoom: currentZoom, panX: currentPanX, panY: currentPanY})); } catch (e) {}
    }
    
    function loadZoomState() {
      try {
        const saved = localStorage.getItem('activityZoom');
        if (saved) { const state = JSON.parse(saved); currentZoom = state.zoom || 1; currentPanX = state.panX || 0; currentPanY = state.panY || 0; updateTransform(); }
      } catch (e) {}
    }
    
    function initializePan() {
      const root = document.getElementById('root');
      if (!root) return;
      let startX, startY, initialPanX, initialPanY;
      
      root.addEventListener('mousedown', function(e) {
        const target = e.target;
        const isInteractive = target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.onclick || target.ondrag || target.draggable || target.classList.contains('draggable') || target.classList.contains('interactive') || target.getAttribute('data-interactive') || getComputedStyle(target).cursor === 'pointer';
        if (isInteractive || currentZoom <= 1.1) return;
        isDragging = true; startX = e.clientX; startY = e.clientY; initialPanX = currentPanX; initialPanY = currentPanY;
        root.classList.add('panning'); e.preventDefault();
      });
      
      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const deltaX = e.clientX - startX; const deltaY = e.clientY - startY;
        currentPanX = initialPanX + deltaX / currentZoom; currentPanY = initialPanY + deltaY / currentZoom;
        updateTransform(); e.preventDefault();
      });
      
      document.addEventListener('mouseup', function() {
        if (isDragging) { isDragging = false; root.classList.remove('panning'); saveZoomState(); }
      });
      
      root.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          const newZoom = Math.max(0.5, Math.min(3, currentZoom * delta));
          if (newZoom !== currentZoom) { currentZoom = newZoom; updateTransform(); saveZoomState(); }
        }
      });
    }
    
    document.addEventListener('DOMContentLoaded', function() { loadZoomState(); initializePan(); });
    setTimeout(function() { loadZoomState(); initializePan(); }, 500);
`;

function enhanceHtmlFile(filePath) {
  try {
    console.log(`Processing: ${filePath}`);
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if already enhanced
    if (content.includes('zoom-controls')) {
      console.log('  -> Already enhanced, skipping');
      return false;
    }
    
    // Add CSS before </head>
    content = content.replace('</head>', `  <style>${ZOOM_CSS}  </style>\n</head>`);
    
    // Wrap root with viewport
    content = content.replace('<div id="root"></div>', '<div id="activity-viewport"><div id="root"></div></div>');
    
    // Add zoom controls to toolbar
    const toolbarEndIndex = content.indexOf('</div>', content.indexOf('class="toolbar"'));
    if (toolbarEndIndex !== -1) {
      content = content.slice(0, toolbarEndIndex) + '      ' + ZOOM_HTML + '\n    ' + content.slice(toolbarEndIndex);
    }
    
    // Add JavaScript before </body>
    content = content.replace('</body>', `  <script>${ZOOM_JS}  </script>\n</body>`);
    
    // Write back
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('  -> Enhanced successfully!');
    return true;
    
  } catch (error) {
    console.error(`  -> Error: ${error.message}`);
    return false;
  }
}

function processPath(inputPath) {
  const fullPath = path.resolve(inputPath);
  
  if (!fs.existsSync(fullPath)) {
    console.error(`Path does not exist: ${fullPath}`);
    return;
  }
  
  const stat = fs.statSync(fullPath);
  
  if (stat.isFile() && path.basename(fullPath) === 'index.html') {
    // Single file
    enhanceHtmlFile(fullPath);
  } else if (stat.isDirectory()) {
    // Directory - find all index.html files in htmletk folders
    const { execSync } = require('child_process');
    try {
      const findCmd = process.platform === 'win32' 
        ? `dir "${fullPath}" /s /b | findstr htmletk\\index.html`
        : `find "${fullPath}" -path "*/htmletk/*/index.html" -type f`;
      
      const output = execSync(findCmd, { encoding: 'utf8' });
      const files = output.trim().split('\n').filter(f => f.trim());
      
      if (files.length === 0) {
        console.log('No HTML activity files found in directory');
        return;
      }
      
      console.log(`Found ${files.length} HTML activity files`);
      let enhanced = 0;
      
      files.forEach(file => {
        if (enhanceHtmlFile(file.trim())) enhanced++;
      });
      
      console.log(`\nEnhanced ${enhanced} files`);
      
    } catch (error) {
      console.error('Error searching for files:', error.message);
    }
  } else {
    console.error('Please provide either a directory or an index.html file');
  }
}

// Main execution
const inputPath = process.argv[2];
if (!inputPath) {
  console.log('Usage: node quick-zoom-enhance.js <file_or_directory>');
  console.log('Examples:');
  console.log('  node quick-zoom-enhance.js ./uploads');
  console.log('  node quick-zoom-enhance.js ./test/book1/assets/5907/htmletk/u1/index.html');
  process.exit(1);
}

processPath(inputPath);