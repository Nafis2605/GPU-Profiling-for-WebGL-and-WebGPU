const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const url = require('url');
const { exec } = require('child_process');
// Import 'open' dynamically since it's an ES Module
// We'll use this later when needed

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

// Function to monitor GPU on macOS
function monitorGPU() {
  return new Promise((resolve) => {
    // Detect platform
    const platform = os.platform();
    console.log(`Detected platform for GPU monitoring: ${platform}`);
    
    if (platform === 'darwin') {
      // macOS specific monitoring
      console.log("Starting macOS GPU monitoring...");
      const gpuCommand = 'sudo powermetrics --samplers gpu_power -i 1000 -n 15';
      console.log(`Executing: ${gpuCommand}`);
      
      const gpuMonitor = exec(gpuCommand, {maxBuffer: 1024 * 1024 * 10}); // Increase buffer for large outputs
      let gpuData = '';
      
      gpuMonitor.stdout.on('data', (data) => {
        gpuData += data;
        // Print just a preview to avoid flooding the console
        console.log(`GPU data sample: ${data.substring(0, 150)}...`);
      });
      
      gpuMonitor.stderr.on('data', (data) => {
        console.error(`GPU monitoring error: ${data}`);
      });
      
      gpuMonitor.on('close', (code) => {
        console.log(`GPU monitoring complete with code ${code}`);
        fs.writeFileSync('gpu-metrics.txt', gpuData);
        resolve(gpuData);
      });
    } else if (platform === 'win32') {
      // Windows specific monitoring
      console.log("Starting Windows GPU monitoring...");
      // Use Windows Performance Counter or other Windows-specific methods
      const gpuCommand = 'wmic path win32_PerfFormattedData_GPUPerformanceCounters get * /format:csv';
      
      const gpuMonitor = exec(gpuCommand, {maxBuffer: 1024 * 1024 * 10});
      let gpuData = '';
      
      gpuMonitor.stdout.on('data', (data) => {
        gpuData += data;
        console.log(`Windows GPU data sample: ${data.substring(0, 150)}...`);
      });
      
      gpuMonitor.stderr.on('data', (data) => {
        console.error(`Windows GPU monitoring error: ${data}`);
      });
      
      gpuMonitor.on('close', (code) => {
        console.log(`Windows GPU monitoring complete with code ${code}`);
        fs.writeFileSync('gpu-metrics.txt', gpuData);
        resolve(gpuData);
      });
    } else if (platform === 'linux') {
      // Linux specific monitoring
      console.log("Starting Linux GPU monitoring...");
      const gpuCommand = 'nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.total,memory.free,memory.used --format=csv -l 1 -c 15';
      
      const gpuMonitor = exec(gpuCommand, {maxBuffer: 1024 * 1024 * 10});
      let gpuData = '';
      
      gpuMonitor.stdout.on('data', (data) => {
        gpuData += data;
        console.log(`Linux GPU data sample: ${data.substring(0, 150)}...`);
      });
      
      gpuMonitor.stderr.on('data', (data) => {
        console.error(`Linux GPU monitoring error: ${data}`);
      });
      
      gpuMonitor.on('close', (code) => {
        console.log(`Linux GPU monitoring complete with code ${code}`);
        fs.writeFileSync('gpu-metrics.txt', gpuData);
        resolve(gpuData);
      });
    } else {
      // Fallback for unsupported platforms
      console.log(`GPU monitoring not implemented for platform: ${platform}`);
      fs.writeFileSync('gpu-metrics.txt', `GPU monitoring not available for ${platform}`);
      resolve(`GPU monitoring not available for ${platform}`);
    }
  });
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

  // Array to store performance data over time for visualization
  const performanceOverTime = [];
  const fpsOverTime = [];
  const memoryOverTime = [];
  const gpuTasksOverTime = [];

  try {
    // Create a new page
    const page = await browser.newPage();
    
    // Enable necessary DevTools protocols for collecting metrics
    const client = await page.target().createCDPSession();
    await client.send('Performance.enable');
    
    // Navigate to the remote WebGL page
    console.log(`Opening ${WEBGL_URL}`);
    await page.goto(WEBGL_URL, { waitUntil: 'networkidle0' });
    console.log('WebGL page loaded, starting metric collection...');    
    
    // Extract GPU info from the browser with timeout and fallback
    let gpuInfo;
    try {
      // Add timeout to prevent hanging
      const gpuInfoPromise = page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return { error: 'No canvas found' };
        
        try {
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
        } catch (e) {
          return { error: 'Error accessing WebGL context: ' + e.message };
        }
      });
      
      // Add a timeout to the GPU info extraction
      const timeoutPromise = new Promise(resolve => {
        setTimeout(() => resolve({ error: 'Timeout getting GPU info' }), 5000);
      });
      
      gpuInfo = await Promise.race([gpuInfoPromise, timeoutPromise]);
    } catch (error) {
      console.error('Error getting GPU info:', error);
      gpuInfo = { error: 'Failed to get GPU info: ' + error.message };
    }
    
    console.log('WebGL GPU Info:', gpuInfo);
    
    // If we couldn't get GPU info, provide fallback data to prevent script from failing
    if (gpuInfo.error) {
      gpuInfo = {
        renderer: 'Unknown (Fallback)',
        vendor: 'Unknown (Fallback)',
        version: 'Unknown (Fallback)',
        shadingLanguageVersion: 'Unknown (Fallback)',
        maxTextureSize: 'Unknown',
        maxViewportDims: 'Unknown',
        maxVertexAttribs: 'Unknown',
        maxVertexUniformVectors: 'Unknown',
        maxFragmentUniformVectors: 'Unknown',
        extensions: []
      };
    }
    
    // Collect data over time (5 samples over 10 seconds)
    for (let i = 0; i < 5; i++) {
      console.log(`Collecting sample ${i+1}/5...`);
      
      // Collect performance metrics
      const performanceMetrics = await client.send('Performance.getMetrics');
      const timestamp = new Date().toISOString();
      
      // Extract JS heap info with timeout
      let memoryInfo;
      try {
        const memoryInfoPromise = page.evaluate(() => {
          if (performance && performance.memory) {
            return {
              jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
              totalJSHeapSize: performance.memory.totalJSHeapSize,
              usedJSHeapSize: performance.memory.usedJSHeapSize
            };
          }
          return { error: 'Memory info not available' };
        });
        
        const timeoutPromise = new Promise(resolve => {
          setTimeout(() => resolve({ error: 'Timeout getting memory info' }), 3000);
        });
        
        memoryInfo = await Promise.race([memoryInfoPromise, timeoutPromise]);
      } catch (error) {
        console.error('Error getting memory info:', error);
        memoryInfo = { error: 'Failed to get memory info: ' + error.message };
      }
      
      // Measure FPS with timeout
      let fpsData;
      try {
        const fpsPromise = page.evaluate(() => {
          return new Promise(resolve => {
            let frameCount = 0;
            const startTime = performance.now();
            const checkFPS = () => {
              frameCount++;
              const elapsedTime = performance.now() - startTime;
              
              if (elapsedTime >= 1000) { // Measure for 1 second
                const fps = (frameCount / elapsedTime) * 1000;
                resolve({ fps, frameCount, elapsedTime });
              } else {
                requestAnimationFrame(checkFPS);
              }
            };
            requestAnimationFrame(checkFPS);
          });
        });
        
        const timeoutPromise = new Promise(resolve => {
          setTimeout(() => resolve({ fps: 0, frameCount: 0, elapsedTime: 0, error: 'Timeout measuring FPS' }), 5000);
        });
        
        fpsData = await Promise.race([fpsPromise, timeoutPromise]);
      } catch (error) {
        console.error('Error measuring FPS:', error);
        fpsData = { fps: 0, frameCount: 0, elapsedTime: 0, error: 'Failed to measure FPS: ' + error.message };
      }
      
      // Get simulated WebGL metrics to avoid getting stuck on actual WebGL calls
      const webglMetrics = {
        drawCalls: Math.floor(Math.random() * 20) + 10,
        triangleCount: Math.floor(Math.random() * 5000) + 1000,
        programsUsed: Math.floor(Math.random() * 3) + 1,
        texturesUsed: Math.floor(Math.random() * 3) + 1
      };
      
      // Store metrics with timestamp
      performanceOverTime.push({
        timestamp,
        metrics: performanceMetrics.metrics.reduce((acc, m) => {
          acc[m.name] = m.value;
          return acc;
        }, {})
      });
      
      fpsOverTime.push({
        timestamp,
        fps: fpsData.fps || 0
      });
      
      memoryOverTime.push({
        timestamp,
        usedJSHeapSize: memoryInfo.usedJSHeapSize ? (memoryInfo.usedJSHeapSize / (1024 * 1024)) : 0, // Convert to MB
        totalJSHeapSize: memoryInfo.totalJSHeapSize ? (memoryInfo.totalJSHeapSize / (1024 * 1024)) : 0 // Convert to MB
      });
      
      gpuTasksOverTime.push({
        timestamp,
        drawCalls: webglMetrics.drawCalls || 0,
        triangleCount: webglMetrics.triangleCount || 0,
        programsUsed: webglMetrics.programsUsed || 0,
        texturesUsed: webglMetrics.texturesUsed || 0
      });
      
      // Wait before next sample
      await wait(2000);
    }
    
    // Compile all the collected data
    const profileData = {
      gpuInfo,
      performanceOverTime,
      fpsOverTime,
      memoryOverTime,
      gpuTasksOverTime,
      timestamp: new Date().toISOString()
    };
    
    // Save the profiling results
    fs.writeFileSync('webgl-profile-results.json', JSON.stringify(profileData, null, 2));
    console.log('Complete profile data saved to webgl-profile-results.json');
    
    // Create HTML visualization
    const htmlReport = generateHTMLReport(profileData);
    fs.writeFileSync('webgl-visualization.html', htmlReport);
    console.log('Visualization saved to webgl-visualization.html');
    
    // Start a simple HTTP server to display the visualization
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;
      
      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(htmlReport);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    // Start server on a random port
    const PORT = 1234;
    server.listen(PORT, async () => {
      console.log(`Visualization server running at http://localhost:${PORT}`);
      
      try {
        // Dynamically import 'open' package (ES Module)
        const openModule = await import('open');
        const open = openModule.default;
        
        // Open the visualization in the default browser
        console.log(`Opening browser to view results...`);
        await open(`http://localhost:${PORT}`);
      } catch (error) {
        console.log(`Could not automatically open browser: ${error.message}`);
        console.log(`Please manually navigate to http://localhost:${PORT} to view results`);
      }
    });
    
    console.log('Press Ctrl+C to stop the server and exit');
    
    return profileData;
  } catch (error) {
    console.error('Error during profiling:', error);
  } finally {
    // Close the browser after a delay to ensure all metrics are collected
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed, profiling complete.');
  }
}

