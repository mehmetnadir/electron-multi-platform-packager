#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Zoom+Pan enhancement template
const ZOOM_ENHANCEMENT = {
  css: `
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
  `,

  html: `
    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <div class="zoom-btn-row">
        <button class="zoom-btn" onclick="zoomIn()" title="Yakınlaştır">+</button>
        <button class="zoom-btn" onclick="zoomOut()" title="Uzaklaştır">-</button>
      </div>
      <div class="zoom-level" id="zoom-level">100%</div>
      <button class="zoom-btn zoom-reset" onclick="resetZoom()" title="Orijinal boyut">1:1</button>
    </div>
  `,

  javascript: `
    // Zoom+Pan Enhancement JavaScript
    let currentZoom = 1;
    let currentPanX = 0;
    let currentPanY = 0;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

        function updateTransform() {
      const root = document.getElementById('root');
      const zoomLevel = document.getElementById('zoom-level');
      if (root) {
        root.style.transform = \`scale(\${currentZoom}) translate(\${currentPanX}px, \${currentPanY}px)\`;
      }
      if (zoomLevel) {
        zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
      }
    }

    function zoomIn() {
      currentZoom = Math.min(currentZoom * 1.2, 3);
      updateTransform();
      saveZoomState();
    }

    function zoomOut() {
      currentZoom = Math.max(currentZoom / 1.2, 0.5);
      updateTransform();
      saveZoomState();
    }

    function resetZoom() {
      currentZoom = 1;
      currentPanX = 0;
      currentPanY = 0;
      updateTransform();
      saveZoomState();
    }

    function saveZoomState() {
      try {
        localStorage.setItem('activityZoom', JSON.stringify({
          zoom: currentZoom,
          panX: currentPanX,
          panY: currentPanY
        }));
      } catch (e) {
        console.log('Could not save zoom state:', e);
      }
    }

    function loadZoomState() {
      try {
        const saved = localStorage.getItem('activityZoom');
        if (saved) {
          const state = JSON.parse(saved);
          currentZoom = state.zoom || 1;
          currentPanX = state.panX || 0;
          currentPanY = state.panY || 0;
          updateTransform();
        }
      } catch (e) {
        console.log('Could not load zoom state:', e);
      }
    }

    function initializePan() {
      const root = document.getElementById('root');
      if (!root) return;

      let startX, startY, initialPanX, initialPanY;

      root.addEventListener('mousedown', function(e) {
        // Check if we're clicking on an interactive element
        const target = e.target;
        const isInteractive = target.tagName === 'BUTTON' || 
                             target.tagName === 'INPUT' || 
                             target.onclick || 
                             target.ondrag || 
                             target.draggable ||
                             target.classList.contains('draggable') ||
                             target.classList.contains('interactive') ||
                             target.getAttribute('data-interactive') ||
                             getComputedStyle(target).cursor === 'pointer';

        if (isInteractive || currentZoom <= 1.1) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialPanX = currentPanX;
        initialPanY = currentPanY;
        
        root.classList.add('panning');
        e.preventDefault();
      });

      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        currentPanX = initialPanX + deltaX / currentZoom;
        currentPanY = initialPanY + deltaY / currentZoom;
        
        updateTransform();
        e.preventDefault();
      });

      document.addEventListener('mouseup', function() {
        if (isDragging) {
          isDragging = false;
          root.classList.remove('panning');
          saveZoomState();
        }
      });

      // Wheel zoom
      root.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          const newZoom = Math.max(0.5, Math.min(3, currentZoom * delta));
          
          if (newZoom !== currentZoom) {
            currentZoom = newZoom;
            updateTransform();
            saveZoomState();
          }
        }
      });
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
      loadZoomState();
      initializePan();
    });

    // Also initialize after a short delay to ensure everything is loaded
    setTimeout(function() {
      loadZoomState();
      initializePan();
    }, 500);
  `
};

function findHtmlActivities(baseDir) {
  const pattern = path.join(baseDir, '**/htmletk/**/index.html');
  return glob.sync(pattern, { absolute: true });
}

