#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Enhanced Zoom+Pan template with fixes
const ENHANCED_ZOOM_FUNCTIONALITY = {
  css: `
    /* Enhanced Zoom+Pan CSS */
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
    }

    #root.pan-mode {
      cursor: grab !important;
    }

    #root.pan-mode:active {
      cursor: grabbing !important;
    }

    #root.panning {
      cursor: grabbing !important;
    }

    #root.panning * {
      pointer-events: none !important;
    }
  `,

  javascript: `
    // Enhanced Zoom+Pan JavaScript with fixes
    let currentZoom = 1;
    let currentPanX = 0;
    let currentPanY = 0;
    let isDragging = false;
    let spacePressed = false;
    let shiftPressed = false;

    function updateTransform() {
      const root = document.getElementById('root');
      const zoomLevel = document.getElementById('zoom-level');
      
      console.log('Updating transform - zoom:', currentZoom, 'pan:', currentPanX, currentPanY);
      
      if (root) {
        root.style.transform = \`scale(\${currentZoom}) translate(\${currentPanX}px, \${currentPanY}px)\`;
      }
      
      if (zoomLevel) {
        zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
        console.log('Updated zoom level display:', zoomLevel.textContent);
      } else {
        console.warn('Zoom level element not found!');
      }
    }

    function zoomIn() {
      console.log('Zoom In clicked');
      currentZoom = Math.min(currentZoom * 1.2, 3);
      updateTransform();
      saveZoomState();
    }

    function zoomOut() {
      console.log('Zoom Out clicked');
      currentZoom = Math.max(currentZoom / 1.2, 0.5);
      updateTransform();
      saveZoomState();
    }

    function resetZoom() {
      console.log('Reset Zoom clicked');
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
        console.log('Zoom state saved:', { zoom: currentZoom, panX: currentPanX, panY: currentPanY });
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
          console.log('Zoom state loaded:', state);
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
      
      console.log('Initializing pan functionality');

      // Keyboard events for space and shift detection
      document.addEventListener('keydown', function(e) {
        if (e.code === 'Space') {
          spacePressed = true;
          if (currentZoom > 1.1) {
            root.classList.add('pan-mode');
            e.preventDefault();
          }
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          shiftPressed = true;
        }
      });
      
      document.addEventListener('keyup', function(e) {
        if (e.code === 'Space') {
          spacePressed = false;
          root.classList.remove('pan-mode');
        }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          shiftPressed = false;
        }
      });

      // Pan start - right-click, space+left-click, shift+left-click
      root.addEventListener('mousedown', function(e) {
        const target = e.target;
        
        // Check for interactive elements
        const isInteractive = target.tagName === 'BUTTON' || 
                             target.tagName === 'INPUT' || 
                             target.tagName === 'SELECT' ||
                             target.tagName === 'TEXTAREA' ||
                             target.onclick || 
                             target.ondrag || 
                             target.draggable ||
                             target.classList.contains('draggable') ||
                             target.classList.contains('interactive') ||
                             target.classList.contains('droppable') ||
                             target.getAttribute('data-interactive') ||
                             getComputedStyle(target).cursor === 'pointer';

        console.log('Mouse down:', {
          button: e.button,
          zoom: currentZoom,
          spacePressed,
          shiftPressed,
          isInteractive,
          target: target.tagName
        });

        // Only pan if zoomed enough and not on interactive elements
        if (isInteractive || currentZoom <= 1.05) {
          console.log('Pan blocked:', isInteractive ? 'interactive element' : 'zoom too low');
          return;
        }
        
        // Pan conditions: right-click OR space+left-click OR shift+left-click
        const rightClick = e.button === 2;
        const leftClickWithSpace = e.button === 0 && spacePressed;
        const leftClickWithShift = e.button === 0 && shiftPressed;
        
        if (rightClick || leftClickWithSpace || leftClickWithShift) {
          console.log('Starting pan');
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          initialPanX = currentPanX;
          initialPanY = currentPanY;
          
          root.classList.add('panning');
          e.preventDefault();
          e.stopPropagation();
        }
      });

      // Pan movement
      document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        currentPanX = initialPanX + deltaX / currentZoom;
        currentPanY = initialPanY + deltaY / currentZoom;
        
        updateTransform();
        e.preventDefault();
      });

      // Pan end
      document.addEventListener('mouseup', function(e) {
        if (isDragging) {
          console.log('Ending pan');
          isDragging = false;
          root.classList.remove('panning');
          saveZoomState();
        }
      });
      
      // Prevent context menu when panning
      root.addEventListener('contextmenu', function(e) {
        if (currentZoom > 1.1) {
          e.preventDefault();
        }
      });

      // Touch pan support (two-finger)
      let touchStartDistance = 0;
      let touchStartX = 0;
      let touchStartY = 0;
      let touchPanX = 0;
      let touchPanY = 0;
      
      root.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2 && currentZoom > 1.1) {
          console.log('Touch pan start');
          const touch1 = e.touches[0];
          const touch2 = e.touches[1];
          touchStartDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
          );
          touchStartX = (touch1.clientX + touch2.clientX) / 2;
          touchStartY = (touch1.clientY + touch2.clientY) / 2;
          touchPanX = currentPanX;
          touchPanY = currentPanY;
          e.preventDefault();
        }
      });
      
      root.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && currentZoom > 1.1) {
          const touch1 = e.touches[0];
          const touch2 = e.touches[1];
          const currentDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
          );
          const currentX = (touch1.clientX + touch2.clientX) / 2;
          const currentY = (touch1.clientY + touch2.clientY) / 2;
          
          // If distance doesn't change much (not zooming), pan
          if (Math.abs(currentDistance - touchStartDistance) < 10) {
            const deltaX = currentX - touchStartX;
            const deltaY = currentY - touchStartY;
            currentPanX = touchPanX + deltaX / currentZoom;
            currentPanY = touchPanY + deltaY / currentZoom;
            updateTransform();
          }
          e.preventDefault();
        }
      });
      
      root.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) {
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
      console.log('DOM Content Loaded - initializing zoom');
      setTimeout(function() {
        loadZoomState();
        initializePan();
        // Ensure zoom level display is correct
        updateTransform();
      }, 100);
    });

    // Also initialize after a delay to ensure everything is loaded
    setTimeout(function() {
      console.log('Delayed initialization');
      loadZoomState();
      initializePan();
      updateTransform();
    }, 500);

    // Additional safety: Initialize on window load
    window.addEventListener('load', function() {
      console.log('Window loaded - final zoom initialization');
      loadZoomState();
      initializePan();
      updateTransform();
    });
  `
};