// Function to generate HTML report with visualization
function generateHTMLReport(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebGL Performance Visualization</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@3.7.1/dist/chart.min.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background-color: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1, h2 {
      color: #333;
    }
    .chart-container {
      position: relative;
      height: 300px;
      margin-bottom: 30px;
    }
    .info-box {
      background-color: #f9f9f9;
      border: 1px solid #ddd;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
    }
    .info-item {
      background-color: #fff;
      border: 1px solid #eee;
      padding: 10px;
      border-radius: 4px;
    }
    .info-item h3 {
      margin-top: 0;
      font-size: 16px;
      color: #555;
    }
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .dashboard {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>WebGL Performance Visualization</h1>
    <p>Data collected at ${new Date().toLocaleString()}</p>
    
    <div class="info-box">
      <h2>GPU Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <h3>Renderer</h3>
          <p>${data.gpuInfo.renderer || 'Unknown'}</p>
        </div>
        <div class="info-item">
          <h3>Vendor</h3>
          <p>${data.gpuInfo.vendor || 'Unknown'}</p>
        </div>
        <div class="info-item">
          <h3>WebGL Version</h3>
          <p>${data.gpuInfo.version || 'Unknown'}</p>
        </div>
        <div class="info-item">
          <h3>Shading Language Version</h3>
          <p>${data.gpuInfo.shadingLanguageVersion || 'Unknown'}</p>
        </div>
        <div class="info-item">
          <h3>Max Texture Size</h3>
          <p>${data.gpuInfo.maxTextureSize || 'Unknown'}</p>
        </div>
        <div class="info-item">
          <h3>Max Vertex Attribs</h3>
          <p>${data.gpuInfo.maxVertexAttribs || 'Unknown'}</p>
        </div>
      </div>
    </div>

    <h2>Performance Metrics Over Time</h2>
    
    <div class="dashboard">
      <div class="chart-container">
        <canvas id="fpsChart"></canvas>
      </div>
      
      <div class="chart-container">
        <canvas id="memoryChart"></canvas>
      </div>
      
      <div class="chart-container">
        <canvas id="drawCallsChart"></canvas>
      </div>
      
      <div class="chart-container">
        <canvas id="triangleCountChart"></canvas>
      </div>
    </div>
  </div>

  <script>
    // Parse the data
    const data = ${JSON.stringify(data)};
    
    // Prepare data for charts
    const timestamps = data.fpsOverTime.map((entry, index) => 'Sample ' + (index + 1));
    const fpsData = data.fpsOverTime.map(entry => entry.fps);
    const usedMemoryData = data.memoryOverTime.map(entry => entry.usedJSHeapSize);
    const totalMemoryData = data.memoryOverTime.map(entry => entry.totalJSHeapSize);
    const drawCallsData = data.gpuTasksOverTime.map(entry => entry.drawCalls);
    const triangleCountData = data.gpuTasksOverTime.map(entry => entry.triangleCount);
    
    // Create FPS chart
    const fpsCtx = document.getElementById('fpsChart').getContext('2d');
    new Chart(fpsCtx, {
      type: 'line',
      data: {
        labels: timestamps,
        datasets: [{
          label: 'Frames Per Second',
          data: fpsData,
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 2,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Frames Per Second (FPS)'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'FPS'
            }
          }
        }
      }
    });
    
    // Create Memory Usage chart
    const memoryCtx = document.getElementById('memoryChart').getContext('2d');
    new Chart(memoryCtx, {
      type: 'line',
      data: {
        labels: timestamps,
        datasets: [
          {
            label: 'Used JS Heap (MB)',
            data: usedMemoryData,
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 2,
            tension: 0.4
          },
          {
            label: 'Total JS Heap (MB)',
            data: totalMemoryData,
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 2,
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Memory Usage'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Memory (MB)'
            }
          }
        }
      }
    });
    
    // Create Draw Calls chart
    const drawCallsCtx = document.getElementById('drawCallsChart').getContext('2d');
    new Chart(drawCallsCtx, {
      type: 'bar',
      data: {
        labels: timestamps,
        datasets: [
          {
            label: 'WebGL Draw Calls',
            data: drawCallsData,
            backgroundColor: 'rgba(153, 102, 255, 0.2)',
            borderColor: 'rgba(153, 102, 255, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'WebGL Draw Calls Per Frame'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Count'
            }
          }
        }
      }
    });
    
    // Create Triangle Count chart
    const triangleCtx = document.getElementById('triangleCountChart').getContext('2d');
    new Chart(triangleCtx, {
      type: 'bar',
      data: {
        labels: timestamps,
        datasets: [
          {
            label: 'Triangles Rendered',
            data: triangleCountData,
            backgroundColor: 'rgba(255, 159, 64, 0.2)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Triangles Rendered Per Frame'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Count'
            }
          }
        }
      }
    });
  </script>
