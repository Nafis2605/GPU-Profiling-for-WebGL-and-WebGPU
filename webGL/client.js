const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Path to your WebGL HTML file
const WEBGL_URL = 'http://192.168.1.252:9999/index-webgl.html';

// Determine Chrome path based on platform
function getChromePath() {
  // Detect platform and set Chrome path
  const platform = os.platform();
  let chromePath;
  
  if (platform === 'darwin') {
    // macOS
    chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else if (platform === 'linux') {
    // Linux
    chromePath = '/usr/bin/google-chrome';
  } else if (platform === 'win32') {
    // Windows
    chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else {
    chromePath = null;
  }
  
  console.log(`Detected platform: ${platform}`);
  console.log(`Using Chrome path: ${chromePath}`);
  
  return chromePath;
}

// Helper function for waiting - using regular promises instead of Puppeteer-specific methods
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function profileWebGLPerformance() {
  console.log('Starting WebGL profiling...');
  
  // Launch Puppeteer with GPU enabled and DevTools Protocol available
  const chromePath = getChromePath();
  const browser = await puppeteer.launch({
    headless: false, // Need to use headful mode for GPU rendering
    executablePath: chromePath,   
    args: [
      '--enable-webgl',
      '--ignore-gpu-blacklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--disable-gpu-sandbox',
      '--enable-logging=stderr',
      '--v=1',
    ],
    defaultViewport: { width: 1200, height: 800 }
  });

  try {
    // Create a new page
    const page = await browser.newPage();
    
    // Enable necessary DevTools protocols for collecting metrics
    const client = await page.target().createCDPSession();
    await client.send('Performance.enable');
    
    // Navigate to the remote WebGL page
    console.log(`Opening ${WEBGL_URL}`);
    await page.goto(WEBGL_URL, { waitUntil: 'networkidle0' });
    console.log('WebGL page loaded, collecting metrics...');    
    
    // Wait for WebGL to initialize and run for a bit - using custom wait function
    console.log('Waiting 5 seconds for WebGL to initialize...');
    await wait(5000);
    
    // Collect general performance metrics
    const performanceMetrics = await client.send('Performance.getMetrics');
    console.log('Performance Metrics:', performanceMetrics);
    
    // Extract GPU info from the browser
    const gpuInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas found' };
      
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { error: 'Could not initialize WebGL' };
      
      // Get WebGL renderer info
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      
      const info = {
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        extensions: gl.getSupportedExtensions()
      };
      
      return info;
    });
    
    console.log('WebGL GPU Info:', gpuInfo);
    
    try {
      // Start tracing for more detailed GPU information
      // Using a simpler set of categories and a string format rather than an array
      console.log('Starting tracing...');
      await client.send('Tracing.start', {
        categories: 'gpu,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline', 
        options: 'sampling-frequency=10000' // 1000 is default
      });
      
      // Let the WebGL animation run for a few seconds to collect data
      console.log('Recording GPU activity for 5 seconds...');
      await wait(5000);
      
      // Stop tracing
      console.log('Stopping tracing...');
      await client.send('Tracing.end');
      
      // Collect the tracing data
      const tracingData = [];
      client.on('Tracing.dataCollected', (data) => {
        console.log('Received trace data chunk...');
        if (data && data.value) {
          tracingData.push(...data.value);
        }
      });
      
      // Wait for tracing to be completed
      console.log('Waiting for tracing to complete...');
      await new Promise(resolve => {
        client.once('Tracing.tracingComplete', () => {
          console.log('Tracing complete!');
          resolve();
        });
        
        // Fallback timeout in case tracingComplete never fires
        setTimeout(() => {
          console.log('Tracing timeout reached, continuing...');
          resolve();
        }, 10000);
      });
      
      if (tracingData.length > 0) {
        // Save the trace data to a file for later analysis
        fs.writeFileSync('webgl-trace.json', JSON.stringify(tracingData));
        console.log('Trace data saved to webgl-trace.json');
      } else {
        console.log('No trace data was collected');
      }
    } catch (tracingError) {
      console.error('Error during tracing:', tracingError);
      console.log('Continuing with other metrics...');
    }
    
    // Use Chrome's built-in FPS counter to estimate rendering performance
    const fpsData = await page.evaluate(() => {
      return new Promise(resolve => {
        let frameCount = 0;
        const startTime = performance.now();
        const checkFPS = () => {
          frameCount++;
          const elapsedTime = performance.now() - startTime;
          
          if (elapsedTime >= 3000) { // Measure for 3 seconds
            const fps = (frameCount / elapsedTime) * 1000;
            resolve({ fps, frameCount, elapsedTime });
          } else {
            requestAnimationFrame(checkFPS);
          }
        };
        requestAnimationFrame(checkFPS);
      });
    });
    
    console.log('FPS Measurement:', fpsData);
    
    // Collect memory information
    const memoryInfo = await page.evaluate(() => {
      if (performance && performance.memory) {
        return {
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          usedJSHeapSize: performance.memory.usedJSHeapSize
        };
      }
      return { error: 'Memory info not available' };
    });
    
    console.log('Memory Info:', memoryInfo);
    
    // Collect additional GPU-related info via Chrome GPU info page
    let gpuInfoFromChrome = {};
    try {
      await page.goto('chrome://gpu', { waitUntil: 'networkidle0' });
      gpuInfoFromChrome = await page.evaluate(() => {
        const container = document.querySelector('.feature-status-container');
        if (!container) return { error: 'GPU info container not found' };
        
        const rows = container.querySelectorAll('tbody tr');
        const gpuInfo = {};
        
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const feature = cells[0].textContent.trim();
            const status = cells[1].textContent.trim();
            gpuInfo[feature] = status;
          }
        });
        
        return gpuInfo;
      });
      
      console.log('Chrome GPU Info:', gpuInfoFromChrome);
    } catch (gpuInfoError) {
      console.error('Error getting Chrome GPU info:', gpuInfoError);
    }
    
    // Go back to the WebGL page
    await page.goto(WEBGL_URL, { waitUntil: 'networkidle0' });
    
    // Compile all the collected data
    const profileData = {
      performanceMetrics: performanceMetrics.metrics,
      gpuInfo,
      fpsData,
      memoryInfo,
      gpuInfoFromChrome,
      timestamp: new Date().toISOString()
    };
    
    // Save the profiling results
    fs.writeFileSync('webgl-profile-results.json', JSON.stringify(profileData, null, 2));
    console.log('Complete profile data saved to webgl-profile-results.json');
    
    return profileData;
  } catch (error) {
    console.error('Error during profiling:', error);
  } finally {
    // Close the browser
    await browser.close();
    console.log('Browser closed, profiling complete.');
  }
}

// Run the profiling
profileWebGLPerformance()
  .then(results => console.log('Profiling completed successfully'))
  .catch(err => console.error('Profiling failed:', err));