function findHtmlActivities(baseDir) {
  const pattern = path.join(baseDir, '**/htmletk/**/index.html');
  return glob.sync(pattern, { absolute: true });
}

function forceUpdateZoomEnhancement(htmlContent) {
  console.log('  -> Force updating zoom enhancement...');
  
  let enhanced = htmlContent;

  // 1. Remove old zoom CSS if exists
  enhanced = enhanced.replace(/<style>[\s\S]*?\/\* Zoom\+Pan Enhancement CSS \*\/[\s\S]*?<\/style>/g, '');
  enhanced = enhanced.replace(/<style>[\s\S]*?Enhanced Zoom\+Pan CSS[\s\S]*?<\/style>/g, '');

  // 2. Remove old zoom controls HTML if exists
  enhanced = enhanced.replace(/<!-- Zoom Controls -->[\s\S]*?<\/div>/g, '');
  enhanced = enhanced.replace(/<div class="zoom-controls">[\s\S]*?<\/div>/g, '');

  // 3. Remove old zoom JavaScript if exists
  enhanced = enhanced.replace(/<script>[\s\S]*?\/\/ Zoom\+Pan Enhancement JavaScript[\s\S]*?<\/script>/g, '');
  enhanced = enhanced.replace(/<script>[\s\S]*?Enhanced Zoom\+Pan JavaScript[\s\S]*?<\/script>/g, '');

  // 4. Add viewport wrapper if not exists
  if (!enhanced.includes('id="activity-viewport"')) {
    enhanced = enhanced.replace(
      '<div id="root"></div>',
      '<div id="activity-viewport"><div id="root"></div></div>'
    );
  }

  // 5. Add new enhanced CSS to head
  const headEndIndex = enhanced.indexOf('</head>');
  if (headEndIndex !== -1) {
    enhanced = enhanced.slice(0, headEndIndex) + 
               '  <style>' + ENHANCED_ZOOM_FUNCTIONALITY.css + '  </style>\n' +
               enhanced.slice(headEndIndex);
  }

  // 6. Add new zoom controls to toolbar
  const zoomHtml = `
    <!-- Enhanced Zoom Controls -->
    <div class="zoom-controls">
      <div class="zoom-btn-row">
        <button class="zoom-btn" onclick="zoomIn()" title="Yakınlaştır">+</button>
        <button class="zoom-btn" onclick="zoomOut()" title="Uzaklaştır">-</button>
      </div>
      <div class="zoom-level" id="zoom-level">100%</div>
      <button class="zoom-btn zoom-reset" onclick="resetZoom()" title="Orijinal boyut">1:1</button>
    </div>`;

  const toolbarEndIndex = enhanced.indexOf('</div>', enhanced.indexOf('class="toolbar"'));
  if (toolbarEndIndex !== -1) {
    enhanced = enhanced.slice(0, toolbarEndIndex) + 
               '      ' + zoomHtml + '\n    ' +
               enhanced.slice(toolbarEndIndex);
  }

  // 7. Add new enhanced JavaScript before closing body tag
  const bodyEndIndex = enhanced.lastIndexOf('</body>');
  if (bodyEndIndex !== -1) {
    enhanced = enhanced.slice(0, bodyEndIndex) + 
               '  <script>' + ENHANCED_ZOOM_FUNCTIONALITY.javascript + '  </script>\n' +
               enhanced.slice(bodyEndIndex);
  }

  return enhanced;
}

