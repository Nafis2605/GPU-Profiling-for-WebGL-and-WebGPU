const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const http = require('http');
const url = require('url');
const { exec } = require('child_process');

// Path to your WebGL HTML file
const WEBGL_URL = 'http://127.0.0.1:5500/'; //Change to your local server URL or file path
// const WEBGL_URL = 'file://' + path.join(__dirname, 'your_webgl_file.html'); // For local files
// const WEBGL_URL = 'http://localhost:8080/your_webgl_file.html'; // For local server
// const WEBGL_URL = 'http://example.com/your_webgl_file.html'; // For remote files
// const WEBGL_URL = 'https://example.com/your_webgl_file.html'; // For HTTPS remote files

// Determine Chrome path based on platform (Windows only in this version)
function getChromePath() {
  const platform = os.platform();
  let chromePath;
  if (platform === 'win32') {
    // Adjust path if needed.
    // For example, if you have Chrome Dev installed in a different folder:
    chromePath = 'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe';
  } else {
    // For non-Windows, let Puppeteer decide or provide a default path.
    // You can also use the following line to get the default Chrome path on macOS/Linux:
    // chromePath = '/usr/bin/google-chrome'; // Example for Linux
    // chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; // Example for macOS
    // Note: Uncomment and adjust the above lines for macOS/Linux if needed.
    // For now, we set it to null to indicate no specific path is set.
    chromePath = null;
  }
  console.log(`Detected platform: ${platform}`);
  console.log(`Using Chrome path: ${chromePath}`);
  return chromePath;
}

// Helper function for waiting
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs a command and returns a promise with its stdout.
 */
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Sample GPU metrics and return a JSON object with only the desired fields:
 * - timestamp
 * - clocks: { graphics, memory, sm }
 * - utilization: { gpu, memory, total, free, used }
 * - power: { draw, limit, default_limit, min_limit, max_limit }
 */

async function sampleGpuMetricsJSON() {
  const timestamp = new Date().toISOString();

  // Clocks query
  const clocksCmd = 'nvidia-smi --query-gpu=clocks.gr,clocks.mem,clocks.sm --format=csv';
  const clocksOut = await runCommand(clocksCmd);
  const clocksLines = clocksOut.split(/\r?\n/).filter(l => l.trim().length);
  if (clocksLines.length < 2) {
    console.error("Unexpected output from clocks query:", clocksOut);
    return null;
  }
  const clocksValues = clocksLines[1].split(',').map(v => v.trim());
  const clocks = {
    graphics: parseInt(clocksValues[0].replace(/[^\d]/g, '')),
    memory:   parseInt(clocksValues[1].replace(/[^\d]/g, '')),
    sm:       parseInt(clocksValues[2].replace(/[^\d]/g, ''))
  };

  // dmon query with extra logging and error checking
  // Note: dmon may not be available on all GPUs or drivers.
  // It may also require root privileges to run.
  let dmon = { sm: 0, mem: 0, enc: 0, dec: 0, jpg: 0, ofa: 0 };
  try {
    const dmonCmd = 'nvidia-smi dmon -s u -d 1 -c 1';
    const dmonOut = await runCommand(dmonCmd);
    const dmonLines = dmonOut.split(/\r?\n/).filter(l => l.trim().length && !l.trim().startsWith('#'));
    if (dmonLines.length > 0) {
      const dmonValues = dmonLines[0].trim().split(/\s+/);
      if (dmonValues.length >= 7) {
        dmon = {
          sm: parseFloat(dmonValues[1]) || 0,
          mem: parseFloat(dmonValues[2]) || 0,
          enc: parseFloat(dmonValues[3]) || 0,
          dec: parseFloat(dmonValues[4]) || 0,
          jpg: parseFloat(dmonValues[5]) || 0,
          ofa: parseFloat(dmonValues[6]) || 0
        };
      } else {
        console.error("Unexpected output format from dmon:", dmonOut);
      }
    } else {
      console.error("No dmon data returned.");
    }
  } catch (e) {
    console.error("Error executing dmon command:", e);
  }

  // Utilization query
  // Note: The utilization query may not be available on all GPUs or drivers.
  const utilCmd = 'nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.total,memory.free,memory.used --format=csv';
  const utilOut = await runCommand(utilCmd);
  const utilLines = utilOut.split(/\r?\n/).filter(l => l.trim().length);
  if (utilLines.length < 2) {
    console.error("Unexpected output from utilization query:", utilOut);
    return null;
  }
  const utilValues = utilLines[1].split(',').map(v => v.trim());
  const utilization = {
    gpu:    parseInt(utilValues[0].replace(/[^\d]/g, '')),
    memory: parseInt(utilValues[1].replace(/[^\d]/g, '')),
    total:  parseInt(utilValues[2].replace(/[^\d]/g, '')),
    free:   parseInt(utilValues[3].replace(/[^\d]/g, '')),
    used:   parseInt(utilValues[4].replace(/[^\d]/g, ''))
  };

  // Power query
  // Note: The power query may not be available on all GPUs or drivers.
  const powerCmd = 'nvidia-smi --query-gpu=power.draw,power.limit,power.default_limit,power.min_limit,power.max_limit --format=csv';
  const powerOut = await runCommand(powerCmd);
  const powerLines = powerOut.split(/\r?\n/).filter(l => l.trim().length);
  if (powerLines.length < 2) {
    console.error("Unexpected output from power query:", powerOut);
    return null;
  }
  const powerValues = powerLines[1].split(',').map(v => v.trim());
  const power = {
    draw:          parseFloat(powerValues[0].replace(/[^\d\.]/g, '')),
    limit:         parseFloat(powerValues[1].replace(/[^\d\.]/g, '')),
    default_limit: parseFloat(powerValues[2].replace(/[^\d\.]/g, '')),
    min_limit:     parseFloat(powerValues[3].replace(/[^\d\.]/g, '')),
    max_limit:     parseFloat(powerValues[4].replace(/[^\d\.]/g, ''))
  };

  return { timestamp, clocks, dmon, utilization, power };
}