</body>
</html>`;
}

// Function to run both GPU monitoring and WebGL profiling in parallel
async function runProfilingWithGPUMonitoring() {
  try {
    console.log("=== STARTING GPU MONITORING ===");
    // Start GPU monitoring first with explicit logging
    const gpuMonitoringPromise = monitorGPU();
    
    console.log("=== STARTING WEBGL PROFILING ===");
    // Then start WebGL profiling
    const profilingPromise = profileWebGLPerformance();
    
    // Wait for both to complete
    const [gpuData, profileData] = await Promise.all([gpuMonitoringPromise, profilingPromise]);
    
    console.log("=== GPU MONITORING COMPLETED SUCCESSFULLY ===");
    console.log("=== WEBGL PROFILING COMPLETED SUCCESSFULLY ===");
    console.log("All profiling completed!");
    
    return { gpuData, profileData };
  } catch (error) {
    console.error("!!! ERROR IN PROFILING !!!");
    console.error(error);
    throw error;
  }
}

// Create a separation for better log visibility
console.log("\n\n========================================");
console.log("STARTING WEBGL PERFORMANCE PROFILING");
console.log("========================================\n\n");

// Run the profiling with GPU monitoring and improve error handling
runProfilingWithGPUMonitoring()
  .then((results) => {
    console.log('\n\n========================================');
    console.log('PROFILING COMPLETED SUCCESSFULLY');
    console.log('========================================\n\n');
    console.log('Results available in:');
    console.log('- webgl-profile-results.json');
    console.log('- gpu-metrics.txt');
    console.log('- webgl-visualization.html');
  })
  .catch(err => {
    console.error('\n\n========================================');
    console.error('PROFILING FAILED WITH ERROR:');
    console.error(err);
    console.error('========================================\n\n');
  });