function processHtmlActivity(filePath) {
  try {
    console.log(`Processing: ${filePath}`);
    
    // Read current content
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Force update enhancement
    const enhanced = forceUpdateZoomEnhancement(content);
    
    // Write back
    fs.writeFileSync(filePath, enhanced, 'utf8');
    console.log('  -> Force updated with enhanced zoom+pan functionality');
    return true;
    
  } catch (error) {
    console.error(`  -> Error processing ${filePath}:`, error.message);
    return false;
  }
}

function main() {
  const baseDir = process.argv[2] || '.';
  
  console.log(`Force updating zoom design in: ${path.resolve(baseDir)}`);
  
  const htmlFiles = findHtmlActivities(baseDir);
  
  if (htmlFiles.length === 0) {
    console.log('No HTML activity files found!');
    return;
  }
  
  console.log(`Found ${htmlFiles.length} HTML activity files to update:`);
  
  let processedCount = 0;
  let updatedCount = 0;
  
  htmlFiles.forEach(filePath => {
    processedCount++;
    const wasUpdated = processHtmlActivity(filePath);
    if (wasUpdated) updatedCount++;
  });
  
  console.log(`\nForce update complete!`);
  console.log(`Total files processed: ${processedCount}`);
  console.log(`Files updated: ${updatedCount}`);
  
  console.log(`\nFIXES APPLIED:`);
  console.log('✅ Fixed zoom percentage not updating');
  console.log('✅ Fixed pan functionality with proper interaction detection');
  console.log('✅ Added debug logging for troubleshooting');
  console.log('✅ Improved mouse interaction handling');
  console.log('✅ Enhanced touch pan support');
  console.log('✅ Better element detection and timing');
  
  console.log(`\nPAN CONTROLS:`);
  console.log('🖱️  Right-click + drag to pan');
  console.log('⌨️   Space + left-click + drag to pan');
  console.log('⌨️   Shift + left-click + drag to pan');
  console.log('📱  Two-finger drag on touch devices');
}

// Install required dependency if needed
try {
  require('glob');
} catch (e) {
  console.log('Installing required dependency: glob');
  require('child_process').execSync('npm install glob', { stdio: 'inherit' });
}

main();