// Unified profiling function (Windows only)
// This function launches Chrome Dev, collects GPU metrics, and generates HTML reports.
// It also starts an HTTP server to serve the generated HTML report.
async function profileWebGLPerformance() {
  console.log('Starting WebGL profiling...');
  
  const chromePath = getChromePath();
  const browser = await puppeteer.launch({
    headless: false, // Headful is required for GPU rendering
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

  // Arrays to store collected data
  const gpuMetricsSamples = []; // Array of GPU metrics JSON objects
  const performanceSamples = [];
  const fpsSamples = [];
  const memorySamples = [];
  const gpuTaskSamples = [];
  
  try {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Performance.enable');
    
    console.log(`Opening ${WEBGL_URL}`);
    await page.goto(WEBGL_URL, { waitUntil: 'networkidle0', timeout: 3000000 });
    console.log('WebGL page loaded, starting metric collection...');
    
    // Loop until the webpage signals completion.
    // Ensure your webpage sets window.operationComplete = true when done.
    while (true) {
      const opDone = await page.evaluate(() => window.operationComplete === true);
      const sample = await sampleGpuMetricsJSON();
      if (sample) {
        gpuMetricsSamples.push(sample);
        console.log(`Collected GPU sample at ${sample.timestamp}`);
      }
      
      // Collect WebGL performance metrics
      const perfMetrics = await client.send('Performance.getMetrics');
      performanceSamples.push({
        timestamp: new Date().toISOString(),
        metrics: perfMetrics.metrics.reduce((acc, m) => { acc[m.name] = m.value; return acc; }, {})
      });
      
      // Measure FPS (sample over 1 second)
      let fpsData;
      try {
        fpsData = await page.evaluate(() => {
          return new Promise(resolve => {
            let frameCount = 0;
            const startTime = performance.now();
            function checkFPS() {
              frameCount++;
              const elapsed = performance.now() - startTime;
              if (elapsed >= 1000) {
                resolve({ fps: (frameCount / elapsed) * 1000, frameCount, elapsed });
              } else {
                requestAnimationFrame(checkFPS);
              }
            }
            requestAnimationFrame(checkFPS);
          });
        });
      } catch (err) {
        fpsData = { fps: 0, frameCount: 0, elapsed: 0, error: err.message };
      }
      fpsSamples.push({ timestamp: new Date().toISOString(), ...fpsData });
      
      // Get JS memory usage
      let memData;
      try {
        memData = await page.evaluate(() => {
          if (performance && performance.memory) {
            return {
              jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
              totalJSHeapSize: performance.memory.totalJSHeapSize,
              usedJSHeapSize: performance.memory.usedJSHeapSize
            };
          }
          return { error: 'Memory info not available' };
        });
      } catch (err) {
        memData = { error: err.message };
      }
      memorySamples.push({ timestamp: new Date().toISOString(), memory: memData });
      
      // Simulated WebGL task metrics (replace with real data if available)
      const simulatedWebGL = {
        drawCalls: Math.floor(Math.random() * 20) + 10,
        triangleCount: Math.floor(Math.random() * 5000) + 1000,
        programsUsed: Math.floor(Math.random() * 3) + 1,
        texturesUsed: Math.floor(Math.random() * 3) + 1
      };
      gpuTaskSamples.push({ timestamp: new Date().toISOString(), ...simulatedWebGL });
      
      if (opDone) {
        console.log('Operation complete signal received from the webpage.');
        break;
      }
      
      // Wait before next sample (adjust interval as needed)
      await wait(1000);
    }
    
    // Write the GPU metrics samples to a JSON file
    fs.writeFileSync('gpu-metrics.json', JSON.stringify(gpuMetricsSamples, null, 2));
    console.log('GPU metrics saved to gpu-metrics.json');
    
    // Save the WebGL profiling results (other metrics)
    const profileData = {
      performanceSamples,
      fpsSamples,
      memorySamples,
      gpuTaskSamples,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync('cpu-metrics.json', JSON.stringify(profileData, null, 2));
    console.log('WebGL profile results saved to cpu-metrics.json');
    
    // Generate HTML visualization using the JSON data
    const htmlReport = generateHTMLReportWithGpuJSON(profileData, 'gpu-metrics.json');
    fs.writeFileSync('webgl-visualization.html', htmlReport);
    console.log('Visualization saved to webgl-visualization.html');
    
    // Start an HTTP server to display the visualization
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(htmlReport);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    const PORT = 1234;
    server.listen(PORT, async () => {
      console.log(`Visualization server running at http://localhost:${PORT}`);
      try {
        const openModule = await import('open');
        const open = openModule.default;
        console.log('Opening browser to view results...');
        await open(`http://localhost:${PORT}`);
      } catch (error) {
        console.log(`Could not open browser automatically: ${error.message}`);
        console.log(`Please navigate to http://localhost:${PORT} manually.`);
      }
    });
    
    console.log('Press Ctrl+C to stop the server and exit');
    return profileData;
  } catch (error) {
    console.error('Error during profiling:', error);
  } finally {
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed, profiling complete.');
  }
}

/**
 * Generates an HTML report using the GPU metrics JSON file and the WebGL profile results.
 * The GPU JSON file is read and its values are used directly to build charts.
 */
function generateHTMLReportWithGpuJSON(webglData, gpuJsonFile) {
  const gpuData = JSON.parse(fs.readFileSync(gpuJsonFile, 'utf8'));
  // Extract GPU timestamps (local time strings)
  const timestamps = gpuData.map(s => new Date(s.timestamp).toLocaleTimeString());

  // Clocks arrays
  const clocksGraphics = gpuData.map(s => s.clocks.graphics || 0);
  const clocksMemory   = gpuData.map(s => s.clocks.memory || 0);
  const clocksSm       = gpuData.map(s => s.clocks.sm || 0);

  // dmon arrays
  const dmonSm  = gpuData.map(s => s.dmon ? (s.dmon.sm || 0) : 0);
  const dmonMem = gpuData.map(s => s.dmon ? (s.dmon.mem || 0) : 0);
  const dmonEnc = gpuData.map(s => s.dmon ? (s.dmon.enc || 0) : 0);
  const dmonDec = gpuData.map(s => s.dmon ? (s.dmon.dec || 0) : 0);
  const dmonJpg = gpuData.map(s => s.dmon ? (s.dmon.jpg || 0) : 0);
  const dmonOfa = gpuData.map(s => s.dmon ? (s.dmon.ofa || 0) : 0);

  // Utilization arrays
  const utilGpu    = gpuData.map(s => s.utilization.gpu || 0);
  const utilMemory = gpuData.map(s => s.utilization.memory || 0);
  const memTotal   = gpuData.map(s => s.utilization.total || 0);
  const memFree    = gpuData.map(s => s.utilization.free || 0);
  const memUsed    = gpuData.map(s => s.utilization.used || 0);

  // Power arrays
  const powerDraw          = gpuData.map(s => s.power.draw || 0);
  const powerLimit         = gpuData.map(s => s.power.limit || 0);
  const powerDefaultLimit  = gpuData.map(s => s.power.default_limit || 0);
  const powerMinLimit      = gpuData.map(s => s.power.min_limit || 0);
  const powerMaxLimit      = gpuData.map(s => s.power.max_limit || 0);

  // Load CPU metrics from cpu-metrics.json
  const cpuData = JSON.parse(fs.readFileSync('cpu-metrics.json', 'utf8'));
  const cpuSamples = cpuData.memorySamples || [];
  const cpuTimestamps = cpuSamples.map(s => new Date(s.timestamp).toLocaleTimeString());
  const jsHeapSizeLimit = cpuSamples.map(s => s.memory.jsHeapSizeLimit);
  const totalJSHeapSize = cpuSamples.map(s => s.memory.totalJSHeapSize);
  const usedJSHeapSize = cpuSamples.map(s => s.memory.usedJSHeapSize);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebGL and GPU Performance Visualization</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@3.7.1/dist/chart.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1400px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; }
    h1, h2 { color: #333; }
    .chart-container { width: 100%; height: 300px; margin-bottom: 30px; }
    .section { margin-bottom: 40px; }
    .grid { display: flex; flex-wrap: wrap; gap: 20px; }
    .grid .chart-container { flex: 1 1 45%; }
  </style>
</head>
<body>
  <div class="container">
    <h1>GPU Performance Visualization</h1>
    <p>Data collected at ${new Date().toLocaleString()}</p>
    
    <!-- FPS Chart Section -->
    <div class="section">
      <h2>FPS</h2>
      <div class="chart-container">
        <canvas id="fpsChart"></canvas>
      </div>
    </div>

    <!-- CPU Memory Metrics Chart Section -->
    <div class="section">
      <h2>CPU Memory Metrics (JS Heap)</h2>
      <div class="chart-container">
        <canvas id="cpuMemoryChart"></canvas>
      </div>
    </div>
    
    <!-- GPU Clocks Section -->
    <div class="section">
      <h2>GPU Clocks (MHz)</h2>
      <div class="grid">
        <div class="chart-container"><canvas id="clocksGraphicsChart"></canvas></div>
        <div class="chart-container"><canvas id="clocksMemoryChart"></canvas></div>
        <div class="chart-container"><canvas id="clocksSmChart"></canvas></div>
      </div>
    </div>
    
    <!-- GPU dmon Metrics Section -->
    <div class="section">
      <h2>GPU dmon Metrics (%)</h2>
      <div class="grid">
        <div class="chart-container"><canvas id="dmonSmChart"></canvas></div>
        <div class="chart-container"><canvas id="dmonMemChart"></canvas></div>
        <div class="chart-container"><canvas id="dmonEncChart"></canvas></div>
        <div class="chart-container"><canvas id="dmonDecChart"></canvas></div>
        <div class="chart-container"><canvas id="dmonJpgChart"></canvas></div>
        <div class="chart-container"><canvas id="dmonOfaChart"></canvas></div>
      </div>
    </div>
    
    <!-- GPU Utilization & Memory Section -->
    <div class="section">
      <h2>GPU Utilization and Memory</h2>
      <div class="grid">
        <div class="chart-container"><canvas id="utilGpuChart"></canvas></div>
        <div class="chart-container"><canvas id="utilMemoryChart"></canvas></div>
        <div class="chart-container"><canvas id="memoryTotalChart"></canvas></div>
        <div class="chart-container"><canvas id="memoryFreeChart"></canvas></div>
        <div class="chart-container"><canvas id="memoryUsedChart"></canvas></div>
      </div>
    </div>
    
    <!-- GPU Power Metrics Section -->
    <div class="section">
      <h2>GPU Power Metrics (W)</h2>
      <div class="grid">
        <div class="chart-container"><canvas id="powerDrawChart"></canvas></div>
        <div class="chart-container"><canvas id="powerLimitChart"></canvas></div>
        <div class="chart-container"><canvas id="powerDefaultLimitChart"></canvas></div>
        <div class="chart-container"><canvas id="powerMinLimitChart"></canvas></div>
        <div class="chart-container"><canvas id="powerMaxLimitChart"></canvas></div>
      </div>
    </div>
  </div>
  
  <script>
    // Helper function to create a chart
    function createChart(canvasId, label, data, borderColor) {
      new Chart(document.getElementById(canvasId).getContext('2d'), {
        type: 'line',
        data: { labels: ${JSON.stringify(timestamps)}, datasets: [{ label: label, data: data, borderColor: borderColor, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
    
    // FPS Chart (using webglData.fpsSamples)
    const fpsTimestamps = ${JSON.stringify(webglData.fpsSamples.map((s, i) => 'Sample ' + (i + 1)))}; 
    const fpsData = ${JSON.stringify(webglData.fpsSamples.map(s => s.fps))};
    new Chart(document.getElementById('fpsChart').getContext('2d'), {
      type: 'line',
      data: { labels: fpsTimestamps, datasets: [{ label: 'FPS', data: fpsData, borderColor: 'green', fill: false }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
    
    // CPU Memory Metrics Chart
    const cpuTimestamps = ${JSON.stringify(cpuTimestamps)};
    new Chart(document.getElementById('cpuMemoryChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: cpuTimestamps,
        datasets: [
          { label: 'jsHeapSizeLimit', data: ${JSON.stringify(jsHeapSizeLimit)}, borderColor: 'blue', fill: false },
          { label: 'totalJSHeapSize', data: ${JSON.stringify(totalJSHeapSize)}, borderColor: 'orange', fill: false },
          { label: 'usedJSHeapSize', data: ${JSON.stringify(usedJSHeapSize)}, borderColor: 'red', fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
    
    // Clocks
    createChart('clocksGraphicsChart', 'Graphics Clock (MHz)', ${JSON.stringify(clocksGraphics)}, 'blue');
    createChart('clocksMemoryChart', 'Memory Clock (MHz)', ${JSON.stringify(clocksMemory)}, 'orange');
    createChart('clocksSmChart', 'SM Clock (MHz)', ${JSON.stringify(clocksSm)}, 'purple');
    
    // dmon Metrics
    createChart('dmonSmChart', 'dmon SM (%)', ${JSON.stringify(dmonSm)}, 'red');
    createChart('dmonMemChart', 'dmon Memory (%)', ${JSON.stringify(dmonMem)}, 'brown');
    createChart('dmonEncChart', 'dmon ENC (%)', ${JSON.stringify(dmonEnc)}, 'magenta');
    createChart('dmonDecChart', 'dmon DEC (%)', ${JSON.stringify(dmonDec)}, 'cyan');
    createChart('dmonJpgChart', 'dmon JPG (%)', ${JSON.stringify(dmonJpg)}, 'teal');
    createChart('dmonOfaChart', 'dmon OFA (%)', ${JSON.stringify(dmonOfa)}, 'gray');
    
    // Utilization & Memory
    createChart('utilGpuChart', 'GPU Utilization (%)', ${JSON.stringify(utilGpu)}, 'blue');
    createChart('utilMemoryChart', 'Memory Utilization (%)', ${JSON.stringify(utilMemory)}, 'orange');
    createChart('memoryTotalChart', 'Total Memory (MiB)', ${JSON.stringify(memTotal)}, 'purple');
    createChart('memoryFreeChart', 'Free Memory (MiB)', ${JSON.stringify(memFree)}, 'green');
    createChart('memoryUsedChart', 'Used Memory (MiB)', ${JSON.stringify(memUsed)}, 'red');
    
    // Power Metrics
    createChart('powerDrawChart', 'Power Draw (W)', ${JSON.stringify(powerDraw)}, 'navy');
    createChart('powerLimitChart', 'Power Limit (W)', ${JSON.stringify(powerLimit)}, 'olive');
    createChart('powerDefaultLimitChart', 'Default Power Limit (W)', ${JSON.stringify(powerDefaultLimit)}, 'maroon');
    createChart('powerMinLimitChart', 'Min Power Limit (W)', ${JSON.stringify(powerMinLimit)}, 'darkgreen');
    createChart('powerMaxLimitChart', 'Max Power Limit (W)', ${JSON.stringify(powerMaxLimit)}, 'darkorange');
  </script>
</body>
</html>`;
}

// Run the unified profiling with GPU monitoring and WebGL profiling
profileWebGLPerformance()
  .then(() => {
    console.log('\nProfiling completed successfully.');
  })
  .catch(err => {
    console.error('Profiling failed with error:');
    console.error(err);
  });