function hasZoomEnhancement(content) {
  return content.includes('zoom-controls') || content.includes('zoomIn()') || content.includes('currentZoom');
}

function addViewportWrapper(content) {
  // Wrap the root div with viewport if not already wrapped
  if (content.includes('id="activity-viewport"')) {
    return content;
  }
  
  return content.replace(
    '<div id="root"></div>',
    '<div id="activity-viewport"><div id="root"></div></div>'
  );
}

function injectZoomEnhancement(htmlContent) {
  // Check if already enhanced
  if (hasZoomEnhancement(htmlContent)) {
    console.log('  -> Already has zoom enhancement, skipping');
    return htmlContent;
  }

  let enhanced = htmlContent;

  // 1. Add CSS to head
  const headEndIndex = enhanced.indexOf('</head>');
  if (headEndIndex !== -1) {
    enhanced = enhanced.slice(0, headEndIndex) + 
               '  <style>' + ZOOM_ENHANCEMENT.css + '  </style>\n' +
               enhanced.slice(headEndIndex);
  }

  // 2. Add viewport wrapper around root
  enhanced = addViewportWrapper(enhanced);

  // 3. Add zoom controls to toolbar
  const toolbarEndIndex = enhanced.indexOf('</div>', enhanced.indexOf('class="toolbar"'));
  if (toolbarEndIndex !== -1) {
    enhanced = enhanced.slice(0, toolbarEndIndex) + 
               '      ' + ZOOM_ENHANCEMENT.html + '\n    ' +
               enhanced.slice(toolbarEndIndex);
  }

  // 4. Add JavaScript before closing body tag
  const bodyEndIndex = enhanced.lastIndexOf('</body>');
  if (bodyEndIndex !== -1) {
    enhanced = enhanced.slice(0, bodyEndIndex) + 
               '  <script>' + ZOOM_ENHANCEMENT.javascript + '  </script>\n' +
               enhanced.slice(bodyEndIndex);
  }

  return enhanced;
}

function processHtmlActivity(filePath) {
  try {
    console.log(`Processing: ${filePath}`);
    
    // Read current content
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Apply enhancement
    const enhanced = injectZoomEnhancement(content);
    
    // Write back if changed
    if (enhanced !== content) {
      fs.writeFileSync(filePath, enhanced, 'utf8');
      console.log('  -> Enhanced with zoom+pan functionality');
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error(`  -> Error processing ${filePath}:`, error.message);
    return false;
  }
}

function main() {
  const baseDir = process.argv[2] || '.';
  
  console.log(`Searching for HTML activities in: ${path.resolve(baseDir)}`);
  
  const htmlFiles = findHtmlActivities(baseDir);
  
  if (htmlFiles.length === 0) {
    console.log('No HTML activity files found!');
    return;
  }
  
  console.log(`Found ${htmlFiles.length} HTML activity files:`);
  
  let processedCount = 0;
  let enhancedCount = 0;
  
  htmlFiles.forEach(filePath => {
    processedCount++;
    const wasEnhanced = processHtmlActivity(filePath);
    if (wasEnhanced) enhancedCount++;
  });
  
  console.log(`\nProcessing complete!`);
  console.log(`Total files processed: ${processedCount}`);
  console.log(`Files enhanced: ${enhancedCount}`);
  console.log(`Files already enhanced: ${processedCount - enhancedCount}`);
  
  if (enhancedCount > 0) {
    console.log(`\nAll HTML activities now have zoom+pan functionality!`);
    console.log('Features added:');
    console.log('- Zoom in/out buttons (+/-)');
    console.log('- Reset zoom button (1:1)');
    console.log('- Mouse wheel zoom (Ctrl+scroll)');
    console.log('- Pan/drag when zoomed');
    console.log('- Zoom state persistence');
    console.log('- Smart interaction detection');
  }
}

// Install required dependency if needed
try {
  require('glob');
} catch (e) {
  console.log('Installing required dependency: glob');
  require('child_process').execSync('npm install glob', { stdio: 'inherit' });
}

main();