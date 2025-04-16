const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');

function getChromePath() {
  const platform = os.platform();
  let chromePath;
  if (platform === 'win32') {
    // Adjust path if Chrome Dev is in a different folder on your system
    chromePath = 'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe'; // Windows
  } else {
    chromePath = null; // Extend this for macOS/Linux if needed
  }
  console.log(`Detected platform: ${platform}`);
  console.log(`Using Chrome path: ${chromePath}`);
  return chromePath;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: getChromePath(), // <-- Use Chrome Dev
    args: ['--start-maximized'],
    defaultViewport: null
  });

  const page = await browser.newPage();

  const client = await page.target().createCDPSession();

  // Clear browsing data using Chrome DevTools Protocol
  await client.send('Network.clearBrowserCookies');
  await client.send('Network.clearBrowserCache');
  await client.send('Storage.clearDataForOrigin', {
    origin: '*',
    storageTypes: 'all'
  });

  console.log('✅ Cache and history cleared!');

  // Wait a bit before closing
  await new Promise(resolve => setTimeout(resolve, 2000));

  await browser.close();
})();
